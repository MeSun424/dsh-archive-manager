import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, access, writeFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import ArchiveManagerService from '../lib/archive-service.js'
import TYPERT from '../lib/typert.host.js'
import TYPERT_REMOTE from '../lib/typert.remote-client.js'

const fixture = async (t, compression = 'none') => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-archive-desktop-'))
  const ctx = new Context()
  const persistence = new JsonlPersistence(ctx, { root, compression })
  t.after(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  const service = Object.create(ArchiveManagerService.prototype)
  Object.assign(service, {
    persistence, sessions: { get: () => undefined, list: () => [] },
    agents: { get: () => undefined, list: () => [] },
    registry: {
      state: { initialized: true, workspaceIds: [], archivedSessionIds: [], pinnedSessionIds: [] },
      get archivedSessionIds() { return this.state.archivedSessionIds },
      list: () => [], enqueueOperation: (fn) => fn(),
      async setState(state) { this.state = state }, stopSessionActivity: async () => {},
    },
  })
  Object.defineProperty(service, 'ctx', { value: { waterfall: async () => [], get: () => undefined } })
  service.requireWorkspaceTable = async () => undefined
  const id = 'session-desktop-fixture'
  const handle = await persistence.create({ id, cwd: root, createdAt: Date.now(), version: 4, isSeeded: false })
  await handle.append([{ type: 'user/message', surfaceOp: 'append', seq: 0, time: Date.now(), data: { id: 'message-fixture', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'Desktop archive fixture' }] } }])
  await handle.flush()
  await handle.close()
  return { root, ctx, persistence, service, id }
}

test('Desktop Typert accepts host and client contributions and strict codecs', async () => {
  const ctx = new Context()
  try {
    const registry = new TypertRegistry(ctx)
    const offHost = registry.register(TYPERT)
    const offRemote = registry.remotes.register(TYPERT_REMOTE)
    assert.equal(registry.local.list().length, 9)
    assert.equal(registry.remotes.list().length, 9)
    const descriptor = registry.local.get('archiveManager/archiveSession')
    assert.equal(descriptor.parameters[0].codec.create().safeParse({ sessionId: 'session-test' }).success, true)
    assert.equal(descriptor.parameters[0].codec.create().safeParse({ sessionId: '' }).success, false)
    offRemote(); offHost()
  } finally { await ctx.fiber.dispose() }
})

test('Desktop archive removes pin and unarchive preserves other pins', async (t) => {
  const { service, id } = await fixture(t)
  service.registry.state.pinnedSessionIds = [id, 'session-other']
  await service.archiveSession({ sessionId: id })
  assert.deepEqual(service.registry.state.pinnedSessionIds, ['session-other'])
  assert.deepEqual(service.registry.archivedSessionIds, [id])
  await service.unarchive({ sessionId: id })
  assert.deepEqual(service.registry.archivedSessionIds, [])
  assert.deepEqual(service.registry.state.pinnedSessionIds, ['session-other'])
})

test('Desktop activity provider blocks archiving even without a running Agent', async (t) => {
  const { service, id } = await fixture(t)
  service.ctx.waterfall = async () => [{ kind: 'job' }]
  await assert.rejects(service.archiveSession({ sessionId: id }), { code: 'archive-running' })
  assert.deepEqual(service.registry.archivedSessionIds, [])
  await assert.rejects(service.archiveSession({ sessionId: 'session-missing' }), { code: 'session-not-found' })
})

test('Desktop v4 log metadata can be read and permanently deleted under configured root', async (t) => {
  const { persistence, service, id } = await fixture(t)
  await service.archiveSession({ sessionId: id })
  service.requireWorkspaceTable = async () => undefined
  const archived = await service.archives()
  assert.equal(archived.archivedSessions[0].title, 'Desktop archive fixture')
  const prepared = await service.prepareDelete(id)
  assert.match(prepared.path, /session\.v4\.jsonl$/)
  const deleted = await service.delete({ sessionId: id })
  assert.deepEqual(deleted.deletedSessionIds, [id])
  assert.deepEqual(service.registry.archivedSessionIds, [])
  assert.equal((await persistence.list()).length, 0)
  await assert.rejects(access(prepared.directory), { code: 'ENOENT' })
  assert.equal(persistence.tracker.writers.has(id), false)
})

