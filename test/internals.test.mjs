import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  TRAE_MODELS, TRAE_ROUTES, findModel, toRoutes,
  parseDetailParams, parseModelsCache, TraeCatalog,
  toTraeMessages, repairToolHistory, traeEvents, wireContent,
  LoopDetector, TextToolCallSniffer, sessionUuid, classify, approxTokens, decodeJwt, parseExpiry,
  parseQuota, TraeQuota, QUOTA_PATHS, enterpriseTenant,
  parseTobQuota, TobConsole, TOB_LOGIN_PATH, TOB_QUOTA_PATH, TOB_USAGE_PATH, TOB_SESSION_COOKIE,
} from '../lib/testing.mjs'

test('catalog: the built-in table matches the live catalog it was synced with', () => {
  assert.equal(TRAE_MODELS.length, 20)
  // One entry per model, no separate small/large pair.
  assert.equal(TRAE_ROUTES.length, 20)
  const glm = findModel('GLM-5.3')
  // The picker's ladder is light/high/extra_high (轻/高/极高), which is what
  // the live catalog's `reasoning_effort_config.options` spells too.
  assert.deepEqual(glm.efforts, ['light', 'high', 'extra_high'])
  assert.equal(findModel('Kimi-K3').defaultEffort, 'extra_high')
  // Windows of the models with no Max, and the Doubao family's smaller output
  // cap — both as the live catalog reports them (the 10-13 client table this
  // file used to follow claimed 256K for the Turbo).
  assert.equal(findModel('Doubao-Seed-2.1-Turbo').contextWindow, 200000)
  assert.equal(findModel('Doubao-Seed-Evolving').outputTokens, 16000)
  assert.equal(findModel('MiniMax-M2.7').contextWindow, 200000)
  assert.deepEqual(findModel('GLM-5.2').efforts, ['high', 'extra_high'])
  assert.deepEqual(findModel('MiniMax-M3').efforts, [])
  // Alias lookup on config name and on either backend key.
  assert.equal(findModel('glm-5.3__dev'), glm)
  assert.equal(findModel('glm-5.3__max'), glm)
  assert.equal(findModel('DEEPSEEK-V4-PRO-OFFICIAL').id, 'DeepSeek-V4-Pro 正式版')
  assert.equal(findModel('nope'), undefined)
})

test('catalog: a Max-capable model is listed once, already at 1M', () => {
  const maxRoutes = TRAE_ROUTES.filter(r => r.maxMode)
  assert.equal(maxRoutes.length, 14)
  assert.ok(maxRoutes.every(r => r.contextWindow === 1000000))

  // With a catalog max_key: route to that key. Every current model is this
  // kind, so no route carries the IDE's strategy marker.
  const glm = findModel('GLM-5.3')
  assert.equal(glm.key, 'glm-5.3__max')
  assert.equal(glm.contextWindow, 1000000)
  assert.equal(glm.maxMode, true)
  // The key already says Max, so the request carries no strategy marker.
  assert.equal(glm.maxMarker, false)
  assert.equal(findModel('DeepSeek-V4.1-Flash').key, 'DeepSeek-V4.1-Flash__max')
  assert.deepEqual(TRAE_ROUTES.filter(r => r.maxMarker).map(r => r.id), [])

  // The Doubao family has no Max: its `__max` keys open the same window, which
  // the live catalog states as `max_mode: false`.
  for (const [id, window] of [['Doubao-Seed-Evolving', 184000], ['Doubao-Seed-2.1-Pro-0915', 200000], ['Doubao-Seed-Code', 184000]]) {
    const route = findModel(id)
    assert.equal(route.maxMode, false, id)
    assert.equal(route.contextWindow, window, id)
    assert.ok(route.key.endsWith('__dev'), id)
  }
})

test('catalog: the marker path still works for a source that describes Max that way', () => {
  // No current model needs it, but a models_cache.json without a `max_key`
  // can still describe Max as the IDE does: standard key plus the strategy
  // marker and the window it wants.
  const [route] = toRoutes([
    { id: 'Marker-Only', configName: 'marker-only', key: 'marker-only__dev', contextWindow: 184_000, efforts: [], max: { contextWindow: 1_000_000 } },
  ])
  assert.equal(route.key, 'marker-only__dev')
  assert.equal(route.contextWindow, 1000000)
  assert.equal(route.maxMode, true)
  assert.equal(route.maxMarker, true)
})

test('catalog: multimodal flags come from the client capability table, not traecli', () => {
  // traecli reports input_modalities ["text","image"] for *every* model — a
  // Codex-fork constant. Only the client table's `multimodal` is real, and
  // these are the models it marks text-only.
  const textOnly = new Set(['GLM-5.3', 'GLM-5.2', 'MiniMax-M2.7', 'DeepSeek-V4-Pro 正式版', 'DeepSeek-V4-Flash 正式版'])
  for (const route of TRAE_ROUTES) {
    assert.equal(route.multimodal, !textOnly.has(route.id), route.id)
  }
  assert.equal(TRAE_ROUTES.filter(r => r.multimodal).length, 15)
})

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'))

test('catalog source: the live ToB catalog, with the retired models left out', () => {
  // Trimmed capture of POST /api/ide/v1/batch_get_detail_param (the call
  // traecli labels "Trae ToB batch model config"), prompts and icons removed.
  const models = parseDetailParams(fixture('detail_param.json'))
  // qwen-3.7-plus is still in the response — flagged `is_invisible_to_user`
  // with no `model_detail_list`, which is what `4023 the model is unknown`
  // looks like from the outside. `summary` is the compaction config and
  // `custom_model_placeholder` the "add your own" row; none is a model.
  assert.deepEqual(models.map(m => m.id), ['Doubao-Seed-Evolving', 'GLM-5.3', 'MiniMax-M3', 'DeepSeek-V4-Flash 正式版'])

  // A `__max` key whose window is the same 184K is not a Max variant.
  const doubao = models[0]
  assert.equal(doubao.max, undefined)
  assert.equal(doubao.contextWindow, 184_000)
  assert.equal(doubao.outputTokens, 16_000)
  assert.deepEqual(doubao.efforts, ['light', 'high'])
  assert.equal(doubao.defaultEffort, 'high')
  assert.equal(doubao.multimodal, true)

  const glm = models[1]
  assert.deepEqual(glm.max, { key: 'glm-5.3__max', contextWindow: 1_000_000, outputTokens: 64_000 })
  assert.equal(glm.outputTokens, 32_000)
  assert.deepEqual(glm.efforts, ['light', 'high', 'extra_high'])
  assert.equal(glm.multimodal, false)
  assert.deepEqual(models[2].efforts, [])
  // The backend key need not follow the config name.
  assert.equal(models[3].key, 'deepseek_v4_flash_official__dev')

  const routes = toRoutes(models)
  assert.equal(routes[1].key, 'glm-5.3__max')
  assert.equal(routes[1].maxMode, true)
  assert.equal(routes[1].maxMarker, false)
  assert.equal(routes[1].outputTokens, 64_000)
  assert.equal(routes[0].outputTokens, 16_000)
})

