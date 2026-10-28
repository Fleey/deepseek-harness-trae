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
  // The model list is asked for, not shipped: upstream, then traecli's cache.
  assert.equal(config.catalogSource, 'auto')
  assert.equal(config.modelsCacheFile, '')
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
  // `builtin` keeps these tests off the network and off whatever traecli last
  // cached on the machine running them; the live sources have their own tests.
  plugin.apply(ctx, plugin.Config({ catalogSource: 'builtin' }))
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
  // `builtin` keeps these tests off the network and off whatever traecli last
  // cached on the machine running them; the live sources have their own tests.
  plugin.apply(ctx, plugin.Config({ catalogSource: 'builtin' }))
  const adapter = routes.trae

  // Windows as the live catalog states them: Max routes at 1M, the Doubao
  // family at its own standard window since none of them has Max.
  assert.equal((await adapter.resolveModel('trae', 'GLM-5.3')).context.contextWindow, 1000000)
  assert.equal((await adapter.resolveModel('trae', 'GLM-5.2')).context.contextWindow, 1000000)
  assert.equal((await adapter.resolveModel('trae', 'Doubao-Seed-Evolving')).context.contextWindow, 184000)
  assert.equal((await adapter.resolveModel('trae', 'Doubao-Seed-2.1-Turbo')).context.contextWindow, 200000)

  // Thinking levels are selectable per model.
  const kimi = await adapter.resolveModel('trae', 'Kimi-K3')
  assert.deepEqual(kimi.reasoning.efforts.map(e => e.id), ['light', 'high', 'extra_high'])
  assert.equal(kimi.reasoning.defaultEffort, 'extra_high')
  assert.equal((await adapter.resolveModel('trae', 'MiniMax-M3')).reasoning, undefined)
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
  // `builtin` keeps these tests off the network and off whatever traecli last
  // cached on the machine running them; the live sources have their own tests.
  plugin.apply(ctx, plugin.Config({ catalogSource: 'builtin' }))
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

test('apply serves the model catalog, refreshed from Trae on request', async () => {
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
  const original = globalThis.fetch
  const seen = []
  // One config entry is enough to prove the plugin asks Trae and parses it.
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), headers: init.headers, body: init.body })
    return Response.json({
      function_configs: [{
        function: 'chat',
        config_info_list: [{
          config_name: 'glm-5.3',
          config_switch: true,
          is_invisible_to_user: false,
          context_window_tokens: { dev: 200000, max: 1000000 },
          display_config: { display_name: 'GLM-5.3', max_mode: true, multimodal: false },
          reasoning_effort_config: { default_level: 'high', options: ['light', 'high'], support_thinking: true },
          model_detail_list: [
            { model_name: 'glm-5.3__dev', prompt_max_tokens: 168000, max_tokens: 32000 },
            { model_name: 'glm-5.3__max', prompt_max_tokens: 936000, max_tokens: 64000 },
          ],
        }],
      }],
    })
  }
  try {
    plugin.apply(ctx, plugin.Config({}))
    const route = routes.get(plugin.CATALOG_ROUTE)
    assert.ok(route, 'catalog route registered')
    assert.equal(plugin.CATALOG_ROUTE, '/api/dsh-trae2api/catalog')

    const body = await (await route.fetch(new Request('http://127.0.0.1/api/dsh-trae2api/catalog'))).json()
    assert.equal(body.ok, true)
    assert.equal(body.value.origin, 'upstream')
    assert.deepEqual(body.value.models, [{
      id: 'GLM-5.3', key: 'glm-5.3__max', contextWindow: 1000000,
      maxMode: true, multimodal: false, efforts: ['light', 'high'],
    }])

    // The startup refresh is the only call so far: a plain GET answers from
    // it. One call, not two: the extra catalog functions are off by default,
    // because probing them on the enterprise host (2026-10-27) returned
    // `HTTP 200` with 0 configs for every one of them — nothing to union in,
    // one POST per refresh to pay for it.
    const asked = seen.filter(c => c.url.endsWith('/api/ide/v1/batch_get_detail_param'))
    assert.equal(asked.length, 1)
    assert.deepEqual(plugin.Config({}).catalogFunctions, ['chat'])
    assert.equal(asked[0].headers['x-ide-version-code'], '20260908')
    assert.match(asked[0].headers.authorization, /^Cloud-IDE-JWT eyJ/)
    assert.deepEqual(JSON.parse(asked[0].body).functions, ['chat'])
    // `?refresh` is the manual path and does ask again.
    await route.fetch(new Request('http://127.0.0.1/api/dsh-trae2api/catalog?refresh=1'))
    assert.equal(seen.filter(c => c.url.endsWith('/api/ide/v1/batch_get_detail_param')).length, 2)
  } finally { globalThis.fetch = original }
})

