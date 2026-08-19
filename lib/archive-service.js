import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { lstat, readdir, rm, rmdir } from 'node:fs/promises'
import { basename, dirname, isAbsolute, resolve } from 'node:path'
import TYPERT from './typert.host.js'

const LOG_NAMES = new Set(['session.jsonl', 'session.jsonl.zstd'])

function errorWithCode(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function stringId(value) {
  return typeof value === 'string' && value.length > 0 ? value : undefined
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
  static inject = ['workspaceRegistry', 'sessionPersistence', 'sessions', 'agents']

  constructor(ctx) {
    super(ctx, 'archiveManager')
    this.registry = ctx.workspaceRegistry
    this.persistence = ctx.sessionPersistence
    this.sessions = ctx.sessions
    this.agents = ctx.agents
  }

  result(deletedSessionIds = [], skipped = []) {
    return {
      archivedSessionIds: [...this.registry.archivedSessionIds],
      deletedSessionIds: [...deletedSessionIds],
      skipped: skipped.map((item) => ({ ...item })),
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
    const sessionId = stringId(request?.sessionId)
    if (sessionId === undefined) throw errorWithCode('invalid-session-id', '缺少会话 ID')
    return this.enqueue(async () => {
      const current = [...this.registry.archivedSessionIds]
      if (!current.includes(sessionId)) return this.result()
      return this.setArchivedIds(current.filter((id) => id !== sessionId))
    })
  }

  async delete(request) {
    const sessionId = stringId(request?.sessionId)
    if (sessionId === undefined) throw errorWithCode('invalid-session-id', '缺少会话 ID')
    const result = await this.enqueue(async () => {
      const archived = [...this.registry.archivedSessionIds]
      if (!archived.includes(sessionId)) return this.result()
      const prepared = await this.prepareDelete(sessionId)
      await this.setArchivedIds(archived.filter((id) => id !== sessionId))
      try {
        await this.removePrepared(prepared)
      } catch (error) {
        await this.setArchivedIds(archived)
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

      const preparedIds = new Set(prepared.map((item) => item.sessionId))
      await this.setArchivedIds(archived.filter((id) => !preparedIds.has(id)))
      const deleted = []
      for (const item of prepared) {
        try {
          await this.removePrepared(item)
          deleted.push(item.sessionId)
        } catch (error) {
          skipped.push({
            sessionId: item.sessionId,
            code: typeof error?.code === 'string' ? error.code : 'delete-failed',
            message: error instanceof Error ? error.message : String(error),
          })
        }
      }
      if (deleted.length !== prepared.length) {
        const deletedSet = new Set(deleted)
        await this.setArchivedIds(archived.filter((id) => !deletedSet.has(id)))
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
      if (failures.length > 0) {
        this.ctx.logger?.warn?.(`dsh-archive-manager: derived state cleanup failed for ${sessionId}: ${failures.join('; ')}`)
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
    if (this.sessions.get(sessionId) !== undefined || this.agents.get(sessionId) !== undefined) {
      throw errorWithCode('session-running', '会话正在运行，请先停止后再永久删除')
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
    // Force the persistence backend to parse the header it just read. This
    // catches an unexpected non-JSONL artifact before the filesystem mutation.
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
markRemote('delete')
markRemote('deleteMany')

export { TYPERT }
export default ArchiveManagerService