test("catalog source: traecli's cache file, image support from the built-in table", () => {
  const models = parseModelsCache(fixture('models_cache.json'))
  assert.deepEqual(models.map(m => m.configName), ['Doubao-Seed-Evolving', 'glm-5.3', 'glm-5.2', 'minimax-m3'])
  // The cache spells the ladder low/high/xhigh and carries the client's own
  // translation to the 轻/高/极高 buttons; that translation is applied here.
  assert.deepEqual(models[0].efforts, ['light', 'high'])
  assert.deepEqual(models[1].efforts, ['light', 'high', 'extra_high'])
  assert.equal(models[1].defaultEffort, 'high')
  // `input_modalities` is ["text","image"] for every model, so it says nothing;
  // the flag comes from the built-in table instead.
  assert.equal(models[0].multimodal, true)
  assert.equal(models[1].multimodal, false)
  // Keys and both windows live under business_metadata.variants.
  assert.equal(models[1].key, 'glm-5.3__dev')
  assert.deepEqual(models[1].max, { key: 'glm-5.3__max', contextWindow: 1_000_000 })
  // GLM-5.2 ships a max_key the 10-13 client table claimed it did not have.
  // A live source outranks that table, so Max is on here.
  assert.equal(models[2].max?.key, 'glm-5.2__max')
})

test('catalog store: upstream, then the cache file, then the built-in table', async () => {
  const upstream = fixture('detail_param.json')
  let fetches = 0

  const live = new TraeCatalog({ cacheFile: '', fetchUpstream: async () => { fetches++; return upstream } })
  const first = await live.ready()
  assert.equal(first.origin, 'upstream')
  assert.equal(first.routes.length, 4)
  assert.equal(first.find('glm-5.3__dev').id, 'GLM-5.3')
  assert.equal(first.find('deepseek-v4-flash 正式版').key, 'deepseek_v4_flash_official__max')
  // One refresh per plugin start; `refresh(true)` is the manual path.
  await live.ready()
  assert.equal(fetches, 1)
  await live.refresh(true)
  assert.equal(fetches, 2)
  // A saved PAT resets the store, so the next use asks again.
  live.reset()
  await live.ready()
  assert.equal(fetches, 3)

  // Upstream unreachable: traecli's cache carries the list, and the snapshot
  // says why the better source was skipped.
  const cached = new TraeCatalog({
    cacheFile: '/fixture/models_cache.json',
    fetchUpstream: () => Promise.reject(new Error('HTTP 500')),
    readCacheFile: () => Promise.resolve(readFileSync(new URL('./fixtures/models_cache.json', import.meta.url), 'utf8')),
  })
  const snapshot = await cached.ready()
  assert.equal(snapshot.origin, 'cache')
  assert.equal(snapshot.routes.length, 4)
  assert.match(snapshot.note, /HTTP 500/)

  // Neither source available: the built-in table, never an empty picker.
  const floor = new TraeCatalog({
    cacheFile: '/fixture/missing.json',
    fetchUpstream: () => Promise.reject(new Error('offline')),
    readCacheFile: () => Promise.reject(new Error('ENOENT')),
  })
  const builtin = await floor.ready()
  assert.equal(builtin.origin, 'builtin')
  assert.equal(builtin.routes.length, TRAE_ROUTES.length)
  assert.match(builtin.note, /offline/)

  // A failed refresh keeps the snapshot that worked.
  let ok = true
  const flaky = new TraeCatalog({
    cacheFile: '',
    fetchUpstream: () => ok ? Promise.resolve(upstream) : Promise.reject(new Error('gateway')),
  })
  await flaky.ready()
  ok = false
  const kept = await flaky.refresh(true)
  assert.equal(kept.origin, 'upstream')
  assert.equal(kept.routes.length, 4)
})

test('message translation: system/user/assistant+tool-call/tool-result', () => {
  const msgs = toTraeMessages({
    system: 'be brief',
    model: 'GLM-5.3',
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      { role: 'assistant', content: [{ type: 'tool-call', id: 'c1', name: 'bash', arguments: '{"cmd":"ls"}' }] },
      { role: 'tool', toolCallId: 'c1', content: [{ type: 'text', text: '/home' }] },
      { role: 'user', content: [{ type: 'text', text: 'thanks' }] },
    ],
  })
  assert.equal(msgs[0].role, 'system')
  assert.equal(msgs[0].content[0].text, 'be brief')
  const asst = msgs.find(m => m.role === 'assistant')
  assert.equal(asst.tool_calls[0].function_call.name, 'bash')   // function_call, not function
  assert.equal(asst.tool_calls[0].index, 0)
  const toolMsg = msgs.find(m => m.role === 'tool')
  assert.equal(toolMsg.tool_call_id, 'c1')
  assert.equal(toolMsg.content[0].text, '/home')
})

test('message translation: images ride user messages as image_url parts, tool results keep placeholders', () => {
  const options = {
    model: 'GLM-5.3',
    messages: [
      { role: 'user', content: [
        { type: 'text', text: '看这张图' },
        { type: 'image', attachment: { attachmentId: 'sha256:aaa' } },
      ] },
      { role: 'assistant', content: [{ type: 'tool-call', id: 'c1', name: 'look', arguments: '{}' }] },
      { role: 'tool', toolCallId: 'c1', content: [
        { type: 'text', text: 'result' },
        { type: 'image', attachment: { attachmentId: 'sha256:bbb' } },
      ] },
    ],
  }
  // With resolved bytes: the user image becomes an image_url data URI part.
  const resolved = toTraeMessages(options, new Map([['sha256:aaa', 'data:image/png;base64,QUJD']]))
  const user = resolved.find(m => m.role === 'user')
  assert.equal(user.images.length, 1)
  assert.equal(user.images[0].type, 'image_url')
  assert.equal(user.images[0].image_url.url, 'data:image/png;base64,QUJD')
  // No [image omitted] note next to a passed-through image.
  assert.equal(user.content[0].text, '看这张图')
  assert.ok(!user.content.some(p => p.text?.includes('image omitted')))
  // The wire shape merges images into the content array.
  const wire = wireContent(user)
  assert.deepEqual(wire.map(p => p.type), ['text', 'image_url'])
  // Upstream takes images on user turns only: the tool-result image stays a note.
  const toolMsg = resolved.find(m => m.role === 'tool')
  assert.equal(toolMsg.images, undefined)
  assert.ok(toolMsg.content.some(p => p.text?.includes('image omitted')))
  // Without a bytes map (text-only route / unreadable image): placeholders.
  const degraded = toTraeMessages(options)
  const degradedUser = degraded.find(m => m.role === 'user')
  assert.equal(degradedUser.images, undefined)
  assert.ok(degradedUser.content.some(p => p.text?.includes('image omitted')))
})

test('repairToolHistory: orphan result demoted, unanswered call folded to prose', () => {
  // A tool result with no preceding call becomes user text.
  const orphan = repairToolHistory([
    { role: 'tool', tool_call_id: 'x', content: [{ type: 'text', text: 'data' }] },
  ])
  assert.equal(orphan[0].role, 'user')
  assert.match(orphan[0].content[0].text, /earlier tool call/)
  // An assistant call with no matching result keeps the prose, drops the dangling call.
  const dangling = repairToolHistory([
    { role: 'assistant', content: [{ type: 'text', text: 'running' }], tool_calls: [{ id: 'a', index: 0, type: 'function', function_call: { name: 'bash', arguments: '{}' } }] },
    { role: 'user', content: [{ type: 'text', text: 'stop' }] },
  ])
  assert.equal(dangling[0].tool_calls, undefined)
  assert.match(dangling[0].content[0].text, /called tool bash/)
})