test('Desktop kernel lease protects another backend owner and can retry after release', async (t) => {
  const { root, persistence, service, id } = await fixture(t)
  const prepared = await service.prepareDelete(id)
  const otherContext = new Context()
  try {
    const other = new JsonlPersistence(otherContext, { root, compression: 'none' })
    const writer = await other.open(id, 'write')
    await assert.rejects(service.removePrepared(prepared), { code: 'session-busy' })
    await access(prepared.path)
    assert.equal(persistence.tracker.writers.has(id), false)
    await writer.close()
    await service.removePrepared(prepared)
    await service.assertRemoved(prepared)
  } finally { await otherContext.fiber.dispose() }
})

test('Desktop deletion refuses directories containing unrelated files', async (t) => {
  const { service, id } = await fixture(t)
  const prepared = await service.prepareDelete(id)
  await writeFile(join(dirname(prepared.path), 'keep.txt'), 'unrelated')
  await assert.rejects(service.removePrepared(prepared), { code: 'unsafe-session-path' })
  await access(prepared.path)
})

test('Desktop compressed V4 logs retain metadata and support deletion', async (t) => {
  const { service, id } = await fixture(t, 'zstd')
  await service.archiveSession({ sessionId: id })
  const archived = await service.archives()
  assert.equal(archived.archivedSessions[0].title, 'Desktop archive fixture')
  const prepared = await service.prepareDelete(id)
  assert.match(prepared.path, /session\.v4\.jsonl\.zstd$/)
  await service.delete({ sessionId: id })
  await service.assertRemoved(prepared)
})

test('Workspace archive and restore retain project and previously archived membership', async (t) => {
  const { root, service, id } = await fixture(t)
  const records = new Map()
  records.put = async (key, value) => records.set(key, value)
  service.workspaceTable = records
  service.requireWorkspaceTable = async () => records
  const priorId = 'session-already-archived'
  const workspace = {
    id: 'workspace-fixture', path: root, title: 'Desktop fixture',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    sessionIds: [id, priorId],
    async attachSession(sessionId) { if (!this.sessionIds.includes(sessionId)) this.sessionIds.unshift(sessionId) },
  }
  let current = workspace
  service.registry.get = () => current
  service.registry.delete = async () => { current = undefined }
  service.registry.create = async () => { current = { ...workspace, sessionIds: [] }; return current }
  service.registry.state.workspaceIds = [workspace.id]
  service.registry.state.archivedSessionIds = [priorId]
  service.registry.state.pinnedSessionIds = [id]
  await service.archiveWorkspace({ workspaceId: workspace.id })
  assert.deepEqual(service.registry.archivedSessionIds, [priorId, id])
  assert.deepEqual(service.registry.state.pinnedSessionIds, [])
  current = undefined
  const restored = await service.restoreWorkspace({ workspaceId: workspace.id })
  assert.equal(restored.workspacePath, root)
  assert.deepEqual(current.sessionIds, [id, priorId])
  assert.deepEqual(service.registry.archivedSessionIds, [priorId])
  assert.equal(records.size, 0)
})

test('Empty-shell cleanup keeps pinned chats and compressed conversation content', async (t) => {
  const { root, persistence, service, id } = await fixture(t, 'zstd')
  const pinnedId = 'session-pinned-empty'
  const emptyId = 'session-detached-empty'
  for (const sessionId of [pinnedId, emptyId]) {
    const handle = await persistence.create({ id: sessionId, cwd: root, createdAt: Date.now(), version: 4, isSeeded: false })
    await handle.flush()
    await handle.close()
  }
  service.registry.pinnedSessionIds = [pinnedId]
  const result = await service.pruneEmptyUngroupedSessions()
  assert.deepEqual(result.deletedSessionIds, [emptyId])
  assert.deepEqual((await persistence.list()).map((item) => item.header.id).sort(), [id, pinnedId].sort())
})

test('Unarchive does not overwrite a concurrent archive from another caller', async (t) => {
  const { service, id } = await fixture(t)
  await service.archiveSession({ sessionId: id })
  service.restoreWorkspaceForSession = async () => {
    service.registry.state.archivedSessionIds.push('session-concurrent')
    return { workspaceMissing: false, restoredSessionIds: [id] }
  }
  await service.unarchive({ sessionId: id })
  assert.deepEqual(service.registry.archivedSessionIds, ['session-concurrent'])
})

