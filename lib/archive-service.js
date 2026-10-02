import { Service } from '@deepseek-ai/cordis'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import * as TypertProtocol from '@deepseek-ai/dsh-typert-protocol'
import { access, lstat, readdir, readFile, realpath, rm, rmdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'
import { z } from 'zod'
import TYPERT from './typert.host.js'

const archivedWorkspaceRecord = z.object({
  workspaceId: z.string().min(1),
  path: z.string().min(1),
  title: z.string().min(1),
  sessionIds: z.array(z.string().min(1)),
  preArchivedSessionIds: z.array(z.string().min(1)),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  archivedAt: z.string().min(1),
  registryOrder: z.number().int().nonnegative(),
})
const workspaceBindingRecord = z.object({
  sessionId: z.string().min(1),
  workspaceId: z.string().min(1),
  path: z.string().min(1),
})
const archiveDomainSpec = defineDomain({
  name: 'dsh_archive',
  version: 1,
  tables: {
    workspaces: domainTable(archivedWorkspaceRecord),
    bindings: domainTable(workspaceBindingRecord),
  },
})

function errorWithCode(code, message, details = {}) {
  // DSH alpha.2 transports only errors carrying the RemoteError marker. Keep
  // a structural fallback so the same plugin still loads on alpha.1, whose
  // protocol package predates the exported RemoteError class.
  if (typeof TypertProtocol.RemoteError === 'function') {
    return new TypertProtocol.RemoteError(code, message, details)
  }
  const error = new Error(message)
  error.name = 'RemoteError'
  error.code = code
  error.details = details
  error.isDSHRemoteError = true
  return error
}

function stringId(value) {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function persistenceHeader(entry) {
  if (entry == null) return undefined
  if (typeof entry.id === 'string' && entry.id.length > 0) return entry
  if (entry.header && typeof entry.header.id === 'string' && entry.header.id.length > 0) return entry.header
  return undefined
}

function persistenceHeaders(entries) {
  return (entries ?? []).map(persistenceHeader).filter(Boolean)
}

async function mapWithConcurrency(items, limit, operation) {
  const results = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await operation(items[index])
    }
  }))
  return results
}

function isCanonicalSessionLogName(fileName) {
  return /^(?:session\.jsonl|session\.v\d+\.jsonl)(?:\.zstd)?$/.test(fileName)
}

function isSessionLockName(fileName) {
  return fileName === 'session.lock'
}

function isCanonicalSessionFileName(fileName) {
  return isCanonicalSessionLogName(fileName) || isSessionLockName(fileName)
}

function isSessionIdentity(sessionId) {
  return typeof sessionId === 'string' && /^session-[A-Za-z0-9._-]+$/.test(sessionId)
}

function sessionsRootPath(persistence) {
  // Desktop resolves its configured backend root before loading plugins.
  if (typeof persistence?.root === 'string' && isAbsolute(persistence.root)) return resolve(persistence.root)
  const configured = typeof process.env.DSH_HOME === 'string' ? process.env.DSH_HOME.trim() : ''
  const home = configured.length > 0 ? configured : join(homedir(), '.dsh')
  return resolve(home, 'sessions')
}

function isInsideDirectory(root, target) {
  const relativePath = relative(resolve(root), resolve(target))
  return relativePath !== '' && relativePath !== '..' && !relativePath.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(relativePath)
}

const SETUP_EVENT_TYPES = new Set([
  'session',
  'permission/preset',
  'sandbox/mode',
  'approval/policy',
  'agent-preset/selected',
  'session/end-seed',
])

function isConversationEventType(type) {
  if (typeof type !== 'string' || type.length === 0) return false
  return /(?:^|\/)(?:user|assistant|message|title|turn)(?:$|\/)/.test(type)
}

function isEmptyShellEvents(events) {
  if (!Array.isArray(events) || events.length === 0) return true
  if (events.length > 16) return false
  return events.every((event) => {
    const type = event?.type
    if (type === 'unparsed' || isConversationEventType(type)) return false
    return SETUP_EVENT_TYPES.has(type)
  })
}

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
const EMPTY_SHELL_MAX_BYTES = 4096

function decompressZstd(buffer) {
  const frames = []
  let offset = 0
  while (offset < buffer.length) {
    const start = buffer.indexOf(ZSTD_MAGIC, offset)
    if (start === -1) break
    frames.push(zstdDecompressSync(buffer.subarray(start)))
    offset = start + 4
  }
  if (frames.length === 0) return zstdDecompressSync(buffer)
  return Buffer.concat(frames)
}

function decodeSessionLog(buffer, fileName) {
  const decoded = fileName.endsWith('.zstd') ? decompressZstd(buffer) : buffer
  return decoded.toString('utf8').split(/\r?\n/).filter(Boolean).map((line) => {
    try { return JSON.parse(line) } catch { return { type: 'unparsed' } }
  })
}

async function withReadHandle(persistence, sessionId, fn) {
  if (typeof persistence?.open !== 'function') return undefined
  const handle = await persistence.open(sessionId, 'read')
  try {
    return await fn(handle)
  } finally {
    try {
      await handle.close?.()
    } catch {
      // Handle close is idempotent; ignore teardown races after a successful read.
    }
  }
}

function textFromMessage(event) {
  const content = event?.data?.content
  if (!Array.isArray(content)) return undefined
  const text = content
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > 0 ? text.slice(0, 80) : undefined
}

function metadataFromEvents(id, meta, events) {
  const titleEvent = [...events].reverse().find((event) => event?.type === 'session/title' && typeof event?.data?.title === 'string' && event.data.title.length > 0)
  const firstUser = events.find((event) => event?.type === 'user/message')
  const title = titleEvent?.data?.title || textFromMessage(firstUser) || id
  const firstTime = events.find((event) => Number.isFinite(event?.time) && event.time >= 0)?.time ?? 0
  const createdAt = Number.isFinite(meta?.createdAt) && meta.createdAt >= 0 ? meta.createdAt : firstTime
  const updatedAt = events.reduce((latest, event) => Number.isFinite(event?.time) ? Math.max(latest, event.time) : latest, createdAt)
  const result = { id, title, displayTitle: title, createdAt, updatedAt }
  if (typeof meta?.cwd === 'string') result.cwd = meta.cwd
  return result
}

function markRemote(method) {
  let initializer
  const decorator = Remote(method)
  decorator(ArchiveManagerService.prototype[method], {
    kind: 'method',
    name: method,
    static: false,
    private: false,
    access: {
      has: (object) => method in object,
      get: (object) => object[method],
    },
    addInitializer(value) {
      initializer = value
    },
  })
  if (initializer === undefined) throw new Error(`dsh-archive-manager: cannot mark remote method ${method}`)
  initializer.call(Object.create(ArchiveManagerService.prototype))
}

/** Host-only bridge for the archive manager UI. */
export class ArchiveManagerService extends TypertRemoteService {
  static inject = ['workspaceRegistry', 'sessionPersistence', 'sessions', 'agents', 'storageDomain']

