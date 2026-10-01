import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, access, writeFile } from 'node:fs/promises'
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
