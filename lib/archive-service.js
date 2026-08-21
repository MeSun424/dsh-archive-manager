import { Service } from '@deepseek-ai/cordis'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { access, lstat, readdir, rm, rmdir } from 'node:fs/promises'
import { basename, dirname, isAbsolute, resolve } from 'node:path'
import { z } from 'zod'
import TYPERT from './typert.host.js'

const LOG_NAMES = new Set(['session.jsonl', 'session.jsonl.zstd'])
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

function errorWithCode(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function stringId(value) {
  return typeof value === 'string' && value.length > 0 ? value : undefined
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
  const times = events.map((event) => event?.time).filter((time) => Number.isFinite(time))
  const createdAt = Number.isFinite(meta?.createdAt) ? meta.createdAt : (times[0] ?? 0)
  const updatedAt = times.length > 0 ? Math.max(...times) : createdAt
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

  async pruneArchivedWorkspaceSnapshots() {
    try {
      const archived = new Set(this.registry?.archivedSessionIds ?? [])
      const headers = await this.persistence.list()
      const persisted = new Set((headers ?? []).map((header) => header.id))
      const validArchived = [...archived].filter((id) => persisted.has(id))
      if (validArchived.length !== archived.size && typeof this.registry?.setState === 'function') {
        await this.registry.setState({ ...this.state(), archivedSessionIds: validArchived })
        archived.clear()
        for (const id of validArchived) archived.add(id)
      }
      for (const [key, snapshot] of this.workspaceTable?.entries?.() ?? []) {
        const sessionIds = snapshot.sessionIds.filter((id) => archived.has(id) && persisted.has(id))
        const preArchivedSessionIds = snapshot.preArchivedSessionIds.filter((id) => sessionIds.includes(id))
        if (sessionIds.length === 0) {
          await this.workspaceTable.delete(key)
          continue
        }
        if (sessionIds.length !== snapshot.sessionIds.length || preArchivedSessionIds.length !== snapshot.preArchivedSessionIds.length) {
          await this.workspaceTable.put(key, { ...snapshot, sessionIds, preArchivedSessionIds })
        }
      }
      if (typeof this.registry?.setState === 'function') {
        const remaining = [...(this.registry.archivedSessionIds ?? [])].filter((id) => persisted.has(id))
        if (remaining.length !== (this.registry.archivedSessionIds ?? []).length) await this.registry.setState({ ...this.state(), archivedSessionIds: remaining })
      }
    } catch (error) {
      this.ctx.logger?.warn?.(`dsh-archive-manager: archived workspace cleanup skipped: ${error instanceof Error ? error.message : String(error)}`)
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

  ensureNotRunning(sessionIds, workspacePath, label) {
    const running = this.runningSessionIds(sessionIds, workspacePath)
    if (running.length > 0) {
      throw errorWithCode('archive-running', `${label}包含仍在运行的会话，停止运行后才能归档（${running.length} 个）`)
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
    const answer = await this.enqueue(async () => this.setArchivedIds(current.filter((id) => id !== sessionId)))
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
      this.ensureNotRunning([sessionId], undefined, '当前会话')
      return this.setArchivedIds([...current, sessionId])
    })
  }

  async archiveWorkspace(request) {
    const workspaceId = stringId(request?.workspaceId)
    if (workspaceId === undefined) throw errorWithCode('invalid-workspace-id', '缺少工作区 ID')
    const table = await this.requireWorkspaceTable()
    const workspace = this.registry.get(workspaceId)
    if (workspace === undefined) throw errorWithCode('workspace-not-found', '工作区不存在或已被移除')
    const sessionIds = [...workspace.sessionIds]
    this.ensureNotRunning(sessionIds, workspace.path, `工作区“${workspace.title}”`)
    const currentArchived = new Set(this.registry.archivedSessionIds)
    const preArchivedSessionIds = sessionIds.filter((id) => currentArchived.has(id))
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
        this.ensureNotRunning(sessionIds, workspace.path, `工作区“${workspace.title}”`)
        const ids = new Set(this.registry.archivedSessionIds)
        for (const id of sessionIds) ids.add(id)
        await this.setArchivedIds([...ids])
      })
      return this.workspaceResult({ workspaceId })
    } catch (error) {
      try {
        await this.enqueue(async () => {
          const ids = new Set(this.registry.archivedSessionIds)
          for (const id of sessionIds) if (!preArchivedSessionIds.includes(id)) ids.delete(id)
          await this.setArchivedIds([...ids])
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
    const headers = await this.persistence.list()
    const headersById = new Map((headers ?? []).map((header) => [header.id, header]))
    answer.archivedSessions = await Promise.all(archivedIds.map(async (id) => {
      try {
        const meta = headersById.get(id) ?? this.sessions.get(id)?.header
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
    }))
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
        throw error
      }
      return this.result([sessionId])
    })
    await this.cleanDeletedState(result.deletedSessionIds)
    return result
  }

  async deleteMany(request) {
    const result = await this.enqueue(async () => {
      const archived = [...this.registry.archivedSessionIds]
      const requested = Array.isArray(request?.sessionIds) && request.sessionIds.length > 0
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
            throw error
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
        if (cache?.table && typeof cache.table.delete === 'function') await cache.table.delete(sessionId)
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
    const headers = await this.persistence.list()
    return headers.find((header) => header.id === sessionId)
  }

  async prepareDelete(sessionId) {
    await this.stopTurn(sessionId)
    await this.waitUntilSettled(sessionId, 3000)
    if (this.isAttached(sessionId)) {
      throw errorWithCode('session-release-failed', '会话已取消，但当前进程仍未释放它，暂时无法安全删除会话文件')
    }
    if (this.isWriteBusy(sessionId)) {
      throw errorWithCode('session-busy', '会话日志仍在写入，请稍后再永久删除')
    }
    const header = await this.findHeader(sessionId)
    if (header === undefined) return { sessionId, path: undefined }
    const location = this.persistence.locate(header)
    if (location === undefined || typeof location.path !== 'string' || !isAbsolute(location.path)) {
      throw errorWithCode('unsupported-persistence', '当前持久化后端没有可安全删除的会话文件')
    }
    if (location.kind !== undefined && location.kind !== 'jsonl') {
      throw errorWithCode('unsupported-persistence', `不支持删除 ${location.kind} 持久化后端的会话`)
    }
    const path = resolve(location.path)
    const fileName = basename(path)
    if (!LOG_NAMES.has(fileName)) {
      throw errorWithCode('unsafe-session-path', '会话文件路径未通过安全校验')
    }
    await this.verifyArtifact(sessionId, header, path)
    try {
      const info = await lstat(path)
      if (!info.isFile()) throw errorWithCode('unsafe-session-path', '会话目标不是普通文件')
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    return { sessionId, path }
  }

  async removePrepared({ path }) {
    if (path === undefined) return
    try {
      await rm(path, { force: false })
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    try {
      if ((await readdir(dirname(path))).length === 0) await rmdir(dirname(path))
    } catch (error) {
      if (error?.code !== 'ENOENT' && error?.code !== 'ENOTEMPTY') throw error
    }
  }

  async assertRemoved(prepared) {
    if (prepared?.path !== undefined) {
      try {
        await lstat(prepared.path)
        throw errorWithCode('delete-failed', '会话文件删除后仍然存在，已停止摘除归档标记')
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }
    }
    const headers = await this.persistence.list()
    if (headers.some((header) => header.id === prepared.sessionId)) {
      throw errorWithCode('delete-failed', '会话文件删除后仍能被持久化层看到，已停止摘除归档标记')
    }
  }

  isAttached(sessionId) {
    return this.sessions.get(sessionId) !== undefined || this.agents.get(sessionId) !== undefined
  }

  isWriteBusy(sessionId) {
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
          subagents.interrupt(sessionId, parent ?? agent)
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

  async verifyArtifact(sessionId, header, path) {
    const raw = await this.persistence.readRaw(sessionId)
    if (raw === undefined) return
    if (raw.meta?.id !== sessionId || header.id !== sessionId) {
      throw errorWithCode('session-identity-mismatch', '会话日志身份校验失败，已停止删除')
    }
    const located = this.persistence.locate(raw.meta)
    if (located?.path !== path) {
      throw errorWithCode('session-identity-mismatch', '会话日志路径校验失败，已停止删除')
    }
    if (typeof raw.content !== 'string' || raw.content.length === 0) {
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