test('Startup cleanup preserves unreadable archived sessions and empty workspace snapshots', async (t) => {
  const { service, id } = await fixture(t)
  const records = new Map([['workspace-empty', { workspaceId: 'workspace-empty', sessionIds: [], preArchivedSessionIds: [] }]])
  records.put = async (key, value) => records.set(key, value)
  service.workspaceTable = records
  service.registry.state.archivedSessionIds = [id, 'session-unreadable']
  await service.pruneArchivedWorkspaceSnapshots()
  assert.deepEqual(service.registry.archivedSessionIds, [id, 'session-unreadable'])
  assert.equal(records.has('workspace-empty'), true)
})

test('Restore to a new directory honors the target even if the old workspace is still registered', async (t) => {
  const { root, service, id } = await fixture(t)
  let oldAttached = false
  const old = { id: 'workspace-old', path: root, title: 'old', async attachSession() { oldAttached = true } }
  const target = await mkdtemp(join(tmpdir(), 'dsh-archive-target-'))
  t.after(() => rm(target, { recursive: true, force: true }))
  service.registry.get = () => old
  service.registry.create = async (path) => ({ id: 'workspace-new', path, title: 'new', async mutate(fn) { fn({ sessionIds: [] }) } })
  service.registry.sessionPaths = new Map([[id, root]])
  const restored = await service.restoreWorkspaceSnapshot({ workspaceId: old.id, path: root, title: 'old', sessionIds: [id] }, undefined, target)
  assert.equal(restored.workspacePath, target)
  assert.equal(restored.workspaceRelocated, true)
  assert.equal(oldAttached, false)
})

test('Deletion refuses backend locations outside the configured session root', async (t) => {
  const { service, id } = await fixture(t)
  const outside = await mkdtemp(join(tmpdir(), 'dsh-archive-outside-'))
  t.after(() => rm(outside, { recursive: true, force: true }))
  const path = join(outside, 'session.jsonl')
  await writeFile(path, 'must remain')
  service.findSessionDirectory = async () => undefined
  service.resolveSessionLog = async () => ({ kind: 'jsonl', path })
  await assert.rejects(service.prepareDelete(id), { code: 'unsafe-session-path' })
  await access(path)
})

test('Empty-shell deletion rechecks content after acquiring the writer lease', async (t) => {
  const { root, persistence, service } = await fixture(t)
  const id = 'session-growing-shell'
  let handle = await persistence.create({ id, cwd: root, version: 4, isSeeded: false, createdAt: Date.now() })
  await handle.flush(); await handle.close()
  const prepared = await service.prepareDelete(id, { allowEmpty: true })
  handle = await persistence.open(id, 'write')
  await handle.append([{ type: 'user/message', surfaceOp: 'append', seq: 0, time: Date.now(), data: { id: 'message-new', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'must remain' }] } }])
  await handle.flush(); await handle.close()
  await assert.rejects(service.removePrepared(prepared), { code: 'session-not-empty' })
  await access(prepared.path)
})

test('Explicit empty bulk-delete selection never expands to all archived sessions', async (t) => {
  const { service, id, persistence } = await fixture(t)
  await service.archiveSession({ sessionId: id })
  const result = await service.deleteMany({ sessionIds: [] })
  assert.deepEqual(result.deletedSessionIds, [])
  assert.equal((await persistence.list()).length, 1)
})

test('Workspace archive completes host removal and is safe to retry', async (t) => {
  const { service, root, id } = await fixture(t)
  const records = new Map()
  records.put = async (key, value) => records.set(key, value)
  service.workspaceTable = records
  service.requireWorkspaceTable = async () => records
  let workspace = { id: 'project', path: root, title: 'Project', sessionIds: [id] }
  service.registry.get = () => workspace
  service.registry.state.workspaceIds = ['project']
  let deletes = 0
  service.registry.delete = async () => { deletes++; workspace = undefined }
  await service.archiveWorkspace({ workspaceId: 'project' })
  await service.archiveWorkspace({ workspaceId: 'project' })
  assert.equal(deletes, 1)
  assert.equal(records.size, 1)
  assert.deepEqual(service.registry.archivedSessionIds, [id])
})

