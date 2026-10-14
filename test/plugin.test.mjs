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

test('apply serves the remaining quota on a login-gated Connection route', async () => {
  const routes = new Map()
  const ctx = {
    logger: { info() {}, warn() {} },
    effect() {}, on() {},
    get: (name) => name === 'credentials' ? { resolve: async () => ({ value: 'eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjQxMDI0NDQ4MDB9.c2ln' }) } : undefined,
    inject: (deps, cb) => {
      if (deps.includes('connection')) cb({ connection: { fetch: { register: (route) => { routes.set(route.path, route) } } } })
    },
    fiber: { entry: { options: { id: 'trae2api' } } },
    llm: { registerAdapter() {}, registerConfigurableProviders() {} },
  }
  plugin.apply(ctx, plugin.Config({}))
  const route = routes.get(plugin.QUOTA_ROUTE)
  assert.ok(route, 'quota route registered')
  assert.equal(plugin.QUOTA_ROUTE, '/api/dsh-trae2api/quota')
  assert.deepEqual(route.methods, ['GET'])

  const original = globalThis.fetch
  const seen = []
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), headers: init.headers })
    if (String(url).endsWith('/CheckLogin')) return Response.json({ code: 0, Data: { IsLogin: true, AIPayHost: 'https://pay.example' } })
    return Response.json({ data: { user_entitlement_pack_list: [{ entitlement_base_info: { quota: { basic_usage_limit: 10 } }, usage: { basic_usage_amount: 4 } }] } })
  }
  try {
    const ok = await (await route.fetch(new Request('http://127.0.0.1/api/dsh-trae2api/quota'))).json()
    assert.equal(ok.ok, true)
    assert.equal(ok.value.remaining, 6)
    // CheckLogin on the configured API host, with the identity headers…
    assert.equal(seen[0].url, 'https://api.enterprise.trae.cn/cloudide/api/v3/trae/CheckLogin')
    assert.match(seen[0].headers['x-cloudide-token'], /^eyJ/)
    assert.equal(seen[0].headers['x-ide-version-code'], '20260908')
    // …then the pay host it names.
    assert.equal(seen[1].url, 'https://pay.example/trae/api/v1/pay/ide_user_ent_usage')
    assert.match(seen[1].headers.authorization, /^Cloud-IDE-JWT eyJ/)

    globalThis.fetch = async () => { throw new Error('offline') }
    const cached = await (await route.fetch(new Request('http://127.0.0.1/api/dsh-trae2api/quota'))).json()
    assert.equal(cached.ok, true, 'within a minute the cached answer is served')
    const failed = await (await route.fetch(new Request('http://127.0.0.1/api/dsh-trae2api/quota?refresh=1'))).json()
    assert.equal(failed.ok, false)
    assert.match(failed.error, /无法连接 https:\/\/pay\.example.*offline/)
  } finally { globalThis.fetch = original }
})

test('apply serves next-input suggestions for finished Trae turns', async () => {
  const routes = new Map()
  const adapters = {}
  const ctx = {
    logger: { info() {}, warn() {} },
    effect() {}, on() {},
    get: (name) => name === 'credentials' ? { resolve: async () => ({ value: 'eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjQxMDI0NDQ4MDB9.c2ln' }) } : undefined,
    inject: (deps, cb) => {
      if (deps.includes('connection')) cb({ connection: { fetch: { register: (route) => { routes.set(route.path, route) } } } })
    },
    fiber: { entry: { options: { id: 'trae2api' } } },
    llm: { registerAdapter: (r, a) => { for (const k of r) adapters[k] = a }, registerConfigurableProviders() {} },
  }
  plugin.apply(ctx, plugin.Config({}))
  const route = routes.get(plugin.SUGGESTION_ROUTE)
  assert.ok(route, 'suggestion route registered')
  const ask = async (query) => (await route.fetch(new Request(`http://127.0.0.1${plugin.SUGGESTION_ROUTE}${query}`))).json()
  assert.deepEqual(await ask('?session=s1'), { ok: true, value: null })

  const sse = (text) => new Response(`event: output\ndata: ${JSON.stringify({ response: text })}\n\n`, { status: 200 })
  const original = globalThis.fetch
  const bodies = []
  globalThis.fetch = async (url, init) => {
    bodies.push(JSON.parse(init.body))
    return sse(bodies.length === 1 ? 'Done, tests pass.' : '提交一下')
  }
  try {
    for await (const _ of adapters.trae.stream({
      model: 'GLM-5.3', sessionId: 's1', tools: [{ name: 'bash', description: '', parameters: {} }],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'fix it' }] }],
    })) { /* consume */ }
    const got = await ask('?session=s1&wait=2000')
    assert.equal(got.ok, true)
    assert.equal(got.value.text, '提交一下')
    assert.equal(bodies.length, 2)
    assert.match(bodies[1].messages[1].content[0].text, /fix it[\s\S]*Done, tests pass\./)
  } finally { globalThis.fetch = original }
})

