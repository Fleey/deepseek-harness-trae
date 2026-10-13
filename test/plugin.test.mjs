// Unit tests for the pure pieces: catalog, config schema, message translation,
// SSE decoding, the repetition guard, and the text tool-call sniffer.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as plugin from '../lib/index.js'

test('config: only the PAT reference is user-facing, with a built-in default', () => {
  const config = plugin.Config({})
  assert.equal(config.provider, 'trae')
  assert.equal(config.displayName, 'Trae')
  assert.equal(config.patEnv.get(), 'TRAE_PAT')
  assert.equal(config.host, 'https://api.enterprise.trae.cn')
  assert.equal(config.ideVersionCode, '20260908')
})

test('apply registers the provider route and a Models-page row', () => {
  const routes = {}
  const directory = []
  const ctx = {
    logger: { info() {}, warn() {} },
    effect() {}, on() {}, get: () => undefined,
    inject: () => {}, fiber: { entry: { options: { id: 'trae2api' } } },
    llm: {
      registerAdapter: (r, a) => { for (const k of r) routes[k] = a },
      registerConfigurableProviders: (e) => { directory.push(...e) },
    },
  }
  plugin.apply(ctx, plugin.Config({}))
  assert.ok(routes.trae, 'adapter registered on the trae route')
  assert.equal(routes.trae.providerInfo('trae').name, 'Trae')
  assert.deepEqual(directory, [{ provider: 'trae', displayName: 'Trae', settingsNs: 'trae2api', settingsPath: [] }])
})

test('shipped bundle: hard-coded windows and thinking levels reach the agent loop', async () => {
  const routes = {}
  const ctx = {
    logger: { info() {}, warn() {} },
    effect() {}, on() {}, get: () => undefined,
    inject: () => {}, fiber: { entry: { options: { id: 'trae2api' } } },
    llm: { registerAdapter: (r, a) => { for (const k of r) routes[k] = a }, registerConfigurableProviders() {} },
  }
  plugin.apply(ctx, plugin.Config({}))
  const adapter = routes.trae

  // Windows the IDE capability table reports, not the catalog's inflated ones.
  assert.equal((await adapter.resolveModel('trae', 'GLM-5.3')).context.contextWindow, 1000000)
  assert.equal((await adapter.resolveModel('trae', 'Doubao-Seed-Evolving')).context.contextWindow, 1000000)
  assert.equal((await adapter.resolveModel('trae', 'Doubao-Seed-2.1-Turbo')).context.contextWindow, 256000)
  assert.equal((await adapter.resolveModel('trae', 'GLM-5.2')).context.contextWindow, 200000)

  // Thinking levels are selectable per model.
  const kimi = await adapter.resolveModel('trae', 'Kimi-K3')
  assert.deepEqual(kimi.reasoning.efforts.map(e => e.id), ['light', 'high', 'extra_high'])
  assert.equal(kimi.reasoning.defaultEffort, 'extra_high')
  assert.equal((await adapter.resolveModel('trae', 'GLM-5V-Turbo')).reasoning, undefined)
})