test('sessionUuid: passes through a real UUID, hashes anything else deterministically', () => {
  assert.equal(sessionUuid('2f1b9e4a-3c5b-4df0-8a4e-5c6d2f1b9e4a'), '2f1b9e4a-3c5b-4df0-8a4e-5c6d2f1b9e4a')
  const a = sessionUuid('conversation-42')
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  assert.equal(a, sessionUuid('conversation-42'))
})

test('traeEvents: decodes event/data pairs across chunk boundaries', async () => {
  const chunks = ['event: output\ndata: {"respo', 'nse":"Hel"}\n\nevent: output\n', 'data: {"response":"lo"}\n\nevent: done\ndata: {"finish_reason":"stop"}\n\n']
  const body = new ReadableStream({
    start(c) { const enc = new TextEncoder(); for (const ch of chunks) c.enqueue(enc.encode(ch)); c.close() },
  })
  const seen = []
  for await (const ev of traeEvents(body)) seen.push(ev)
  assert.deepEqual(seen.map(e => e.event), ['output', 'output', 'done'])
  assert.equal(seen[0].data.response, 'Hel')
  assert.equal(seen[2].data.finish_reason, 'stop')
})

test('classify: upstream codes map to retryable verdicts', () => {
  assert.deepEqual(classify({ code: 3003, error: 'all models failed' }), { code: 'PROVIDER_UNAVAILABLE', retryable: true })
  assert.deepEqual(classify({ code: 4001, error: 'param is invalid' }), { code: 'INVALID_REQUEST', retryable: false })
  assert.deepEqual(classify({ code: 4023, error: 'the model is unknown' }), { code: 'MODEL_NOT_FOUND', retryable: false })
  assert.equal(classify({ error: 'rate limit exceeded' }).code, 'RATE_LIMIT')
  // A provider HTTP status quoted inside the reason wins over markers.
  assert.equal(classify({ error: 'model QPM rate limited: status code: 400, bad' }).code, 'INVALID_REQUEST')
})

test('LoopDetector trips on a collapsed tail, not on normal prose', () => {
  const normal = new LoopDetector(600)
  assert.equal(normal.add('The quick brown fox jumps over the lazy dog. '.repeat(3)), false)
  const collapsed = new LoopDetector(60)
  assert.equal(collapsed.add('发。'.repeat(80)), true)
})

test('TextToolCallSniffer recovers an <invoke> block written as prose', () => {
  const schemas = new Map([['bash', { properties: { command: { type: 'string' } } }]])
  const s = new TextToolCallSniffer(schemas)
  const a = s.feed('ok <tool_calls>\n<invoke name="bash">\n<parameter name="command">ls</parameter>\n</invoke>\n')
  assert.equal(a.visible.trim(), 'ok')
  assert.equal(a.calls.length, 1)
  assert.equal(a.calls[0].name, 'bash')
  assert.deepEqual(JSON.parse(a.calls[0].arguments), { command: 'ls' })
  // A tool the request never offered stays as plain text.
  const s2 = new TextToolCallSniffer(new Map())
  assert.equal(s2.feed('<invoke name="x"></invoke>').visible, '<invoke name="x"></invoke>')
})

test('decodeJwt / parseExpiry read the token the way the gateway returns it', () => {
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url')
  const token = `${b64({ alg: 'RS256' })}.${b64({ data: JSON.stringify({ email: 'a@b.cn' }), exp: 1793076739 })}.sig`
  const claims = decodeJwt(token)
  assert.equal(claims.data.email, 'a@b.cn')
  assert.equal(parseExpiry(1793076739), 1793076739000)        // epoch seconds -> ms
  assert.equal(parseExpiry('2026-10-27T04:52:19.742Z'), Date.parse('2026-10-27T04:52:19.742Z'))
})

test('approxTokens: CJK ~1/char, latin ~4 chars/token', () => {
  assert.equal(approxTokens('你好世界'), 4)
  assert.ok(approxTokens('abcdefgh') <= 2)
})

test('adapter: the picker gets every route, each with its own window and levels', async () => {
  const { TraeAdapter } = await import('../lib/testing.mjs')
  const adapter = new TraeAdapter({
    displayName: 'Trae',
    host: 'https://example.invalid',
    identity: {},
    // Only the auth dependency is stubbed; the catalog path is the real one.
    auth: { get: async () => ({ token: 't', expiresAt: Date.now() + 3600_000 }) },
    readTimeoutMs: 1000, emptyRetries: 0, loopGuardChars: 600,
    logger: { info() {}, warn() {} },
  })

  const models = await adapter.listModels('trae')
  assert.equal(models.length, 20)
  assert.ok(models.every(m => m.provider === 'trae' && m.inputModalities[0] === 'text'))
  // Multimodal flags: 15 routes accept images, 5 stay text-only.
  assert.equal(models.filter(m => m.inputModalities.includes('image')).length, 15)
  assert.ok(models.find(m => m.id === 'GLM-5.3-Flash').inputModalities.includes('image'))
  assert.ok(!models.find(m => m.id === 'GLM-5.3').inputModalities.includes('image'))
  assert.equal(models.find(m => m.id === 'GLM-5.3').description, '1M 上下文（Max）')
  assert.equal(models.find(m => m.id === 'MiniMax-M2.7').description, '200K 上下文')

  // What the agent loop plans compaction against.
  const glm = await adapter.resolveModel('trae', 'GLM-5.3')
  assert.equal(glm.context.contextWindow, 1000000)
  // The output half of the window: a Max route writes up to 64K, the rest 32K,
  // except where the catalog states the model's own cap (Doubao: 16K).
  assert.equal(glm.defaultMaxTokens, 64000)
  assert.equal((await adapter.resolveModel('trae', 'MiniMax-M2.7')).defaultMaxTokens, 32000)
  assert.equal((await adapter.resolveModel('trae', 'Doubao-Seed-Evolving')).defaultMaxTokens, 16000)
  // An id the catalog does not know falls back to the smaller pair.
  const unknown = await adapter.resolveModel('trae', 'nope')
  assert.equal(unknown.context.contextWindow, 200000)
  assert.equal(unknown.defaultMaxTokens, 32000)
  assert.deepEqual(glm.reasoning.efforts.map(e => e.id), ['light', 'high', 'extra_high'])
  assert.equal(glm.reasoning.defaultEffort, 'high')
  // Text-only model resolved by alias keeps its modality honest.
  assert.ok(!(await adapter.resolveModel('trae', 'glm-5.3__max')).inputModalities.includes('image'))
  assert.ok((await adapter.resolveModel('trae', 'DeepSeek-V4.1-Flash')).inputModalities.includes('image'))

  // A model with no thinking levels exposes none, so the picker hides the control.
  const plain = await adapter.resolveModel('trae', 'MiniMax-M3')
  assert.equal(plain.reasoning, undefined)
  assert.equal(plain.context.contextWindow, 1000000)
})

const NOW = Date.parse('2026-10-13T00:00:00Z')
const LATER_S = Math.floor(Date.parse('2026-11-01T00:00:00Z') / 1000)