test('suggestion events reach report/clients by default, with the GetUserInfo user id', async () => {
  const setup = (overrides) => {
    const routes = new Map()
    const adapters = {}
    const ctx = {
      logger: { info() {}, warn() {} },
      effect() {}, on() {},
      get: (name) => name === 'credentials' ? { resolve: async () => ({ value: 'eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjQxMDI0NDQ4MDB9.c2ln' }) } : undefined,
      inject: (deps, cb) => {
        if (deps.includes('connection')) cb({ connection: { fetch: { register: (route) => { routes.set(route.path, route) } } } })
      },
      fiber: { entry: { options: { id: 'trae2api' } } },
      llm: { registerAdapter: (r, a) => { for (const k of r) adapters[k] = a }, registerConfigurableProviders() {} },
    }
    plugin.apply(ctx, plugin.Config(overrides))
    return { routes, adapters }
  }
  const run = async ({ routes, adapters }, privacy = false) => {
    const seen = []
    const original = globalThis.fetch
    globalThis.fetch = async (url, init) => {
      seen.push(String(url))
      if (String(url).endsWith('/GetUserInfo')) {
        return Response.json({ code: 0, Data: { UserInfo: { UserID: '777' }, PrivacyMode: privacy } })
      }
      if (String(url).endsWith('/report/clients')) {
        seen.push(JSON.parse(init.body.get('body')))
        return Response.json({ code: 0 })
      }
      const first = seen.filter(u => typeof u === 'string' && u.endsWith('/llm_raw_chat')).length === 1
      return new Response(`event: output\ndata: ${JSON.stringify({ response: first ? 'Done.' : '提交一下' })}\n\n`, { status: 200 })
    }
    try {
      for await (const _ of adapters.trae.stream({
        model: 'GLM-5.3', sessionId: 's1', tools: [{ name: 'bash', description: '', parameters: {} }],
        messages: [{ role: 'user', content: [{ type: 'text', text: 'fix it' }] }],
      })) { /* consume */ }
      const get = await (await routes.get(plugin.SUGGESTION_ROUTE).fetch(new Request(`http://127.0.0.1${plugin.SUGGESTION_ROUTE}?session=s1&wait=2000`))).json()
      const post = async (action) => (await routes.get(plugin.SUGGESTION_EVENT_ROUTE).fetch(new Request(`http://127.0.0.1${plugin.SUGGESTION_EVENT_ROUTE}`, {
        method: 'POST', body: JSON.stringify({ session: 's1', id: get.value.id, action }),
      }))).json()
      return { seen, shown: await post('shown'), accept: await post('accept') }
    } finally { globalThis.fetch = original }
  }

  assert.equal(plugin.Config({}).reportCue, true, 'on by default')
  const off = await run(setup({ reportCue: false }))
  assert.deepEqual([off.shown.reported, off.accept.reported], [false, false])
  assert.ok(!off.seen.some(u => typeof u === 'string' && u.endsWith('/report/clients')))

  // The user id comes from GetUserInfo on the console host, asked once.
  const auto = await run(setup({}))
  assert.deepEqual([auto.shown.reported, auto.accept.reported], [true, true])
  assert.equal(auto.seen.filter(u => u === 'https://console.enterprise.trae.cn/cloudide/api/v3/trae/GetUserInfo').length, 1)
  const bodies = auto.seen.filter(x => typeof x === 'object')
  assert.deepEqual(bodies.map(b => b.events[0].event), ['code_gen_shown', 'code_gen_accept'])
  assert.equal(bodies[1].env_metadata.user_id, '777')
  assert.equal(JSON.parse(bodies[1].events[0].payload).accept_content, '提交一下')

  // A configured id overrides GetUserInfo's.
  const pinned = await run(setup({ reportCue: true, cueUserId: '42' }))
  assert.equal(pinned.seen.filter(x => typeof x === 'object')[1].env_metadata.user_id, '42')

  // Privacy mode: nothing goes out, configured id or not.
  const quiet = await run(setup({ reportCue: true, cueUserId: '42' }), true)
  assert.deepEqual([quiet.shown.reported, quiet.accept.reported], [false, false])
  assert.ok(!quiet.seen.some(u => typeof u === 'string' && u.endsWith('/report/clients')))

  const bad = await (await setup({}).routes.get(plugin.SUGGESTION_EVENT_ROUTE).fetch(new Request('http://127.0.0.1/x', { method: 'POST', body: '{"action":"nope"}' }))).json()
  assert.equal(bad.ok, false)
})