  constructor(ctx) {
    super(ctx, 'archiveManager')
    this.registry = ctx.workspaceRegistry
    this.persistence = ctx.sessionPersistence
    this.sessions = ctx.sessions
    this.agents = ctx.agents
    this.storageDomain = ctx.storageDomain
    this.maintenanceTimers = new Set()
    this.disposed = false
    ctx.effect(() => () => {
      this.disposed = true
      for (const timer of this.maintenanceTimers) clearTimeout(timer)
      this.maintenanceTimers.clear()
    }, 'dsh-archive-manager: maintenance lifetime')
    this.installArchiveStopWatch()
  }

  async [Service.init]() {
    await this.initialize()
  }

  initialize() {
    if (this.initializePromise !== undefined) return this.initializePromise
    this.initializePromise = this.storageDomain.open(archiveDomainSpec).then(async (domain) => {
      this.ctx.effect(() => () => domain.close(), 'dsh-archive-manager.archiveDomainClose')
      this.workspaceTable = domain.table('workspaces')
      this.workspaceBindingTable = domain.table('bindings')
      this.applyWorkspaceBindings()
      await this.pruneArchivedWorkspaceSnapshots()
      await this.pruneEmptyUngroupedSessions()
      this.scheduleMaintenance(() => this.pruneEmptyUngroupedSessions(), 4000)
      return this.workspaceTable
    })
    return this.initializePromise
  }

  result(deletedSessionIds = [], skipped = []) {
    return {
      archivedSessionIds: [...this.registry.archivedSessionIds],
      deletedSessionIds: [...deletedSessionIds],
      skipped: skipped.map((item) => ({ ...item })),
    }
  }

  workspaceResult(extra = {}) {
    return {
      archivedSessionIds: [...this.registry.archivedSessionIds],
      archivedWorkspaces: this.archivedWorkspaces(),
      ...extra,
    }
  }

  archivedWorkspaces() {
    return [...(this.workspaceTable?.entries?.() ?? [])].map(([, record]) => ({ ...record, sessionIds: [...record.sessionIds], preArchivedSessionIds: [...record.preArchivedSessionIds] }))
  }

  workspaceSnapshotForSession(sessionId) {
    for (const record of this.workspaceTable?.entries?.() ?? []) {
      if (record[1].sessionIds.includes(sessionId)) return record[1]
    }
    return undefined
  }

  workspaceSnapshotById(workspaceId) {
    return this.workspaceTable?.get?.(workspaceId)
  }