test('quota: the enterprise CLI spelling (basic_usage_*), totals over packs', () => {
  const q = parseQuota({
    code: 0,
    data: {
      user_entitlement_pack_list: [
        { display_desc: '企业版', entitlement_base_info: { end_time: LATER_S, quota: { basic_usage_limit: 2000 } }, usage: { basic_usage_amount: 766 } },
        { entitlement_base_info: { product_type: 2, product_extra: { subscription_extra: { quota: { basic_usage_limit: '500' } } } }, usage: { basic_usage_amount: 600 } },
      ],
    },
  }, NOW)
  assert.equal(q.raw, undefined)
  assert.deepEqual(q.packs.map(p => [p.name, p.limit, p.used, p.remaining]), [['企业版', 2000, 766, 1234], ['加油包', 500, 600, 0]])
  assert.equal(q.limit, 2500)
  assert.equal(q.used, 1366)
  assert.equal(q.remaining, 1234)   // an over-spent pack counts as 0, not negative
  assert.equal(q.endsAt, LATER_S * 1000)
  assert.equal(q.dollars, false)
})

test('quota: the IDE spelling (credits_*), unlimited, zero and expired packs', () => {
  const credits = parseQuota({
    Result: {
      is_dollar_usage_billing: true,
      userEntitlementPackList: [
        { entitlementBaseInfo: { productType: 1, quota: { creditsLimit: 20 } }, usage: { creditsAmount: 5.5 } },
        { entitlement_base_info: { quota: { credits_limit: 0 } } },                          // no quota of this kind
        { entitlement_base_info: { end_time: 1, quota: { credits_limit: 99 } } },             // ended in 1970
      ],
    },
  }, NOW)
  assert.deepEqual(credits.packs.map(p => [p.name, p.limit, p.remaining]), [['Pro', 20, 14.5]])
  assert.equal(credits.dollars, true)

  const unlimited = parseQuota({ user_entitlement_pack_list: [
    { entitlement_base_info: { quota: { basic_usage_limit: -1 } }, usage: { basic_usage_amount: 3 } },
    { entitlement_base_info: { quota: { basic_usage_limit: 10 } } },
  ] }, NOW)
  assert.equal(unlimited.limit, null)
  assert.equal(unlimited.remaining, null)
  assert.equal(unlimited.used, 3)
})

test('quota: an answer it cannot read is passed through, a refusal is an error', () => {
  // Packs listed, none with a known limit field.
  const odd = parseQuota({ data: { user_entitlement_pack_list: [{ entitlement_base_info: { quota: { tokens: 5 } } }] } }, NOW)
  assert.equal(odd.packs.length, 0)
  assert.match(odd.raw, /tokens/)
  // No pack list at all.
  assert.match(parseQuota({ code: 0, data: {} }, NOW).raw, /"data"/)
  // A real empty account is not "unrecognised".
  assert.equal(parseQuota({ data: { user_entitlement_pack_list: [] } }, NOW).raw, undefined)
  // A free tier: the pack exists, its known limit reads 0 — a normal "no
  // quota" answer, not a format change.
  const free = parseQuota({ data: { user_entitlement_pack_list: [
    { entitlement_base_info: { quota: { basic_usage_limit: 0 }, product_type: 0 }, usage: { basic_usage_amount: 0 } },
  ] } }, NOW)
  assert.equal(free.packs.length, 0)
  assert.equal(free.raw, undefined)
  assert.throws(() => parseQuota({ code: 4001, message: 'app not found' }, NOW), /4001 app not found/)
})

function stubFetch(handler) {
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), headers: init.headers, body: init.body })
    return handler(String(url), calls.length)
  }
  return { calls, restore: () => { globalThis.fetch = original } }
}

function stubAuth() {
  const seen = []
  return {
    seen,
    get: async (force = false) => { seen.push(force); return { token: 'jwt', expiresAt: Date.now() + 3600_000 } },
  }
}

const enterpriseBody = { data: { user_entitlement_pack_list: [{ entitlement_base_info: { quota: { basic_usage_limit: 100 } }, usage: { basic_usage_amount: 40 } }] } }
const quotaOptions = (extra = {}) => ({ host: 'https://h', auth: stubAuth(), userAgent: 'ua', headers: token => ({ authorization: `Cloud-IDE-JWT ${token}` }), ...extra })
const html404 = () => new Response('<html>404 Not Found</html>', { status: 404 })

test('quota fetch: pay host from CheckLogin, path fallback, then cached and remembered', async () => {
  const quota = new TraeQuota(quotaOptions())
  const { calls, restore } = stubFetch((url) => {
    if (url === 'https://h/cloudide/api/v3/trae/CheckLogin') return Response.json({ code: 0, Data: { IsLogin: true, AIPayHost: 'pay.example/' } })
    if (url === `https://pay.example${QUOTA_PATHS[0]}`) return html404()
    if (url === `https://pay.example${QUOTA_PATHS[1]}`) return Response.json(enterpriseBody)
    throw new Error(`unexpected ${url}`)
  })
  try {
    const q = await quota.get()
    assert.equal(q.remaining, 60)
    assert.deepEqual(calls.map(c => c.url), [
      'https://h/cloudide/api/v3/trae/CheckLogin', `https://pay.example${QUOTA_PATHS[0]}`, `https://pay.example${QUOTA_PATHS[1]}`,
    ])
    // CheckLogin the IDE's way; the pay call with only the IDE's headers.
    assert.equal(calls[0].headers['x-cloudide-token'], 'jwt')
    assert.deepEqual(JSON.parse(calls[0].body), { GetAIPayHost: true, ReqSource: 'IDE' })
    assert.equal(calls[2].headers.authorization, 'Cloud-IDE-JWT jwt')
    assert.equal(calls[2].headers['x-app-id'], undefined)
    assert.deepEqual(JSON.parse(calls[2].body), { require_usage: true })

    await quota.get()
    assert.equal(calls.length, 3, 'served from cache')
    await quota.get(true)
    assert.deepEqual(calls.slice(3).map(c => c.url), [`https://pay.example${QUOTA_PATHS[1]}`], 'the answering host+path goes first, no new CheckLogin')
    quota.reset()
    await quota.get()
    assert.equal(calls[4].url, 'https://h/cloudide/api/v3/trae/CheckLogin', 'a new PAT asks CheckLogin again')
  } finally { restore() }
})

test('quota fetch: an empty pack list keeps asking the other hosts, and names its source', async () => {
  const quota = new TraeQuota(quotaOptions())
  const { calls, restore } = stubFetch((url) => {
    if (url.endsWith('/CheckLogin')) return Response.json({ code: 0, Data: { AIPayHost: 'pay.example' } })
    // The pay host CheckLogin named knows nothing about this seat's packs.
    if (url.startsWith('https://pay.example')) return Response.json({ data: { user_entitlement_pack_list: [] } })
    return url.endsWith(QUOTA_PATHS[1]) ? Response.json(enterpriseBody) : html404()
  })
  try {
    const q = await quota.get()
    assert.equal(q.remaining, 60, 'the host that has packs wins over the empty answer')
    assert.equal(q.source, `https://api.trae.cn${QUOTA_PATHS[1]}`)
    assert.equal(calls.length, 5, 'both paths on both hosts, after CheckLogin')
  } finally { restore() }

  // Nothing anywhere: the empty answer is reported, tagged with where it came from.
  const nowhere = new TraeQuota(quotaOptions({ payHost: 'https://fixed.example' }))
  const { restore: restore2 } = stubFetch(() => Response.json({ data: { user_entitlement_pack_list: [] } }))
  try {
    const q = await nowhere.get()
    assert.deepEqual(q.packs, [])
    assert.equal(q.source, `https://fixed.example${QUOTA_PATHS[0]}`)
  } finally { restore2() }
})

