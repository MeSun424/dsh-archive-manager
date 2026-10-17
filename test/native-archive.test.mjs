import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import { Context } from '@deepseek-ai/cordis'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import ArchiveManagerService from '../lib/archive-service.js'
import TYPERT from '../lib/typert.host.js'
import TYPERT_REMOTE from '../lib/typert.remote-client.js'

const runtime = process.env.DSH_DESKTOP_RUNTIME
const id = 'session-native-archive'

function nativeHost(t) {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  const registry = Object.create(WorkspaceRegistry.prototype)
  Object.defineProperty(registry, 'ctx', { value: ctx })
  Object.assign(registry, {
    operationTail: Promise.resolve(),
    state: { initialized: true, workspaceIds: [], archivedSessionIds: [], pinnedSessionIds: [id] },
    global: { set: async () => {} },
    // Public archive logic, queue, activity events and state writes are real.
    // Only stored-session discovery and the durable medium are controlled.
    sessionKnown: async (sessionId) => sessionId === id,
  })
  const service = Object.create(ArchiveManagerService.prototype)
  service.registry = registry
  service.requireWorkspaceTable = async () => undefined
  return { ctx, service, registry }
}

test('Native activity refusal preserves dialog details and never stops work without confirmation', async (t) => {
  const { ctx, service, registry } = nativeHost(t)
  const activity = [{ kind: 'job', items: [{ id: 'job-native', label: 'Background work' }] }]
  let stops = 0
  ctx.on('workspace/session-activity', async () => activity)
  ctx.on('workspace/session-stop', () => { stops++ })
  await assert.rejects(service.archiveSession({ sessionId: id }), (error) => {
    assert.equal(error.code, 'workspace/session-active')
    assert.deepEqual(error.details, { sessionId: id, activity })
    return true
  })
  assert.equal(stops, 0)
  assert.deepEqual(registry.archivedSessionIds, [])
  assert.deepEqual(registry.state.pinnedSessionIds, [id])
})

test('Confirmed native archive requests stop once and remove the pin; retry is idempotent', { timeout: 2000 }, async (t) => {
  const { ctx, service, registry } = nativeHost(t)
  let stops = 0
  ctx.on('workspace/session-activity', async () => [{ kind: 'turn' }])
  ctx.on('workspace/session-stop', () => { stops++ })
  const result = await service.archiveSession({ sessionId: id, stopActivity: true })
  assert.deepEqual(result.archivedSessionIds, [id])
  assert.deepEqual(registry.state.pinnedSessionIds, [])
  assert.equal(stops, 1)
  await service.archiveSession({ sessionId: id, stopActivity: true })
  assert.equal(stops, 1)
})

test('Unknown native sessions keep a structured not-found error', async (t) => {
  const { service, registry } = nativeHost(t)
  await assert.rejects(service.archiveSession({ sessionId: 'session-absent' }), { code: 'session/not-found' })
  assert.deepEqual(registry.archivedSessionIds, [])
})

test('Legacy archive methods cannot bypass activity checks or silently accept stop requests', async () => {
  const service = Object.create(ArchiveManagerService.prototype)
  const agent = { id, status: 'running' }
  let nativeCalled = false
  service.registry = {
    archivedSessionIds: [],
    archiveSession: async () => { nativeCalled = true },
    enqueueOperation: async (operation) => operation(),
  }
  service.agents = { list: () => [agent], get: () => agent }
  service.requireWorkspaceTable = async () => undefined
  service.findHeader = async () => ({ id })
  await assert.rejects(service.archiveSession({ sessionId: id }), { code: 'archive-running' })
  await assert.rejects(service.archiveSession({ sessionId: id, stopActivity: true }), { code: 'archive-stop-unsupported' })
  assert.equal(nativeCalled, false)
  assert.deepEqual(service.registry.archivedSessionIds, [])
})

test('Archive wire codecs accept only explicit boolean stop requests on host and client', () => {
  for (const contribution of [TYPERT, TYPERT_REMOTE]) {
    const request = (contribution.invocations ?? contribution.descriptors).find((item) => item.method === 'archiveSession').parameters[0].codec.create()
    assert.equal(request.safeParse({ sessionId: id }).success, true)
    assert.equal(request.safeParse({ sessionId: id, stopActivity: true }).success, true)
    assert.equal(request.safeParse({ sessionId: id, stopActivity: false }).success, true)
    assert.equal(request.safeParse({ sessionId: id, stopActivity: 'true' }).success, false)
  }
})

function clientModule(filename, requireModule) {
  let exported
  vm.runInNewContext(readFileSync(filename, 'utf8'), {
    window: { __ModuleLoader__: { load(entry) { exported = entry.factory(requireModule) } } },
    Error, console,
  }, { filename: String(filename) })
  return exported
}

async function mountClient(t, call) {
  const module = clientModule(new URL('../lib/client.js', import.meta.url), (name) => {
    assert.equal(name, 'react')
    return { createElement() {} }
  })
  const disposers = []
  const ctx = {
    // No browser DOM is mounted. Exercise the built client command bridge.
    effect(factory, label) {
      if (label.endsWith('workspace archive interception')) disposers.push(factory())
    },
    remote: { $mount: async () => () => {} },
    connection: { rpc: { call } },
    workspaces: { delete: async () => {}, archiveSession: async () => {}, model: { replaceArchived() {} } },
    slots: { inject() {} },
  }
  const original = ctx.workspaces.archiveSession
  await module.apply(ctx)
  t.after(() => {
    for (const dispose of disposers.reverse()) dispose()
    assert.equal(ctx.workspaces.archiveSession, original)
  })
  return ctx
}

test('Built client preserves native activity details, and cancelled confirmation sends no stop request', { skip: !runtime }, async (t) => {
  const source = readFileSync(join(runtime, 'node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/client.js'), 'utf8')
  const match = source.match(/function activeSessionRefusal\(reason\) \{[\s\S]*?\n\t\t\}/)
  assert.ok(match, 'current native activity-dialog predicate exists')
  const nativeRefusal = vm.runInNewContext(`(${match[0]})`, { Error })
  const activity = [{ kind: 'turn' }]
  const requests = []
  const ctx = await mountClient(t, async (_path, _method, data) => {
    requests.push(data.args.request)
    return { ok: false, error: { code: 'workspace/session-active', message: 'work remains', details: { sessionId: id, activity } } }
  })
  await assert.rejects(ctx.workspaces.archiveSession(id), (error) => {
    assert.deepEqual(nativeRefusal(error), activity)
    return true
  })
  assert.deepEqual(JSON.parse(JSON.stringify(requests)), [{ sessionId: id }])
})

test('Built client passes confirmed stop and synchronizes the archive projection', { skip: !runtime }, async (t) => {
  const requests = []
  const ctx = await mountClient(t, async (_path, method, data) => {
    assert.equal(method, 'archiveManager/archiveSession')
    requests.push(data.args.request)
    return { ok: true, value: { archivedSessionIds: [id] } }
  })
  let projected
  ctx.workspaces.model.replaceArchived = (ids) => { projected = ids }
  await ctx.workspaces.archiveSession(id, { stopActivity: true })
  assert.deepEqual(JSON.parse(JSON.stringify(requests)), [{ sessionId: id, stopActivity: true }])
  assert.deepEqual(projected, [id])
})

test('Current Desktop accepts plugin requirements without compatibility exemptions', { skip: !runtime }, async () => {
  const { evaluatePluginCompatibility } = await import('@deepseek-ai/dsh-app-boot')
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)))
  assert.equal(evaluatePluginCompatibility(manifest), undefined)
})