  async requireWorkspaceTable() {
    try {
      return await this.initialize()
    } catch (error) {
      throw errorWithCode('archive-service-unavailable', `归档工作区存储初始化失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  applyWorkspaceBindings() {
    const paths = this.registry?.sessionPaths
    if (!(paths instanceof Map)) return
    for (const [, binding] of this.workspaceBindingTable?.entries?.() ?? []) paths.set(binding.sessionId, binding.path)
  }

  scheduleMaintenance(operation, delay) {
    if (this.disposed) return
    this.maintenanceTimers ??= new Set()
    const timer = setTimeout(() => {
      this.maintenanceTimers.delete(timer)
      if (!this.disposed) Promise.resolve().then(operation).catch((error) => {
        this.ctx.logger?.warn?.(`dsh-archive-manager: maintenance failed: ${String(error)}`)
      })
    }, delay)
    timer.unref?.()
    this.maintenanceTimers.add(timer)
  }

  async pruneArchivedWorkspaceSnapshots() {
    // A listing may omit corrupt, unsupported or temporarily unreadable logs.
    // Only the authoritative archive set proves that a chat was unarchived.
    return this.enqueue(async () => {
      const archived = new Set(this.registry.archivedSessionIds ?? [])
      for (const [key, snapshot] of this.workspaceTable?.entries?.() ?? []) {
        const sessionIds = snapshot.sessionIds.filter((id) => archived.has(id))
        const preArchivedSessionIds = snapshot.preArchivedSessionIds.filter((id) => sessionIds.includes(id))
        if (snapshot.sessionIds.length > 0 && sessionIds.length === 0) await this.workspaceTable.delete(key)
        else if (sessionIds.length !== snapshot.sessionIds.length || preArchivedSessionIds.length !== snapshot.preArchivedSessionIds.length) {
          await this.workspaceTable.put(key, { ...snapshot, sessionIds, preArchivedSessionIds })
        }
      }
    })
  }

  assignedSessionIds() {
    const assigned = new Set()
    for (const workspace of this.registry.list?.() ?? []) {
      const sessionIds = workspace.record?.sessionIds ?? workspace.sessionIds ?? []
      for (const sessionId of sessionIds) assigned.add(sessionId)
    }
    try {
      for (const [, record] of this.registry.requireTable?.()?.entries?.() ?? []) {
        for (const sessionId of record?.sessionIds ?? []) assigned.add(sessionId)
      }
    } catch {
      // The workspace table is optional during the first service tick.
    }
    for (const snapshot of this.archivedWorkspaces()) {
      for (const sessionId of snapshot.sessionIds ?? []) assigned.add(sessionId)
    }
    for (const sessionId of this.registry.archivedSessionIds ?? []) assigned.add(sessionId)
    for (const sessionId of this.registry.pinnedSessionIds ?? []) assigned.add(sessionId)
    return assigned
  }

  async pruneEmptyUngroupedSessions() {
    if (this.pruningEmptyUngrouped === true) return this.result()
    this.pruningEmptyUngrouped = true
    try {
      const state = this.state()
      const workspaces = [...(this.registry.list?.() ?? [])]
      const workspaceIds = state.workspaceIds ?? []
      if (state.initialized !== true || (workspaceIds.length > 0 && workspaces.length === 0)) {
        this.ctx.logger?.debug?.('dsh-archive-manager: workspace registry is not ready; deferring empty ungrouped cleanup')
        this.scheduleMaintenance(() => this.pruneEmptyUngroupedSessions(), 2500)
        return this.result()
      }
      const assigned = this.assignedSessionIds()
      const diskSessions = await this.listDiskSessionDirectories()
      const deleted = []
      const skipped = []
      for (const item of diskSessions) {
        if (this.disposed) break
        const sessionId = item.sessionId
        if (assigned.has(sessionId)) continue
        if (this.isAttached(sessionId) || this.isWriteBusy(sessionId)) {
          skipped.push({ sessionId, code: 'session-busy', message: '会话仍在使用，已跳过空壳清理' })
          continue
        }
        try {
          const bytes = await this.sessionLogBytes(item.directory)
          if (bytes > EMPTY_SHELL_MAX_BYTES) continue
          const events = await this.readDirectoryEvents(item.directory)
          if (!isEmptyShellEvents(events)) continue
          const prepared = await this.prepareDelete(sessionId, { allowEmpty: true })
          await this.removePrepared(prepared)
          await this.assertRemoved(prepared)
          deleted.push(sessionId)
        } catch (error) {
          skipped.push({
            sessionId,
            code: typeof error?.code === 'string' ? error.code : 'delete-failed',
            message: error instanceof Error ? error.message : String(error),
          })
        }
      }
      if (deleted.length > 0) await this.cleanDeletedState(deleted)
      if (deleted.length > 0 || skipped.length > 0) {
        this.ctx.logger?.info?.(`dsh-archive-manager: pruned ${deleted.length} empty ungrouped session(s)${skipped.length > 0 ? `, skipped ${skipped.length}` : ''}`)
      }
      return this.result(deleted, skipped)
    } catch (error) {
      this.ctx.logger?.warn?.(`dsh-archive-manager: empty ungrouped cleanup skipped: ${error instanceof Error ? error.message : String(error)}`)
      return this.result([], [{
        sessionId: 'ungrouped',
        code: typeof error?.code === 'string' ? error.code : 'cleanup-failed',
        message: error instanceof Error ? error.message : String(error),
      }])
    } finally {
      this.pruningEmptyUngrouped = false
    }
  }

  async persistWorkspaceBinding(sessionId, workspaceId, path) {
    if (this.workspaceBindingTable === undefined) return
    await this.workspaceBindingTable.put(`${workspaceId}:${sessionId}`, { sessionId, workspaceId, path })
  }

  async attachSessionForRestore(workspace, sessionId, allowPathMismatch) {
    if (!allowPathMismatch) {
      await workspace.attachSession(sessionId)
      return
    }
    const paths = this.registry?.sessionPaths
    if (!(paths instanceof Map) || typeof workspace.mutate !== 'function') {
      throw errorWithCode('workspace-restore-failed', '当前 DSH 版本不支持将会话迁移到其他工作区目录')
    }
    const previous = paths.get(sessionId)
    paths.set(sessionId, workspace.path)
    try {
      await workspace.mutate((record) => record.sessionIds.includes(sessionId)
        ? record
        : { ...record, sessionIds: [sessionId, ...record.sessionIds] })
    } catch (error) {
      if (previous === undefined) paths.delete(sessionId)
      else paths.set(sessionId, previous)
      throw error
    }
    try {
      await this.persistWorkspaceBinding(sessionId, workspace.id, workspace.path)
    } catch (error) {
      try {
        await workspace.mutate((record) => ({ ...record, sessionIds: record.sessionIds.filter((id) => id !== sessionId) }))
      } finally {
        if (previous === undefined) paths.delete(sessionId)
        else paths.set(sessionId, previous)
      }
      throw error
    }
  }

  runningSessionIds(sessionIds, workspacePath) {
    const ids = new Set(sessionIds)
    for (const agent of this.agents.list?.() ?? []) {
      const agentId = stringId(agent?.id)
      if (agentId === undefined) continue
      const header = agent?.session?.header
      const indexedPath = this.registry.sessionPaths?.get?.(agentId)
      if (workspacePath !== undefined && (header?.cwd !== undefined || indexedPath !== undefined)) {
        try {
          if (resolve(indexedPath ?? header.cwd) === resolve(workspacePath)) ids.add(agentId)
        } catch {
          // Ignore malformed headers; the workspace's indexed session ids remain authoritative.
        }
      }
    }
    return [...ids].filter((id) => this.agents.get(id)?.status === 'running')
  }

  async ensureNotRunning(sessionIds, workspacePath, label) {
    const running = this.runningSessionIds(sessionIds, workspacePath)
    if (running.length > 0) {
      throw errorWithCode('archive-running', `${label}包含仍在运行的会话，停止运行后才能归档（${running.length} 个）`)
    }
    // 0.2 reports activity from all providers, including delegated work.
    if (typeof this.ctx.waterfall === 'function' && typeof this.registry.stopSessionActivity === 'function') {
      for (const sessionId of sessionIds) {
        const activity = await this.ctx.waterfall('workspace/session-activity', { sessionId }, () => Promise.resolve([]))
        if (activity.length > 0) throw errorWithCode('archive-running', `${label}仍有进行中的任务，停止运行后才能归档`)
      }
    }
  }

  enqueue(operation) {
    const enqueue = this.registry?.enqueueOperation
    if (typeof enqueue !== 'function') {
      throw errorWithCode('archive-service-unavailable', '当前 DSH 版本未提供可安全更新归档索引的接口')
    }
    return enqueue.call(this.registry, operation)
  }

  state() {
    const state = this.registry?.state
    if (state !== undefined) return state
    const requireState = this.registry?.requireState
    if (typeof requireState === 'function') return requireState.call(this.registry)
    throw errorWithCode('archive-service-unavailable', '无法读取 DSH workspace 归档状态')
  }

  async setArchivedIds(archivedSessionIds) {
    const setState = this.registry?.setState
    if (typeof setState !== 'function') {
      throw errorWithCode('archive-service-unavailable', '当前 DSH 版本未提供可安全更新归档索引的接口')
    }
    const next = {
      ...this.state(),
      archivedSessionIds: [...archivedSessionIds],
    }
    if (Array.isArray(next.pinnedSessionIds)) {
      const archived = new Set(archivedSessionIds)
      next.pinnedSessionIds = next.pinnedSessionIds.filter((id) => !archived.has(id))
    }
    await setState.call(this.registry, next)
    return this.result()
  }

  async unarchive(request) {
    await this.requireWorkspaceTable()
    const sessionId = stringId(request?.sessionId)
    if (sessionId === undefined) throw errorWithCode('invalid-session-id', '缺少会话 ID')
    const current = [...this.registry.archivedSessionIds]
    if (!current.includes(sessionId)) return this.result()
    const snapshot = this.workspaceSnapshotForSession(sessionId)
    const restored = await this.restoreWorkspaceForSession(snapshot, sessionId)
    if (restored.workspaceMissing) {
      throw errorWithCode('workspace-missing', `原工作区路径不存在：${restored.workspacePath}`)
    }
    if (!restored.restoredSessionIds.includes(sessionId)) {
      throw errorWithCode('workspace-restore-failed', '会话无法恢复到原工作区，已保留归档状态')
    }
    const answer = await this.enqueue(async () => this.setArchivedIds(this.registry.archivedSessionIds.filter((id) => id !== sessionId)))
    if (snapshot !== undefined && !restored.workspaceMissing && snapshot.sessionIds.every((id) => !this.registry.archivedSessionIds.includes(id))) {
      await this.workspaceTable.delete(snapshot.workspaceId)
    }
    return answer
  }

  async archiveSession(request) {
    const sessionId = stringId(request?.sessionId)
    if (sessionId === undefined) throw errorWithCode('invalid-session-id', '缺少会话 ID')
    return this.enqueue(async () => {
      const current = [...this.registry.archivedSessionIds]
      if (current.includes(sessionId)) return this.result()
      if (await this.findHeader(sessionId) === undefined) throw errorWithCode('session-not-found', '会话不存在')
      await this.ensureNotRunning([sessionId], undefined, '当前会话')
      return this.setArchivedIds([...current, sessionId])
    })
  }

  async archiveWorkspace(request) {
    const workspaceId = stringId(request?.workspaceId)
    if (workspaceId === undefined) throw errorWithCode('invalid-workspace-id', '缺少工作区 ID')
    const table = await this.requireWorkspaceTable()
    const workspace = this.registry.get(workspaceId)
    if (workspace === undefined) {
      if (table.get(workspaceId) !== undefined) return this.workspaceResult({ workspaceId })
      throw errorWithCode('workspace-not-found', '工作区不存在或已被移除')
    }
    if (typeof this.registry.delete !== 'function') throw errorWithCode('archive-service-unavailable', '当前版本无法安全移除工作区')
    const sessionIds = [...workspace.sessionIds]
    await this.ensureNotRunning(sessionIds, workspace.path, `工作区“${workspace.title}”`)
    const currentArchived = new Set(this.registry.archivedSessionIds)
    const preArchivedSessionIds = sessionIds.filter((id) => currentArchived.has(id))
    const previousPins = (this.state().pinnedSessionIds ?? []).filter((id) => sessionIds.includes(id))
    const snapshot = {
      workspaceId,
      path: workspace.path,
      title: workspace.title,
      sessionIds,
      preArchivedSessionIds,
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt,
      archivedAt: new Date().toISOString(),
      registryOrder: this.registry.state.workspaceIds.indexOf(workspaceId),
    }
    await table.put(workspaceId, snapshot)
    try {
      await this.enqueue(async () => {
        await this.ensureNotRunning(sessionIds, workspace.path, `工作区“${workspace.title}”`)
        const ids = new Set(this.registry.archivedSessionIds)
        for (const id of sessionIds) ids.add(id)
        await this.setArchivedIds([...ids])
      })
      // Complete the operation on the host. A disconnected client must not
      // leave an archived project in the active workspace list.
      await this.registry.delete(workspaceId)
      return this.workspaceResult({ workspaceId })
    } catch (error) {
      // A backend can fail after committing deletion. Preserve the snapshot
      // whenever the workspace has already disappeared.
      if (this.registry.get(workspaceId) === undefined) return this.workspaceResult({ workspaceId })
      try {
        await this.enqueue(async () => {
          const ids = new Set(this.registry.archivedSessionIds)
          for (const id of sessionIds) if (!preArchivedSessionIds.includes(id)) ids.delete(id)
          await this.setArchivedIds([...ids])
          const state = this.state()
          await this.registry.setState({ ...state, pinnedSessionIds: [...new Set([...(state.pinnedSessionIds ?? []), ...previousPins.filter((id) => !ids.has(id))])] })
        })
        await table.delete(workspaceId)
      } catch (rollbackError) {
        this.ctx.logger?.error?.(`dsh-archive-manager: workspace archive rollback failed for ${workspaceId}: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`)
      }
      throw error
    }
  }

  async restoreWorkspace(request) {
    const workspaceId = stringId(request?.workspaceId)
    if (workspaceId === undefined) throw errorWithCode('invalid-workspace-id', '缺少工作区 ID')
    const table = await this.requireWorkspaceTable()
    const snapshot = table.get(workspaceId)
    if (snapshot === undefined) throw errorWithCode('workspace-not-found', '归档工作区不存在')
    const restored = await this.restoreWorkspaceSnapshot(snapshot)
    if (restored.workspaceMissing) return this.workspaceResult(restored)
    const expected = snapshot.sessionIds
    if (expected.some((id) => !restored.restoredSessionIds.includes(id))) {
      throw errorWithCode('workspace-restore-failed', '部分会话无法恢复到原工作区，已保留归档状态')
    }
    const restoredSet = new Set(restored.restoredSessionIds.filter((id) => !snapshot.preArchivedSessionIds.includes(id)))
    await this.enqueue(async () => {
      await this.setArchivedIds(this.registry.archivedSessionIds.filter((id) => !restoredSet.has(id)))
    })
    await table.delete(workspaceId)
    return this.workspaceResult(restored)
  }

  async restoreWorkspaceAt(request) {
    const workspaceId = stringId(request?.workspaceId)
    const path = stringId(request?.path)
    if (workspaceId === undefined) throw errorWithCode('invalid-workspace-id', '缺少工作区 ID')
    if (path === undefined) throw errorWithCode('invalid-workspace-path', '缺少工作区路径')
    const table = await this.requireWorkspaceTable()
    const snapshot = table.get(workspaceId)
    if (snapshot === undefined) throw errorWithCode('workspace-not-found', '归档工作区不存在')
    const restored = await this.restoreWorkspaceSnapshot(snapshot, undefined, path)
    const expected = snapshot.sessionIds
    if (restored.workspaceMissing || expected.some((id) => !restored.restoredSessionIds.includes(id))) {
      throw errorWithCode('workspace-restore-failed', '所选目录无法接收该工作区的会话，已保留归档状态')
    }
    const restoredSet = new Set(restored.restoredSessionIds.filter((id) => !snapshot.preArchivedSessionIds.includes(id)))
    await this.enqueue(async () => {
      await this.setArchivedIds(this.registry.archivedSessionIds.filter((id) => !restoredSet.has(id)))
    })
    await table.delete(workspaceId)
    return this.workspaceResult(restored)
  }

  async restoreWorkspaceSnapshot(snapshot, onlySessionId, targetPath) {
    const restorePath = targetPath ?? snapshot.path
    let workspace = this.registry.get(snapshot.workspaceId)
    // A caller explicitly selected a target. Do not silently reuse a live
    // workspace at the old path (including after a partially completed restore).
    if (targetPath !== undefined && workspace?.path !== targetPath) workspace = undefined
    if (workspace === undefined) {
      try {
        workspace = await this.registry.create(restorePath, snapshot.title)
      } catch (error) {
        return { workspaceId: snapshot.workspaceId, workspaceMissing: true, workspacePath: restorePath, workspaceTitle: snapshot.title, restoredSessionIds: [] }
      }
    }
    const allowPathMismatch = targetPath !== undefined && workspace.path !== snapshot.path
    const targets = onlySessionId === undefined ? snapshot.sessionIds : [onlySessionId]
    const restoredSessionIds = []
    for (const sessionId of [...targets].reverse()) {
      try {
        await this.attachSessionForRestore(workspace, sessionId, allowPathMismatch)
        restoredSessionIds.push(sessionId)
      } catch (error) {
        this.ctx.logger?.warn?.(`dsh-archive-manager: failed to restore session ${sessionId} into workspace ${workspace.id}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    return { workspaceId: workspace.id, workspaceMissing: false, workspacePath: workspace.path, workspaceTitle: workspace.title, workspaceRelocated: allowPathMismatch, restoredSessionIds }
  }

  async restoreWorkspaceForSession(snapshot, sessionId) {
    if (snapshot === undefined) return { workspaceMissing: false, restoredSessionIds: [sessionId] }
    return this.restoreWorkspaceSnapshot(snapshot, sessionId)
  }

  async archives() {
    await this.requireWorkspaceTable()
    const answer = this.workspaceResult()
    const archivedIds = [...this.registry.archivedSessionIds]
    const headers = persistenceHeaders(await this.persistence.list())
    const headersById = new Map(headers.map((header) => [header.id, header]))
    answer.archivedSessions = await mapWithConcurrency(archivedIds, 4, async (id) => {
      try {
        const meta = headersById.get(id) ?? this.sessions.get(id)?.header
        if (typeof this.persistence.open === 'function') {
          try {
            const fromHandle = await withReadHandle(this.persistence, id, async (handle) => {
              const result = await handle.read()
              return metadataFromEvents(id, handle.header ?? meta, result?.events ?? [])
            })
            if (fromHandle !== undefined) return fromHandle
          } catch {
            // Fall through to older persistence APIs still present on 0.1.2.
          }
        }
        if (typeof this.persistence.readRaw === 'function' && this.persistence.supportsRawArtifacts) {
          const raw = await this.persistence.readRaw(id)
          const events = String(raw?.content ?? '').split(/\r?\n/).filter(Boolean).map((line) => {
            try { return JSON.parse(line) } catch { return undefined }
          }).filter(Boolean)
          return metadataFromEvents(id, raw?.meta ?? meta, events)
        }
        if (typeof this.persistence.inspect === 'function') {
          const inspection = await this.persistence.inspect(id)
          return metadataFromEvents(id, inspection?.meta ?? meta, inspection?.events ?? [])
        }
        return metadataFromEvents(id, meta, [])
      } catch (error) {
        this.ctx.logger?.debug?.(`dsh-archive-manager: session metadata unavailable for ${id}: ${error instanceof Error ? error.message : String(error)}`)
        return { id, title: id, displayTitle: id, createdAt: 0, updatedAt: 0 }
      }
    })
    answer.archivedWorkspaces = await Promise.all(answer.archivedWorkspaces.map(async (snapshot) => {
      try {
        await access(snapshot.path)
        return { ...snapshot, pathAvailable: true }
      } catch {
        return { ...snapshot, pathAvailable: false }
      }
    }))
    return answer
  }

  live() {
    const ids = new Set()
    for (const session of this.sessions.list?.() ?? []) {
      const id = stringId(session?.id ?? session?.header?.id)
      if (id !== undefined) ids.add(id)
    }
    for (const agent of this.agents.list?.() ?? []) {
      const id = stringId(agent?.id)
      if (id !== undefined) ids.add(id)
    }
    return { liveSessionIds: [...ids] }
  }

  async delete(request) {
    const sessionId = stringId(request?.sessionId)
    if (sessionId === undefined) throw errorWithCode('invalid-session-id', '缺少会话 ID')
    const result = await this.enqueue(async () => {
      const archived = [...this.registry.archivedSessionIds]
      if (!archived.includes(sessionId)) return this.result()
      const prepared = await this.prepareDelete(sessionId)
      await this.removePrepared(prepared)
      await this.assertRemoved(prepared)
      const accounts = await this.detachWorkspaceAccounts(sessionId)
      try {
        await this.setArchivedIds(archived.filter((id) => id !== sessionId))
      } catch (error) {
        await this.restoreWorkspaceAccounts(accounts, sessionId)
        throw errorWithCode('delete-cleanup-incomplete', `会话文件已删除，但索引更新失败，请重试删除以完成清理：${error instanceof Error ? error.message : String(error)}`)
      }
      return this.result([sessionId])
    })
    await this.cleanDeletedState(result.deletedSessionIds)
    return result
  }

  async deleteMany(request) {
    const result = await this.enqueue(async () => {
      const archived = [...this.registry.archivedSessionIds]
      const requested = Array.isArray(request?.sessionIds)
        ? [...new Set(request.sessionIds)]
        : archived
      const targets = requested.filter((id) => archived.includes(id))
      const prepared = []
      const skipped = []
      for (const sessionId of targets) {
        try {
          prepared.push(await this.prepareDelete(sessionId))
        } catch (error) {
          skipped.push({
            sessionId,
            code: typeof error?.code === 'string' ? error.code : 'delete-failed',
            message: error instanceof Error ? error.message : String(error),
          })
        }
      }
      if (prepared.length === 0) return this.result([], skipped)

      const deleted = []
      for (const item of prepared) {
        try {
          await this.removePrepared(item)
          await this.assertRemoved(item)
          const accounts = await this.detachWorkspaceAccounts(item.sessionId)
          try {
            const nextArchived = [...this.registry.archivedSessionIds].filter((id) => id !== item.sessionId)
            await this.setArchivedIds(nextArchived)
            deleted.push(item.sessionId)
          } catch (error) {
            await this.restoreWorkspaceAccounts(accounts, item.sessionId)
            throw errorWithCode('delete-cleanup-incomplete', `会话文件已删除，但索引更新失败，请重试删除以完成清理：${error instanceof Error ? error.message : String(error)}`)
          }
        } catch (error) {
          skipped.push({
            sessionId: item.sessionId,
            code: typeof error?.code === 'string' ? error.code : 'delete-failed',
            message: error instanceof Error ? error.message : String(error),
          })
        }
      }
      return this.result(deleted, skipped)
    })
    await this.cleanDeletedState(result.deletedSessionIds)
    return result
  }

  async cleanDeletedState(sessionIds = []) {
    for (const sessionId of sessionIds) {
      const failures = []
      try {
        for (const workspace of this.registry.list?.() ?? []) {
          if (workspace.sessionIds.includes(sessionId) && typeof workspace.detachSession === 'function') {
            await workspace.detachSession(sessionId)
          }
        }
      } catch (error) {
        failures.push(`workspace: ${error instanceof Error ? error.message : String(error)}`)
      }

      try {
        const cache = this.ctx.get?.('sessionProjectionCache')
        if (cache?.table && typeof cache.table.delete === 'function') {
          await cache.table.delete(sessionId)
          if (sessionId.startsWith('session-')) await cache.table.delete(sessionId.slice('session-'.length))
        }
      } catch (error) {
        failures.push(`projection cache: ${error instanceof Error ? error.message : String(error)}`)
      }

      for (const map of [this.registry.headers, this.registry.sessionPaths, this.registry.invalidSessionPaths]) {
        if (map instanceof Map) map.delete(sessionId)
      }
      try {
        for (const [key, binding] of this.workspaceBindingTable?.entries?.() ?? []) {
          if (binding.sessionId === sessionId) await this.workspaceBindingTable.delete(key)
        }
      } catch (error) {
        failures.push(`workspace binding: ${error instanceof Error ? error.message : String(error)}`)
      }
      try {
        for (const [key, snapshot] of this.workspaceTable?.entries?.() ?? []) {
          if (!snapshot.sessionIds.includes(sessionId)) continue
          const sessionIds = snapshot.sessionIds.filter((id) => id !== sessionId)
          const preArchivedSessionIds = snapshot.preArchivedSessionIds.filter((id) => id !== sessionId)
          if (sessionIds.length === 0) await this.workspaceTable.delete(key)
          else await this.workspaceTable.put(key, { ...snapshot, sessionIds, preArchivedSessionIds })
        }
      } catch (error) {
        failures.push(`workspace archive snapshot: ${error instanceof Error ? error.message : String(error)}`)
      }
      if (failures.length > 0) {
        this.ctx.logger?.warn?.(`dsh-archive-manager: derived state cleanup failed for ${sessionId}: ${failures.join('; ')}`)
      }
    }
  }

  async detachWorkspaceAccounts(sessionId) {
    const accounts = []
    try {
      for (const workspace of this.registry.list?.() ?? []) {
        if (!workspace.sessionIds.includes(sessionId) || typeof workspace.detachSession !== 'function') continue
        await workspace.detachSession(sessionId)
        accounts.push(workspace)
      }
    } catch (error) {
      await this.restoreWorkspaceAccounts(accounts, sessionId)
      throw error
    }
    return accounts
  }

  async restoreWorkspaceAccounts(accounts, sessionId) {
    for (const workspace of accounts ?? []) {
      try {
        if (typeof workspace.attachSession === 'function') await workspace.attachSession(sessionId)
      } catch (error) {
        this.ctx.logger?.warn?.(`dsh-archive-manager: failed to restore workspace account for ${sessionId}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  async findHeader(sessionId) {
    const live = this.sessions.get(sessionId)
    if (live !== undefined) return live.header
    const headers = persistenceHeaders(await this.persistence.list())
    return headers.find((header) => header.id === sessionId)
  }

  async findSessionDirectory(sessionId, header) {
    if (!isSessionIdentity(sessionId)) return undefined
    const root = sessionsRootPath(this.persistence)
    const candidates = []
    if (header !== undefined) {
      const location = await this.resolveSessionLog(header)
      if (typeof location?.path === 'string' && isAbsolute(location.path)) candidates.push(dirname(resolve(location.path)))
    }
    try {
      for (const cwdDir of await readdir(root, { withFileTypes: true })) {
        if (!cwdDir.isDirectory()) continue
        candidates.push(join(root, cwdDir.name, sessionId))
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    for (const candidate of candidates) {
      try {
        const info = await lstat(candidate)
        if (!info.isDirectory()) continue
        if (basename(candidate) !== sessionId) continue
        if (!isInsideDirectory(root, candidate)) continue
        return resolve(candidate)
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }
    }
    return undefined
  }

  async listDiskSessionDirectories() {
    const root = sessionsRootPath(this.persistence)
    const result = []
    let cwdDirs
    try {
      cwdDirs = await readdir(root, { withFileTypes: true })
    } catch (error) {
      if (error?.code === 'ENOENT') return result
      throw error
    }
    for (const cwdDir of cwdDirs) {
      if (!cwdDir.isDirectory()) continue
      const cwdPath = join(root, cwdDir.name)
      if (!isInsideDirectory(root, cwdPath) && resolve(cwdPath) !== resolve(root)) continue
      let sessionDirs
      try {
        sessionDirs = await readdir(cwdPath, { withFileTypes: true })
      } catch (error) {
        if (error?.code === 'ENOENT') continue
        throw error
      }
      for (const sessionDir of sessionDirs) {
        if (!sessionDir.isDirectory() || !isSessionIdentity(sessionDir.name)) continue
        const directory = join(cwdPath, sessionDir.name)
        if (!isInsideDirectory(root, directory)) continue
        result.push({ sessionId: sessionDir.name, directory })
      }
    }
    return result
  }

  async readDirectoryEvents(directory) {
    let names
    try {
      names = await readdir(directory)
    } catch (error) {
      if (error?.code === 'ENOENT') return []
      throw error
    }
    const events = []
    for (const name of names.filter((fileName) => isCanonicalSessionLogName(fileName))) {
      events.push(...decodeSessionLog(await readFile(join(directory, name)), name))
    }
    return events
  }

  async sessionLogBytes(directory) {
    let total = 0
    let names
    try {
      names = await readdir(directory)
    } catch (error) {
      if (error?.code === 'ENOENT') return 0
      throw error
    }
    for (const name of names) {
      if (!isCanonicalSessionLogName(name)) continue
      try {
        total += (await lstat(join(directory, name))).size
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }
    }
    return total
  }

  async preferredSessionLog(directory) {
    let names
    try {
      names = await readdir(directory)
    } catch (error) {
      if (error?.code === 'ENOENT') return undefined
      throw error
    }
    const logs = names.filter((name) => isCanonicalSessionLogName(name)).sort((left, right) => {
      const rank = (name) => name.startsWith('session.jsonl') ? 0 : 1
      return rank(left) - rank(right) || left.localeCompare(right)
    })
    return logs.length > 0 ? resolve(directory, logs[0]) : undefined
  }

  async assertSafeSessionDirectory(directory, sessionId) {
    const root = sessionsRootPath(this.persistence)
    const resolved = resolve(directory)
    if (!isSessionIdentity(sessionId) || basename(resolved) !== sessionId) {
      throw errorWithCode('unsafe-session-path', '会话目录身份未通过安全校验')
    }
    if (!isInsideDirectory(root, resolved)) {
      throw errorWithCode('unsafe-session-path', '会话目录不在 DSH 会话存储根目录内')
    }
    const [canonicalRoot, canonicalDirectory] = await Promise.all([realpath(root), realpath(resolved)])
    if (canonicalDirectory !== resolve(canonicalRoot, relative(root, resolved)) || !isInsideDirectory(canonicalRoot, canonicalDirectory)) {
      throw errorWithCode('unsafe-session-path', '会话目录经过符号链接跳转，已停止删除')
    }
    const info = await lstat(resolved)
    if (!info.isDirectory()) throw errorWithCode('unsafe-session-path', '会话目标不是目录')
    for (const entry of await readdir(resolved, { withFileTypes: true })) {
      if (entry.isDirectory() || entry.isSymbolicLink() || !isCanonicalSessionFileName(entry.name)) {
        throw errorWithCode('unsafe-session-path', `会话目录含有无法安全删除的文件：${entry.name}`)
      }
    }
  }

  async readSessionEvents(sessionId, header) {
    if (typeof this.persistence.open === 'function') {
      try {
        const fromHandle = await withReadHandle(this.persistence, sessionId, async (handle) => {
          const result = await handle.read()
          return Array.isArray(result?.events) ? result.events : []
        })
        if (fromHandle !== undefined) return fromHandle
      } catch {
        // Fall through to reading the local JSONL artifact directly.
      }
    }
    const directory = await this.findSessionDirectory(sessionId, header)
    const path = directory === undefined ? undefined : await this.preferredSessionLog(directory)
    if (path === undefined) return []
    return decodeSessionLog(await readFile(path), basename(path))
  }

  async resolveSessionLog(header) {
    if (typeof this.persistence.findLog === 'function') {
      const selected = await this.persistence.findLog(header.id)
      if (typeof selected?.sourcePath === 'string') return { kind: 'jsonl', path: selected.sourcePath }
    }
    if (typeof this.persistence.listArtifacts === 'function') {
      const artifacts = await this.persistence.listArtifacts()
      const match = (artifacts ?? []).find((item) => persistenceHeader(item?.header ?? item)?.id === header.id)
      if (typeof match?.path === 'string') return { kind: 'jsonl', path: match.path }
    }
    if (typeof this.persistence.locate === 'function') {
      const location = this.persistence.locate(header)
      if (location !== undefined && typeof location.path === 'string') return location
    }
    return undefined
  }

  async prepareDelete(sessionId, options = {}) {
    const allowEmpty = options.allowEmpty === true
    await this.stopTurn(sessionId)
    await this.waitUntilSettled(sessionId, 3000)
    if (this.isAttached(sessionId)) {
      throw errorWithCode('session-release-failed', '会话已取消，但当前进程仍未释放它，暂时无法安全删除会话文件')
    }
    if (this.isWriteBusy(sessionId)) {
      throw errorWithCode('session-busy', '会话日志仍在写入，请稍后再永久删除')
    }
    const header = await this.findHeader(sessionId)
    const directory = await this.findSessionDirectory(sessionId, header)
    if (header === undefined && directory === undefined) return { sessionId, path: undefined, directory: undefined }
    let location
    try {
      location = header === undefined ? undefined : await this.resolveSessionLog(header)
    } catch (error) {
      if (!allowEmpty) throw error
    }
    const path = typeof location?.path === 'string' && isAbsolute(location.path) ? resolve(location.path) : directory === undefined ? undefined : await this.preferredSessionLog(directory)
    if (path === undefined && directory === undefined) {
      throw errorWithCode('unsupported-persistence', '当前持久化后端没有可安全删除的会话文件')
    }
    if (location !== undefined && location.kind !== undefined && location.kind !== 'jsonl') {
      throw errorWithCode('unsupported-persistence', `不支持删除 ${location.kind} 持久化后端的会话`)
    }
    if (path !== undefined) {
      const fileName = basename(path)
      if (!isCanonicalSessionLogName(fileName) || !isInsideDirectory(sessionsRootPath(this.persistence), path) || basename(dirname(path)) !== sessionId || directory === undefined || resolve(dirname(path)) !== resolve(directory)) {
        throw errorWithCode('unsafe-session-path', '会话文件路径未通过安全校验')
      }
      if (header !== undefined && !allowEmpty) await this.verifyArtifact(sessionId, header, path)
      try {
        const info = await lstat(path)
        if (!info.isFile()) throw errorWithCode('unsafe-session-path', '会话目标不是普通文件')
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }
    }
    if (directory !== undefined) await this.assertSafeSessionDirectory(directory, sessionId)
    return { sessionId, path, directory, allowEmpty }
  }

  async removePrepared(prepared) {
    const { sessionId, path, directory } = prepared
    const target = directory ?? (path === undefined ? undefined : dirname(path))
    if (target === undefined) return
    if (prepared.allowEmpty && this.disposed) throw errorWithCode('archive-service-unavailable', '归档插件已停用，已停止空壳清理')
    // Validate before acquireLease: the backend may create a missing directory.
    try { await this.assertSafeSessionDirectory(target, sessionId) } catch (error) {
      if (error?.code === 'ENOENT') return
      throw error
    }
    let lease
    let claimed = false
    const tracker = this.persistence?.tracker
    try {
      if (this.isWriteBusy(sessionId)) throw errorWithCode('session-busy', '会话日志仍在写入，请稍后再永久删除')
      // Desktop 0.2 owns a kernel lease across processes. Refuse deletion
      // while another Host holds it, and block new writers in this Host.
      if (typeof this.persistence.acquireLease === 'function') {
        if (typeof tracker?.claimWrite === 'function') {
          tracker.claimWrite(sessionId)
          claimed = true
        }
        try {
          lease = await this.persistence.acquireLease(sessionId, undefined, target)
        } catch (error) {
          if (error?.name === 'SessionAlreadyOwnedError') throw errorWithCode('session-busy', '其他进程仍在使用该会话，请稍后再永久删除')
          throw error
        }
      }
      await this.assertSafeSessionDirectory(target, sessionId)
      if (prepared.allowEmpty === true) {
        if (this.assignedSessionIds().has(sessionId) || this.isAttached(sessionId)) throw errorWithCode('session-busy', '会话已被使用，已跳过空壳清理')
        if (await this.sessionLogBytes(target) > EMPTY_SHELL_MAX_BYTES || !isEmptyShellEvents(await this.readDirectoryEvents(target))) {
          throw errorWithCode('session-not-empty', '会话已产生内容，已跳过空壳清理')
        }
      } else {
        const header = await this.findHeader(sessionId)
        if (header === undefined || path === undefined) throw errorWithCode('session-identity-mismatch', '无法重新确认会话身份，已停止删除')
        await this.verifyArtifact(sessionId, header, path)
      }
      await this.removePreparedFiles(prepared)
      this.persistence.coldLogMemo?.delete?.(sessionId)
    } finally {
      try { await lease?.release() } finally {
        if (claimed) tracker.releaseClaim(sessionId)
      }
    }
  }

  async removePreparedFiles({ path, directory }) {
    const target = directory ?? (path === undefined ? undefined : dirname(path))
    if (target !== undefined && isSessionIdentity(basename(target)) && isInsideDirectory(sessionsRootPath(this.persistence), target)) {
      try {
        await this.assertSafeSessionDirectory(target, basename(target))
        await rm(target, { recursive: true, force: false })
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }
      try {
        const parent = dirname(target)
        if (isInsideDirectory(sessionsRootPath(this.persistence), parent) && (await readdir(parent)).length === 0) await rmdir(parent)
      } catch (error) {
        if (error?.code !== 'ENOENT' && error?.code !== 'ENOTEMPTY') throw error
      }
      return
    }
    throw errorWithCode('unsafe-session-path', '会话目标没有可安全删除的目录')
  }

  async assertRemoved(prepared) {
    const targets = [prepared?.path, prepared?.directory].filter((value) => typeof value === 'string')
    for (const target of targets) {
      try {
        await lstat(target)
        throw errorWithCode('delete-failed', '会话文件删除后仍然存在，已停止摘除归档标记')
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }
    }
    if (await this.findSessionDirectory(prepared.sessionId) !== undefined) {
      throw errorWithCode('delete-failed', '会话目录删除后仍然存在，已停止摘除归档标记')
    }
    const headers = persistenceHeaders(await this.persistence.list())
    if (headers.some((header) => header.id === prepared.sessionId)) {
      throw errorWithCode('delete-failed', '会话文件删除后仍能被持久化层看到，已停止摘除归档标记')
    }
  }

  isAttached(sessionId) {
    return this.sessions.get(sessionId) !== undefined || this.agents.get(sessionId) !== undefined
  }

  isWriteBusy(sessionId) {
    const tracker = this.persistence?.tracker
    if (tracker !== undefined && tracker !== null) {
      if (tracker.writers instanceof Map && tracker.writers.has(sessionId)) return true
      if (tracker.pending instanceof Map && tracker.pending.has(sessionId)) return true
      if (typeof tracker.hasPending === 'function' && tracker.hasPending(sessionId)) return true
    }
    const coordinator = this.persistence?.coordinator
    if (coordinator === undefined || coordinator === null) return false
    if (coordinator.retirements instanceof Map && coordinator.retirements.has(sessionId)) return true
    if (coordinator.states instanceof Map && coordinator.states.has(sessionId)) return true
    if (coordinator.preparations !== undefined && typeof coordinator.preparations.has === 'function' && coordinator.preparations.has(sessionId)) return true
    return false
  }

  installArchiveStopWatch() {
    const stopping = new Set()
    const stopIfArchived = (sessionId, agent) => {
      if (this.disposed || this.registry.state?.initialized !== true) return
      const id = stringId(sessionId)
      if (id === undefined) return
      if (!this.registry.archivedSessionIds.includes(id)) return
      if (stopping.has(id)) return
      stopping.add(id)
      this.stopTurn(id).catch((error) => {
        this.ctx.logger?.warn?.(`dsh-archive-manager: stop archived session failed for ${id}: ${error instanceof Error ? error.message : String(error)}`)
      }).finally(() => {
        stopping.delete(id)
      })
    }

    const scan = () => {
      try {
        for (const sessionId of this.registry.archivedSessionIds ?? []) {
          const agent = this.agents.get(sessionId)
          const session = this.sessions.get(sessionId)
          if (agent !== undefined || session !== undefined) stopIfArchived(sessionId, agent)
        }
      } catch {
        // The registry may not be initialized during the first service tick.
      }
    }

    const timer = setInterval(scan, 400)
    const offStatus = typeof this.ctx.on === 'function'
      ? this.ctx.on('agent/status', (payload) => {
          stopIfArchived(payload?.agent?.id, payload?.agent)
        }, { global: true })
      : undefined

    this.ctx.effect(() => () => {
      clearInterval(timer)
      if (typeof offStatus === 'function') offStatus()
    }, 'dsh-archive-manager: release archived live sessions')
  }

  headerOf(sessionId) {
    return this.agents.get(sessionId)?.session?.header ?? this.sessions.get(sessionId)?.header
  }

  async stopTurn(sessionId) {
    if (typeof this.registry.stopSessionActivity === 'function') await this.registry.stopSessionActivity(sessionId)
    const header = this.headerOf(sessionId)
    const agent = this.agents.get(sessionId)
    const subagents = this.ctx.get?.('subagents')

    if (header?.origin === 'subagent' && subagents !== undefined) {
      const parent = header.parentSession === undefined ? undefined : this.agents.get(header.parentSession)
      if (parent !== undefined && typeof subagents.drainContinuableChildren === 'function') {
        try {
          await subagents.drainContinuableChildren(parent, [sessionId])
        } catch (error) {
          this.ctx.logger?.warn?.(`dsh-archive-manager: subagent drain failed for ${sessionId}: ${error instanceof Error ? error.message : String(error)}`)
        }
      } else if (typeof subagents.interrupt === 'function') {
        try {
          const authority = parent !== undefined
            ? { kind: 'ancestor', agent: parent }
            : typeof header.parentSession === 'string' && header.parentSession.length > 0
              ? { kind: 'user', parentSessionId: header.parentSession }
              : undefined
          if (authority !== undefined) subagents.interrupt(sessionId, authority)
        } catch (error) {
          this.ctx.logger?.warn?.(`dsh-archive-manager: subagent interrupt failed for ${sessionId}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    }

    if (agent !== undefined && typeof agent.cancel === 'function') {
      try {
        agent.cancel({ kind: 'user' }, { keepInbox: false })
        if (typeof agent.whenIdle === 'function') await this.waitForIdle(agent, 1200)
      } catch (error) {
        this.ctx.logger?.warn?.(`dsh-archive-manager: cancel failed for ${sessionId}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    await this.forceRelease(sessionId, agent)
  }

  async waitForIdle(agent, timeoutMs) {
    const idle = Promise.resolve().then(() => agent.whenIdle()).catch(() => undefined)
    await Promise.race([
      idle,
      new Promise((resolve) => setTimeout(resolve, timeoutMs)),
    ])
  }

  async forceRelease(sessionId, agent) {
    // AgentHandle.dispose() is intentionally owner-only in DSH. The runtime
    // still exposes the same ordered lifecycle pieces on the live objects,
    // which lets this plugin release an archived session without patching DSH.
    if (agent !== undefined) {
      try {
        if (agent.scope !== undefined && typeof agent.scope.dispose === 'function') {
          await agent.scope.dispose()
        } else if (agent.ctx?.fiber !== undefined && typeof agent.ctx.fiber.dispose === 'function') {
          await agent.ctx.fiber.dispose()
        }
      } catch (error) {
        this.ctx.logger?.warn?.(`dsh-archive-manager: agent scope release failed for ${sessionId}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    const agentEntry = this.agents.store?.get?.(sessionId)
    if (agentEntry?.agent === agent && typeof this.agents.detachEntered === 'function') {
      try {
        this.agents.detachEntered(agentEntry)
      } catch (error) {
        this.ctx.logger?.warn?.(`dsh-archive-manager: agent registry release failed for ${sessionId}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    const sessionEntry = this.sessions.store?.get?.(sessionId)
    if (sessionEntry?.session?.id === sessionId && typeof sessionEntry.detach === 'function') {
      try {
        sessionEntry.detach()
      } catch (error) {
        this.ctx.logger?.warn?.(`dsh-archive-manager: session registry release failed for ${sessionId}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  async waitUntilSettled(sessionId, timeoutMs = 1200) {
    const started = Date.now()
    while (Date.now() - started < timeoutMs) {
      const running = this.agents.get(sessionId)?.status === 'running'
      if (!running && !this.isWriteBusy(sessionId)) return
      await new Promise((resolve) => setTimeout(resolve, 40))
    }
  }

  async verifyArtifact(sessionId, header, path, options = {}) {
    const allowEmpty = options.allowEmpty === true
    if (typeof this.persistence.open === 'function') {
      await withReadHandle(this.persistence, sessionId, async (handle) => {
        if (handle?.header?.id !== sessionId || header.id !== sessionId) {
          throw errorWithCode('session-identity-mismatch', '会话日志身份校验失败，已停止删除')
        }
        const result = await handle.read()
        if (!Array.isArray(result?.events) || result.events.length === 0) {
          if (allowEmpty) return
          throw errorWithCode('empty-session-artifact', '会话日志为空，已停止删除')
        }
      })
      const located = await this.resolveSessionLog(header)
      if (located?.path !== undefined && located.path !== path) {
        throw errorWithCode('session-identity-mismatch', '会话日志路径校验失败，已停止删除')
      }
      return
    }
    if (typeof this.persistence.readRaw !== 'function') {
      throw errorWithCode('unsupported-persistence', '当前持久化后端没有可安全校验的会话读取接口')
    }
    const raw = await this.persistence.readRaw(sessionId)
    if (raw === undefined) return
    if (raw.meta?.id !== sessionId || header.id !== sessionId) {
      throw errorWithCode('session-identity-mismatch', '会话日志身份校验失败，已停止删除')
    }
    const located = typeof this.persistence.locate === 'function'
      ? this.persistence.locate(raw.meta)
      : await this.resolveSessionLog(raw.meta ?? header)
    if (located?.path !== path) {
      throw errorWithCode('session-identity-mismatch', '会话日志路径校验失败，已停止删除')
    }
    if (typeof raw.content !== 'string' || raw.content.length === 0) {
      if (allowEmpty) return
      throw errorWithCode('empty-session-artifact', '会话日志为空，已停止删除')
    }
    const newline = raw.content.indexOf('\n')
    const firstLine = raw.content.slice(0, newline === -1 ? raw.content.length : newline)
    let parsed
    try {
      parsed = JSON.parse(firstLine)
    } catch {
      throw errorWithCode('session-identity-mismatch', '会话日志首行不是有效 JSON，已停止删除')
    }
    if (parsed?.type !== 'session' || parsed.id !== sessionId) {
      throw errorWithCode('session-identity-mismatch', '会话日志首行校验失败，已停止删除')
    }
  }
}

for (const method of ['unarchive', 'archiveSession', 'archiveWorkspace', 'restoreWorkspace', 'restoreWorkspaceAt', 'delete', 'deleteMany']) {
  const operation = ArchiveManagerService.prototype[method]
  ArchiveManagerService.prototype[method] = async function (request) {
    await this.requireWorkspaceTable()
    const result = (this.operationTail ?? Promise.resolve()).then(() => {
      if (this.disposed) throw errorWithCode('archive-service-unavailable', '归档插件已停用')
      return operation.call(this, request)
    })
    this.operationTail = result.catch(() => {})
    return result
  }
}

markRemote('unarchive')
markRemote('archiveSession')
markRemote('archiveWorkspace')
markRemote('restoreWorkspace')
markRemote('restoreWorkspaceAt')
markRemote('archives')
markRemote('live')
markRemote('delete')
markRemote('deleteMany')

export { TYPERT }
export default ArchiveManagerService