// The shape a ToB PAT exchange really answers with (measured 2026-10-13):
// an enterprise tenant in the JWT, and a personal free entitlement whose every
// numeric limit is 0.
const tobJwt = () => {
  const part = obj => Buffer.from(JSON.stringify(obj)).toString('base64url')
  return `${part({ alg: 'RS256', typ: 'JWT' })}.${part({
    data: { email: 'seat@example.com', scope: 'saas', tenant_id: 'tob_online', tob_tenant_id: '100000001', user_id: '200000002' },
    exp: Math.floor(Date.now() / 1000) + 3600,
  })}.sig`
}
const freePackBody = {
  is_dollar_usage_billing: false,
  user_entitlement_pack_list: [{
    display_desc: '免费',
    entitlement_base_info: {
      end_time: LATER_S, product_type: 0, entitlement_id: 'free_utc202610_200000002',
      quota: { basic_usage_limit: 0, advanced_model_request_limit: 0, premium_model_fast_request_limit: 0, enable_solo_agent: true },
    },
    usage: { basic_usage_amount: 0 },
  }],
}

test('quota: an enterprise seat with only a free personal pack reads as a seat, not as nothing', () => {
  assert.equal(enterpriseTenant(tobJwt()), '100000001')
  assert.equal(enterpriseTenant('not.a.jwt'), undefined)
  // A consumer token carries no tenant at all.
  const consumer = `x.${Buffer.from(JSON.stringify({ data: { email: 'me@example.com' } })).toString('base64url')}.y`
  assert.equal(enterpriseTenant(consumer), undefined)

  const quota = new TraeQuota(quotaOptions({ payHost: 'https://fixed.example', auth: { get: async () => ({ token: tobJwt(), expiresAt: Date.now() + 3600_000 }) } }))
  const { restore } = stubFetch(() => Response.json(freePackBody))
  return (async () => {
    try {
      const q = await quota.get()
      assert.deepEqual(q.packs, [], 'every limit on the free pack is 0')
      assert.equal(q.raw, undefined, 'the format is understood, there is just no quota in it')
      assert.equal(q.seat, 'enterprise')
      assert.equal(q.tenant, '100000001')
    } finally { restore() }
  })()
})

test('quota fetch: no pay host → api.trae.cn; a rejected token is reported, never re-exchanged', async () => {
  const options = quotaOptions()
  const quota = new TraeQuota(options)
  const { calls, restore } = stubFetch((url) => url.endsWith('/CheckLogin')
    ? Response.json({ code: 0, Data: { IsLogin: true } })
    : Response.json({ code: 1001, message: 'not able to authenticate you' }, { status: 401 }))
  try {
    await assert.rejects(quota.get(), /https:\/\/api\.trae\.cn，HTTP 401，该地址不接受当前令牌）：1001 not able to authenticate you/)
    assert.deepEqual(calls.slice(1).map(c => c.url), QUOTA_PATHS.map(p => `https://api.trae.cn${p}`))
    assert.deepEqual(options.auth.seen, [false], 'the PAT is not exchanged again over a pay-host 401')
  } finally { restore() }
})

test('quota fetch: a configured pay host skips CheckLogin; the informative failure beats a 404', async () => {
  const quota = new TraeQuota(quotaOptions({ payHost: 'https://fixed.example' }))
  const { calls, restore } = stubFetch((url) => url.endsWith(QUOTA_PATHS[0])
    ? Response.json({ code: 4001, message: 'app not found' })
    : html404())
  try {
    await assert.rejects(quota.get(), (error) => {
      assert.match(error.message, /4001 app not found/)
      assert.doesNotMatch(error.message, /html/)
      return true
    })
    assert.ok(calls.every(c => c.url.startsWith('https://fixed.example/')))
  } finally { restore() }

  const missing = new TraeQuota(quotaOptions({ auth: { get: async () => { throw new Error('还没有填写个人访问令牌') } } }))
  await assert.rejects(missing.get(), /个人访问令牌/)
})

// The shapes the enterprise console really answers with (measured 2026-10-13
// against a live tenant; figures abridged).
const tobQuotaBody = {
  code: 0,
  message: 'success',
  user_model_quota: {
    tenant_id: '100000001', user_id: '200000002',
    seat_pool_currency_quota: 200, paygo_currency_quota: 500,
    seat_pool_token_quota: 9999999999, paygo_token_quota: 9999999999, has_user_quota: false,
  },
}
const tobUsageBody = {
  code: 0,
  user_usage_list: [{
    tenant_id: '100000001', user_id: '200000002', entitlement_id: '300000003',
    model_usage_detail_list: [],
    in_seat_detail: {
      chat_usage_details: [
        { config_name: 'glm-5.3-flash', display_name: 'GLM-5.3-Flash', total_token_usage: 132562306, total_cost_currency: 15.45140592 },
        { config_name: 'glm-5.3', display_name: 'GLM-5.3', total_token_usage: 12904209, total_cost_currency: 14.080088 },
        { config_name: 'Doubao-Seed-Evolving', display_name: 'Doubao-Seed-Evolving', total_token_usage: 0, total_cost_currency: 0 },
      ],
      cue_token_usage: 0,
    },
    seat_total_cost_currency: null,
    extra_total_cost_currency: null,
  }],
}

test('tob: the console answers become a seat pack and a paygo pack, biggest model first', () => {
  const q = parseTobQuota(tobQuotaBody, tobUsageBody, NOW)
  assert.equal(q.seat, 'enterprise')
  assert.equal(q.tenant, '100000001')
  assert.deepEqual(q.packs.map(p => p.name), ['席位额度', '超额（按量）'])
  // The null aggregates mean the per-model costs have to be summed.
  assert.equal(Math.round(q.packs[0].used * 1e5) / 1e5, 29.53149)
  assert.equal(q.packs[0].limit, 200)
  assert.equal(q.packs[1].used, 0)
  assert.equal(q.packs[1].limit, 500)
  assert.equal(q.limit, 700)
  // Models with no usage at all are not worth a row.
  assert.deepEqual(q.models.map(m => m.name), ['GLM-5.3-Flash', 'GLM-5.3'])

  // A quota of 0 is a side the seat does not have, not a pack worth showing.
  const seatOnly = parseTobQuota({ user_model_quota: { seat_pool_currency_quota: 200, paygo_currency_quota: 0 } }, tobUsageBody, NOW)
  assert.equal(seatOnly.packs.length, 1)
  assert.deepEqual(parseTobQuota({}, {}, NOW).packs, [])
})

test('tob: logs in for a session, re-logs in once when it expires', async () => {
  const console_ = new TobConsole({
    host: 'https://console.example',
    userAgent: 'ua',
    readEmail: async () => 'seat@example.com',
    readPassword: async () => 'secret',
  })
  let logins = 0
  let expired = true
  const { calls, restore } = stubFetch((url) => {
    if (url.endsWith(TOB_LOGIN_PATH)) {
      logins++
      expired = false
      return Response.json({ code: 0 }, { headers: { 'set-cookie': `${TOB_SESSION_COOKIE}=sess-${logins}; Path=/; HttpOnly` } })
    }
    if (expired) return Response.json({ code: 30011, message: '请先登录' })
    return Response.json(url.endsWith(TOB_QUOTA_PATH) ? tobQuotaBody : tobUsageBody)
  })
  try {
    const q = await console_.read(NOW)
    assert.equal(q.limit, 700)
    assert.equal(logins, 1)
    assert.equal(q.source, `https://console.example${TOB_QUOTA_PATH}`)
    assert.equal(calls[1].headers.cookie, `${TOB_SESSION_COOKIE}=sess-1`)
    assert.ok(calls.some(c => c.url.endsWith(TOB_USAGE_PATH)))

    // The session dies; the next read logs in again rather than failing.
    expired = true
    const again = await console_.read(NOW)
    assert.equal(again.limit, 700)
    assert.equal(logins, 2)
  } finally { restore() }

  // No console account configured: not an error, just nothing to report.
  const unset = new TobConsole({ host: 'https://console.example', userAgent: 'ua', readEmail: async () => '', readPassword: async () => '' })
  assert.equal(await unset.read(NOW), undefined)
})