test('Failed workspace removal restores pins and previously archived membership', async (t) => {
  const { service, root, id } = await fixture(t)
  const records = new Map()
  records.put = async (key, value) => records.set(key, value)
  service.workspaceTable = records
  service.requireWorkspaceTable = async () => records
  service.registry.get = () => ({ id: 'project', path: root, title: 'Project', sessionIds: [id, 'previous'] })
  service.registry.state.workspaceIds = ['project']
  service.registry.state.archivedSessionIds = ['previous']
  service.registry.state.pinnedSessionIds = [id, 'unrelated']
  service.registry.delete = async () => { throw new Error('storage unavailable') }
  await assert.rejects(service.archiveWorkspace({ workspaceId: 'project' }), /storage unavailable/)
  assert.deepEqual(service.registry.archivedSessionIds, ['previous'])
  assert.deepEqual(service.registry.state.pinnedSessionIds.sort(), [id, 'unrelated'].sort())
  assert.equal(records.size, 0)
})

test('Deleted files with an index write failure report partial deletion and support retry', async (t) => {
  const { service, persistence, id } = await fixture(t)
  await service.archiveSession({ sessionId: id })
  const original = service.registry.setState
  service.registry.setState = async () => { throw new Error('storage unavailable') }
  await assert.rejects(service.delete({ sessionId: id }), { code: 'delete-cleanup-incomplete' })
  assert.equal((await persistence.list()).length, 0)
  assert.deepEqual(service.registry.archivedSessionIds, [id])
  service.registry.setState = original
  const answer = await service.delete({ sessionId: id })
  assert.deepEqual(answer.deletedSessionIds, [id])
  assert.deepEqual(service.registry.archivedSessionIds, [])
})

test('Large session histories retain their title and timestamps', async (t) => {
  const { service, id } = await fixture(t)
  service.registry.state.archivedSessionIds = [id]
  const events = Array.from({ length: 180000 }, (_, time) => ({ type: 'session/title', data: { title: 'Long history' }, time }))
  service.persistence = {
    list: async () => [{ header: { id, createdAt: 1 } }],
    open: async () => ({ header: { id, createdAt: 1 }, read: async () => ({ events }), close: async () => {} }),
  }
  const answer = await service.archives()
  assert.equal(answer.archivedSessions[0].title, 'Long history')
  assert.equal(answer.archivedSessions[0].updatedAt, 179999)
})

test('Session cleanup refuses paths that escape through a symlink', async (t) => {
  const { service, root, id } = await fixture(t)
  const outside = await mkdtemp(join(tmpdir(), 'dsh-archive-symlink-'))
  t.after(() => rm(outside, { recursive: true, force: true }))
  await mkdir(join(outside, id))
  await symlink(outside, join(root, 'linked-parent'))
  await assert.rejects(service.assertSafeSessionDirectory(join(root, 'linked-parent', id), id), { code: 'unsafe-session-path' })
  await access(join(outside, id))
})

test('Disposal prevents scheduled and queued maintenance from deleting files', async (t) => {
  const { service, root, persistence } = await fixture(t)
  const id = 'session-empty-disposal'
  const handle = await persistence.create({ id, cwd: root, version: 4, isSeeded: false, createdAt: Date.now() })
  await handle.flush(); await handle.close()
  const prepared = await service.prepareDelete(id, { allowEmpty: true })
  let ran = false
  service.scheduleMaintenance(() => { ran = true }, 5)
  service.disposed = true
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(ran, false)
  assert.equal(service.maintenanceTimers.size, 0)
  await assert.rejects(service.removePrepared(prepared), { code: 'archive-service-unavailable' })
  await access(prepared.path)
})

test('Archive metadata reads have bounded concurrency and retain list order', async (t) => {
  const { service } = await fixture(t)
  const ids = Array.from({ length: 16 }, (_, index) => `session-${index}`)
  service.registry.state.archivedSessionIds = ids
  let active = 0
  let maximum = 0
  service.persistence = {
    list: async () => ids.map((id) => ({ header: { id, createdAt: 1 } })),
    open: async (id) => {
      active++
      maximum = Math.max(maximum, active)
      return {
        header: { id, createdAt: 1 },
        read: async () => { await new Promise((resolve) => setTimeout(resolve, 2)); return { events: [] } },
        close: async () => { active-- },
      }
    },
  }
  const answer = await service.archives()
  assert.equal(maximum, 4)
  assert.equal(active, 0)
  assert.deepEqual(answer.archivedSessions.map((item) => item.id), ids)
})