test('apply asks the extra catalog functions only when they are configured', async () => {
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
  const original = globalThis.fetch
  const bodies = []
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith('/api/ide/v1/batch_get_detail_param')) bodies.push(JSON.parse(init.body).functions)
    return Response.json({ function_configs: [] })
  }
  try {
    // The configured list has to reach the wire: a config field the catalog
    // never reads would look exactly like a working opt-in.
    plugin.apply(ctx, plugin.Config({ catalogFunctions: ['chat', 'solo_coder'] }))
    const route = routes.get(plugin.CATALOG_ROUTE)
    await route.fetch(new Request('http://127.0.0.1/api/dsh-trae2api/catalog'))
    // `chat` as traecli asks it, then the extras in a request of their own.
    assert.deepEqual(bodies, [['chat'], ['solo_coder']])
  } finally { globalThis.fetch = original }
})

test('apply serves the session id and the upstream chat its last turn ran in', async () => {
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
  // `builtin` keeps these tests off the network and off whatever traecli last
  // cached on the machine running them; the live sources have their own tests.
  plugin.apply(ctx, plugin.Config({ catalogSource: 'builtin', suggestions: false }))
  const route = routes.get(plugin.SESSION_ROUTE)
  assert.ok(route, 'session route registered')
  assert.equal(plugin.SESSION_ROUTE, '/api/dsh-trae2api/session')
  assert.deepEqual(route.methods, ['GET'])
  const ask = async (query) => {
    const response = await route.fetch(new Request(`http://127.0.0.1${plugin.SESSION_ROUTE}${query}`))
    return { status: response.status, body: await response.json() }
  }

  // Which session is being asked about is the whole question.
  const none = await ask('')
  assert.equal(none.status, 400)
  assert.equal(none.body.ok, false)

  // A session that has not answered yet has an id but no upstream chat.
  assert.deepEqual((await ask('?session=s1')).body, {
    ok: true,
    value: { session: 's1', conversation: null, model: null, effort: null, at: null },
  })

  const original = globalThis.fetch
  const bodies = []
  globalThis.fetch = async (url, init) => {
    bodies.push(JSON.parse(init.body))
    return new Response('event: output\ndata: {"response":"Done."}\n\n', { status: 200 })
  }
  try {
    for await (const _ of adapters.trae.stream({
      model: 'GLM-5.3', sessionId: 's1', reasoningEffort: 'high',
      tools: [{ name: 'bash', description: '', parameters: {} }],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'fix it' }] }],
    })) { /* consume */ }
  } finally { globalThis.fetch = original }

  // After a turn, the route names the conversation that turn actually sent —
  // the id an upstream complaint has to quote, which is derived per model
  // variant and level rather than equal to the harness session id.
  const ran = (await ask('?session=s1')).body.value
  assert.equal(ran.session, 's1')
  assert.equal(ran.conversation, bodies[0].conversation_id)
  assert.notEqual(ran.conversation, 's1')
  assert.deepEqual([ran.model, ran.effort], ['GLM-5.3', 'high'])
  assert.ok(ran.at > 0)
  // Another session is not this one, however recently it ran.
  assert.equal((await ask('?session=s2')).body.value.conversation, null)
})

test('apply serves next-step cards for finished Trae turns', async () => {
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
  // `builtin` keeps these tests off the network and off whatever traecli last
  // cached on the machine running them; the live sources have their own tests.
  plugin.apply(ctx, plugin.Config({ catalogSource: 'builtin' }))
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
    assert.deepEqual(got.value.cards, [{ question: '', choices: [{ label: '提交一下', reply: '提交一下' }] }])
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
    plugin.apply(ctx, plugin.Config({ catalogSource: 'builtin', ...overrides }))
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
        method: 'POST', body: JSON.stringify({ session: 's1', id: get.value.id, action, card: 0, choice: 0 }),
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
  // An accept has to say which button.
  const noPick = await (await setup({}).routes.get(plugin.SUGGESTION_EVENT_ROUTE).fetch(new Request('http://127.0.0.1/x', {
    method: 'POST', body: JSON.stringify({ session: 's1', id: 'x', action: 'accept' }),
  }))).json()
  assert.equal(noPick.ok, false)
})