test('tob: a refused login says so, and says SSO cannot use this path', async () => {
  const console_ = new TobConsole({
    host: 'https://console.example', userAgent: 'ua',
    readEmail: async () => 'seat@example.com', readPassword: async () => 'wrong',
  })
  const { restore } = stubFetch(() => Response.json({ code: 2001, message: '邮箱或密码错误' }))
  try {
    await assert.rejects(console_.read(NOW), /企业控制台登录失败（邮箱或密码错误）.*SSO/s)
  } finally { restore() }
})

test('quota fetch: an enterprise seat reads the console instead of the IDE API', async () => {
  const tob = {
    reads: 0, resets: 0,
    async read() { this.reads++; return parseTobQuota(tobQuotaBody, tobUsageBody, Date.now()) },
    reset() { this.resets++ },
  }
  const quota = new TraeQuota(quotaOptions({ tob, auth: { get: async () => ({ token: tobJwt(), expiresAt: Date.now() + 3600_000 }) } }))
  const { calls, restore } = stubFetch(() => { throw new Error('the IDE API must not be asked for a ToB seat with a console account') })
  try {
    const q = await quota.get()
    assert.equal(q.limit, 700)
    assert.equal(tob.reads, 1)
    assert.equal(calls.length, 0)
  } finally { restore() }

  // A consumer token never touches the console path.
  const consumer = new TraeQuota(quotaOptions({ tob, payHost: 'https://fixed.example' }))
  const { restore: restore2 } = stubFetch(() => Response.json(enterpriseBody))
  try {
    const q = await consumer.get()
    assert.equal(q.remaining, 60)
    assert.equal(tob.reads, 1, 'unchanged')
  } finally { restore2() }
})

// ------------------------------------------------------------ suggestions

const sse = events => new Response(events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join(''), {
  status: 200, headers: { 'content-type': 'text/event-stream' },
})

const turnOptions = (extra = {}) => ({
  model: 'GLM-5.3',
  sessionId: 's1',
  tools: [{ name: 'bash', description: 'run', parameters: {} }],
  messages: [
    { role: 'user', content: [{ type: 'text', text: 'first ask' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'done one' }] },
    { role: 'user', content: [{ type: 'text', text: 'fix the build' }] },
  ],
  ...extra,
})

async function drain(iterable) { for await (const _ of iterable) { /* consume */ } }

test('suggestions: prompt carries the recent user messages and the answer', async () => {
  const { suggestPrompt } = await import('../lib/testing.mjs')
  const prompt = suggestPrompt({ options: turnOptions(), answer: 'Build fixed. Want me to run the tests?' })
  assert.match(prompt, /first ask[\s\S]*fix the build[\s\S]*Want me to run the tests\?/)
})

test('suggestions: the model\'s cards keep its own questions and buttons', async () => {
  const { parseSuggestions, MAX_CARDS, MAX_CHOICES } = await import('../lib/testing.mjs')
  // Two decisions, two cards; the buttons are whatever the model offered, not a yes/no pair.
  const raw = '<think>hm</think>\n```json\n' + JSON.stringify([
    {
      question: '先做哪一个？',
      choices: [
        { label: '写保护逻辑', reply: '把加保护逻辑的改动写出来' },
        { label: '整理成文档', reply: '把这份判定整理成给产品的说明文档' },
      ],
    },
    { question: '要跑一下测试吗？', choices: [{ label: '跑测试', reply: '跑一下测试' }, { label: '暂不用', reply: '先不跑' }] },
  ]) + '\n```'
  assert.deepEqual(parseSuggestions(raw), [
    {
      question: '先做哪一个？',
      choices: [
        { label: '写保护逻辑', reply: '把加保护逻辑的改动写出来' },
        { label: '整理成文档', reply: '把这份判定整理成给产品的说明文档' },
      ],
    },
    { question: '要跑一下测试吗？', choices: [{ label: '跑测试', reply: '跑一下测试' }, { label: '暂不用', reply: '先不跑' }] },
  ])

  // A button needs something to send; a missing label says what it sends;
  // a repeated reply and a card left with no buttons are dropped.
  assert.deepEqual(parseSuggestions(JSON.stringify([
    { question: 'Q', choices: [{ label: 'no reply' }, { reply: 'run the tests' }, { label: 'again', reply: 'run the tests' }] },
    { question: 'empty', choices: [] },
    'commit it',
  ])), [
    { question: 'Q', choices: [{ label: 'run the tests', reply: 'run the tests' }] },
    { question: '', choices: [{ label: 'commit it', reply: 'commit it' }] },
  ])

  // Capped: cards and buttons per card.
  const many = Array.from({ length: 6 }, (_, i) => ({
    question: `q${i}`, choices: Array.from({ length: 6 }, (_, j) => ({ label: `l${j}`, reply: `r${i}.${j}` })),
  }))
  const capped = parseSuggestions(JSON.stringify(many))
  assert.equal(capped.length, MAX_CARDS)
  assert.ok(capped.every(card => card.choices.length === MAX_CHOICES))

  // Not JSON: a bare line is still one card with one button; nothing usable is no card.
  assert.deepEqual(parseSuggestions('"好的，跑一下测试"\n'), [{ question: '', choices: [{ label: '好的，跑一下测试', reply: '好的，跑一下测试' }] }])
  assert.deepEqual(parseSuggestions('User: run the tests\nsecond line'), [{ question: '', choices: [{ label: 'run the tests', reply: 'run the tests' }] }])
  assert.deepEqual(parseSuggestions('[]'), [])
  assert.deepEqual(parseSuggestions('   \n'), [])
  assert.deepEqual(parseSuggestions('[{"question": "cut off'), [])
  assert.deepEqual(parseSuggestions('x'.repeat(500)), [])
})

test('suggestions: a finished turn is waited for, a new turn drops it, a failure is just nothing', async () => {
  const { TraeSuggestions } = await import('../lib/testing.mjs')
  let release
  const asked = []
  const store = new TraeSuggestions({
    complete: (model, system, user, signal) => {
      asked.push(model)
      return new Promise((resolve, reject) => {
        release = resolve
        signal.addEventListener('abort', () => reject(new Error('aborted')))
      })
    },
    model: '', timeoutMs: 5000, logger: { warn() {} },
  })
  assert.equal(await store.get('s1', 0), null)

  store.turnEnded({ sessionId: 's1', model: 'GLM-5.3', options: turnOptions(), answer: 'ok' })
  assert.deepEqual(asked, ['GLM-5.3'])
  const waiting = store.get('s1', 1000)
  release('[{"question": "Run them?", "choices": [{"label": "Run", "reply": "run the tests"}]}]')
  const got = await waiting
  assert.deepEqual(got.cards, [{ question: 'Run them?', choices: [{ label: 'Run', reply: 'run the tests' }] }])

  store.turnStarted('s1')
  assert.equal(await store.get('s1', 0), null)

  // Still in flight past the wait: answered as empty for now, not as an error.
  store.turnEnded({ sessionId: 's1', model: 'GLM-5.3', options: turnOptions(), answer: 'ok' })
  assert.deepEqual((await store.get('s1', 10)).cards, [])

  // An empty answer suggests nothing at all.
  store.turnEnded({ sessionId: 's2', model: 'GLM-5.3', options: turnOptions(), answer: '  ' })
  assert.equal(await store.get('s2', 0), null)
})

test('suggestions: no cards right after the host\'s own ask dialog, but later steps of that turn still get them', async () => {
  const { TraeSuggestions, followsAsk } = await import('../lib/testing.mjs')
  const step = (name, id) => [
    { role: 'assistant', content: [{ type: 'text', text: '…' }, { type: 'tool-call', id, name, arguments: '{}' }] },
    { role: 'tool', toolCallId: id, content: [{ type: 'text', text: '{}' }] },
  ]
  const base = turnOptions().messages
  // The model asked in the dialog, the user skipped it, the model re-asks in prose.
  const afterAsk = [...base, ...step('bash', 'c1'), ...step('ask_user_question', 'c2')]
  // Asked first, then went on working: the closing next steps are new.
  const askedEarlier = [...base, ...step('ask_user_question', 'c1'), ...step('bash', 'c2')]
  // A host reminder appended after the tool result does not hide the ask.
  const reminded = [...afterAsk, { role: 'user', content: [{ type: 'text', text: '<system-reminder>time</system-reminder>' }] }]
  // The previous turn's plain answer asked nothing in this one.
  const previousAnswer = [
    { role: 'user', content: [{ type: 'text', text: 'first' }] },
    { role: 'assistant', content: [{ type: 'tool-call', id: 'c0', name: 'ask_user_question', arguments: '{}' }] },
    { role: 'tool', toolCallId: 'c0', content: [{ type: 'text', text: '{}' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
    { role: 'user', content: [{ type: 'text', text: 'next' }] },
  ]
  assert.equal(followsAsk(afterAsk), true)
  assert.equal(followsAsk(reminded), true)
  assert.equal(followsAsk(askedEarlier), false)
  assert.equal(followsAsk(previousAnswer), false)
  assert.equal(followsAsk(base), false)

  const asked = []
  const store = new TraeSuggestions({
    complete: async () => { asked.push(1); return '[{"question": "Q?", "choices": [{"label": "Go", "reply": "go"}]}]' },
    model: '', timeoutMs: 5000, logger: { warn() {} },
  })
  store.turnEnded({ sessionId: 's1', model: 'GLM-5.3', options: turnOptions({ messages: afterAsk }), answer: '你想用哪个方案？' })
  assert.equal(await store.get('s1', 0), null)
  assert.equal(asked.length, 0, 'not even asked for')

  store.turnEnded({ sessionId: 's1', model: 'GLM-5.3', options: turnOptions({ messages: askedEarlier }), answer: '改好了，要跑测试吗？' })
  assert.equal((await store.get('s1', 1000)).cards.length, 1)
})

test('adapter: only a main-loop turn that ends in prose reports itself; complete() is a tool-less side call', async () => {
  const { TraeAdapter } = await import('../lib/testing.mjs')
  const started = []
  const ended = []
  const adapter = new TraeAdapter({
    displayName: 'Trae', host: 'https://h', identity: {},
    auth: stubAuth(),
    readTimeoutMs: 1000, emptyRetries: 0, loopGuardChars: 600,
    onTurnStart: id => { started.push(id) },
    onTurnEnd: turn => { ended.push(turn) },
    logger: { info() {}, warn() {} },
  })

  let stub = stubFetch(() => sse([['output', { response: 'All fixed.' }], ['done', { finish_reason: 'stop' }]]))
  try {
    await drain(adapter.stream(turnOptions()))
    // A side request (no tools, e.g. a title) neither starts nor ends a turn.
    await drain(adapter.stream(turnOptions({ tools: [] })))
  } finally { stub.restore() }
  assert.deepEqual(started, ['s1'])
  assert.equal(ended.length, 1)
  assert.equal(ended[0].sessionId, 's1')
  assert.equal(ended[0].model, 'GLM-5.3')
  assert.equal(ended[0].answer, 'All fixed.')

  // A turn that calls a tool is not over yet.
  stub = stubFetch(() => sse([['output', { tool_calls: [{ index: 0, id: 'c1', function: { name: 'bash', arguments: '{}' } }] }]]))
  try { await drain(adapter.stream(turnOptions())) } finally { stub.restore() }
  assert.equal(ended.length, 1)

  stub = stubFetch(() => sse([['output', { reasoning_content: 'thinking', response: 'run ' }], ['output', { response: 'the tests' }]]))
  let text
  try { text = await adapter.complete('GLM-5.3', 'sys', 'user', new AbortController().signal) } finally { stub.restore() }
  assert.equal(text, 'run the tests')
  const body = JSON.parse(stub.calls[0].body)
  assert.deepEqual(body.tools, [])
  assert.equal(body.reasoning_effort_level, 'light')
  assert.notEqual(body.session_id, 's1')
  assert.deepEqual(body.messages.map(m => m.role), ['system', 'user'])
})

test('adapter: the body matches a traecli capture; the max marker rides only the keyless Max routes', async () => {
  const { TraeAdapter } = await import('../lib/testing.mjs')
  const adapter = new TraeAdapter({
    displayName: 'Trae', host: 'https://h', identity: {}, auth: stubAuth(),
    readTimeoutMs: 1000, emptyRetries: 0, loopGuardChars: 600,
    logger: { info() {}, warn() {} },
  })
  const bodyFor = async (extra) => {
    const stub = stubFetch(() => sse([['output', { response: 'ok' }], ['done', { finish_reason: 'stop' }]]))
    try { await drain(adapter.stream(turnOptions(extra))) } finally { stub.restore() }
    return JSON.parse(stub.calls[0].body)
  }

  // A Max route with a catalog max_key: the `__max` key carries Max on its
  // own, exactly as traecli sends it — no strategy marker, no window.
  const kimi = await bodyFor({ model: 'Kimi-K3', reasoningEffort: 'extra_high' })
  assert.equal(kimi.function, 'chat')
  assert.equal(kimi.config_name, 'kimi-k3')
  assert.equal(kimi.model_name, 'kimi-k3__max')
  assert.equal(kimi.user_input, '')
  assert.deepEqual(kimi.metadata, { agent_type: 'chat', use_prompt_cache_pool: true })
  assert.equal(kimi.mode_type, 0)
  assert.equal(kimi.access_type, 4)
  assert.equal(kimi.reasoning_effort_level, 'extra_high')
  assert.equal(kimi.model_auto_selection, undefined)
  assert.equal(kimi.context_window_size, undefined)

  // No Max at all: neither field, whatever the window.
  const plain = await bodyFor({ model: 'Doubao-Seed-Evolving' })
  assert.equal(plain.model_name, 'Doubao-Seed-Evolving__dev')
  assert.equal(plain.model_auto_selection, undefined)
  assert.equal(plain.context_window_size, undefined)

  // Max without a max_key: the standard key stays, so the marker and the
  // window are the only things asking for 1M. No model Trae currently serves
  // is described that way, so the route comes from a catalog of one.
  const routes = toRoutes([
    { id: 'Marker-Only', configName: 'marker-only', key: 'marker-only__dev', contextWindow: 184_000, efforts: [], max: { contextWindow: 1_000_000 } },
  ])
  const marker = new TraeAdapter({
    displayName: 'Trae', host: 'https://h', identity: {}, auth: stubAuth(),
    catalog: { ready: async () => ({ routes, find: id => routes.find(r => r.id === id || r.key === id) }) },
    readTimeoutMs: 1000, emptyRetries: 0, loopGuardChars: 600,
    logger: { info() {}, warn() {} },
  })
  const stub = stubFetch(() => sse([['output', { response: 'ok' }], ['done', { finish_reason: 'stop' }]]))
  try { await drain(marker.stream(turnOptions({ model: 'Marker-Only' }))) } finally { stub.restore() }
  const body = JSON.parse(stub.calls[0].body)
  assert.equal(body.model_name, 'marker-only__dev')
  assert.deepEqual(body.model_auto_selection, { strategy: 'max' })
  assert.equal(body.context_window_size, 1000000)
})

test('cue: report/clients gets multipart `body` with env_metadata and stringified payloads', async () => {
  const { TraeCueReporter, REPORT_PATH } = await import('../lib/testing.mjs')
  const auth = stubAuth()
  const reporter = new TraeCueReporter({
    host: 'https://h', auth, appId: 'app-1', ideVersion: '99.99.99', ideVersionCode: '20260908', userAgent: 'ua',
    user: async () => ({ userId: '42', privacyMode: false }),
  })
  const stub = stubFetch((url, n) => n === 1 ? new Response('no', { status: 401 }) : Response.json({ code: 0 }))
  try {
    await reporter.report([{ event: 'code_gen_accept', payload: { resp_id: 'r1', accept_content: '好' } }])
  } finally { stub.restore() }
  assert.deepEqual(auth.seen, [false, true], 'a rejected JWT is exchanged once')
  assert.equal(stub.calls.length, 2)
  const call = stub.calls[1]
  assert.equal(call.url, `https://h${REPORT_PATH}`)
  assert.equal(call.headers.authorization, 'Cloud-IDE-JWT jwt')
  assert.equal(call.headers['x-app-id'], 'app-1')
  assert.ok(call.body instanceof FormData)
  const body = JSON.parse(call.body.get('body'))
  assert.deepEqual(body.env_metadata, {
    ide_version: '99.99.99', environment: '', extension_version: '', version_code: 20260908,
    region: 'cn', channel: 'unknown', app_id: 'app-1', user_id: '42', ab_version: '',
  })
  assert.equal(body.events.length, 1)
  assert.equal(body.events[0].event, 'code_gen_accept')
  assert.equal(typeof body.events[0].payload, 'string')
  assert.deepEqual(JSON.parse(body.events[0].payload), { resp_id: 'r1', accept_content: '好' })

  const failing = stubFetch(() => new Response('boom', { status: 500 }))
  try {
    await assert.rejects(reporter.report([{ event: 'code_gen_shown', payload: {} }]), /HTTP 500/)
  } finally { failing.restore() }

  // Privacy mode: like the IDE, report nothing at all.
  const privateReporter = new TraeCueReporter({
    host: 'https://h', auth: stubAuth(), appId: 'a', ideVersion: 'v', ideVersionCode: '1', userAgent: 'ua',
    user: async () => ({ userId: '42', privacyMode: true }),
  })
  const silent = stubFetch(() => Response.json({}))
  try {
    assert.equal(await privateReporter.report([{ event: 'code_gen_accept', payload: {} }]), false)
  } finally { silent.restore() }
  assert.equal(silent.calls.length, 0)
})

test('user info: GetUserInfo with x-cloudide-token, UserID as a string, PrivacyMode gate, once per JWT', async () => {
  const { parseUserInfo, TraeUserInfo, USER_INFO_PATH } = await import('../lib/testing.mjs')
  assert.deepEqual(parseUserInfo({ code: 0, message: '', Data: { UserInfo: { UserID: '312308224', TenantID: '9' }, PrivacyMode: false } }), { userId: '312308224', privacyMode: false })
  assert.deepEqual(parseUserInfo({ code: 0, Data: { UserInfo: { UserID: 7 }, PrivacyMode: 1 } }), { userId: '7', privacyMode: true })
  assert.throws(() => parseUserInfo({ code: 401, message: 'not login' }), /401 not login/)
  assert.throws(() => parseUserInfo({ code: 0, Data: { UserInfo: {} } }), /no UserInfo\.UserID/)

  const users = new TraeUserInfo({ host: 'https://console.example/', auth: stubAuth(), userAgent: 'ua' })
  const stub = stubFetch(() => Response.json({ code: 0, Data: { UserInfo: { UserID: '312308224' }, PrivacyMode: false } }))
  try {
    assert.equal((await users.get()).userId, '312308224')
    assert.equal((await users.get()).userId, '312308224')
  } finally { stub.restore() }
  assert.equal(stub.calls.length, 1, 'cached for the same JWT')
  assert.equal(stub.calls[0].url, `https://console.example${USER_INFO_PATH}`)
  assert.equal(stub.calls[0].headers['x-cloudide-token'], 'jwt')
  assert.equal(stub.calls[0].headers.authorization, undefined)
  assert.equal(stub.calls[0].body, '{}')
})

test('suggestions: shown then accept, once each, sharing one resp_id; stale ids count for nothing', async () => {
  const { TraeSuggestions, sessionUuid } = await import('../lib/testing.mjs')
  const reported = []
  const store = new TraeSuggestions({
    complete: async () => JSON.stringify([
      { question: 'Next?', choices: [{ label: 'Test', reply: 'run the tests' }, { label: 'Commit', reply: 'commit it' }] },
    ]),
    model: '', timeoutMs: 5000, logger: { warn() {} },
    report: async (events) => { reported.push(...events); return true },
  })
  store.turnEnded({ sessionId: 's1', model: 'GLM-5.3', options: turnOptions(), answer: 'ok' })
  const { id } = await store.get('s1', 1000)

  assert.equal(await store.record('s1', 'other-id', 'shown'), false)
  assert.equal(await store.record('s1', id, 'shown'), true)
  assert.equal(await store.record('s1', id, 'shown'), false, 'shown counts once')
  assert.equal(await store.record('s1', id, 'accept'), false, 'accept names the button')
  assert.equal(await store.record('s1', id, 'accept', { card: 0, choice: 5 }), false, 'no such button')
  assert.equal(await store.record('s1', id, 'accept', { card: 0, choice: 1 }), true)
  assert.equal(await store.record('s1', id, 'accept', { card: 0, choice: 0 }), false, 'accept counts once')

  assert.deepEqual(reported.map(e => e.event), ['code_gen_shown', 'code_gen_accept'])
  const [shown, accept] = reported.map(e => e.payload)
  assert.equal(shown.resp_id, id)
  assert.equal(accept.resp_id, id)
  assert.equal(accept.conversation_id, sessionUuid('s1'))
  assert.equal(accept.accept_content, 'commit it', 'the pressed button\'s reply')
  assert.equal(typeof accept.suggestion_visible_duration, 'number')

  // A new turn retires the old id.
  store.turnStarted('s1')
  assert.equal(await store.record('s1', id, 'accept', { card: 0, choice: 0 }), false)
  assert.equal(reported.length, 2)
})
