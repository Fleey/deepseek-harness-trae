import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  TRAE_MODELS, TRAE_ROUTES, findModel, toTraeMessages, repairToolHistory, traeEvents,
  LoopDetector, TextToolCallSniffer, sessionUuid, classify, approxTokens, decodeJwt, parseExpiry,
} from '../lib/testing.mjs'

test('catalog: windows and levels come from the TRAE SOLO CN client table', () => {
  assert.equal(TRAE_MODELS.length, 24)
  // One entry per model, no separate small/large pair.
  assert.equal(TRAE_ROUTES.length, 24)
  const glm = findModel('GLM-5.3')
  // The live client spells the ladder light/high/extra_high (轻/高/极高),
  // which is what the picker shows and what goes upstream.
  assert.deepEqual(glm.efforts, ['light', 'high', 'extra_high'])
  assert.equal(findModel('Kimi-K3').defaultEffort, 'extra_high')
  // Windows for the models with no Max come from the client table.
  assert.equal(findModel('Doubao-Seed-2.1-Turbo').contextWindow, 256000)   // catalog claimed 200K
  assert.equal(findModel('GLM-5.2').contextWindow, 200000)
  // Described only by the catalog, so it keeps the catalog's vocabulary.
  assert.deepEqual(findModel('GLM-5.2').efforts, ['high', 'xhigh'])
  assert.deepEqual(findModel('MiniMax-M3').efforts, [])
  // Alias lookup on config name and on either backend key.
  assert.equal(findModel('glm-5.3__dev'), glm)
  assert.equal(findModel('glm-5.3__max'), glm)
  assert.equal(findModel('DEEPSEEK-V4-PRO-OFFICIAL').id, 'DeepSeek-V4-Pro 正式版')
  assert.equal(findModel('nope'), undefined)
})

test('catalog: a Max-capable model is listed once, already at 1M', () => {
  const maxRoutes = TRAE_ROUTES.filter(r => r.maxMode)
  assert.equal(maxRoutes.length, 16)
  assert.ok(maxRoutes.every(r => r.contextWindow === 1000000))

  // With a catalog max_key: route to that key.
  const glm = findModel('GLM-5.3')
  assert.equal(glm.key, 'glm-5.3__max')
  assert.equal(glm.contextWindow, 1000000)
  assert.equal(glm.maxMode, true)
  assert.equal(findModel('DeepSeek-V4.1-Flash').key, 'DeepSeek-V4.1-Flash__max')

  // Without one: keep the standard key, Max rides the strategy marker.
  const doubao = findModel('Doubao-Seed-Evolving')
  assert.equal(doubao.key, 'Doubao-Seed-Evolving__dev')
  assert.equal(doubao.contextWindow, 1000000)
  assert.equal(doubao.maxMode, true)

  // The client table says these have no Max, even though the catalog ships a
  // max_key for two of them — so they stay at their standard window.
  for (const [id, window] of [['GLM-5.2', 200000], ['DeepSeek-V4-Pro', 200000], ['Doubao-Seed-Code', 184000]]) {
    const route = findModel(id)
    assert.equal(route.maxMode, false, id)
    assert.equal(route.contextWindow, window, id)
    assert.ok(route.key.endsWith('__dev'), id)
  }
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
  assert.equal(models.length, 24)
  assert.ok(models.every(m => m.provider === 'trae' && m.inputModalities[0] === 'text'))
  assert.equal(models.find(m => m.id === 'GLM-5.3').description, '1M 上下文（Max）')
  assert.equal(models.find(m => m.id === 'GLM-5.2').description, '200K 上下文')

  // What the agent loop plans compaction against.
  const glm = await adapter.resolveModel('trae', 'GLM-5.3')
  assert.equal(glm.context.contextWindow, 1000000)
  assert.deepEqual(glm.reasoning.efforts.map(e => e.id), ['light', 'high', 'extra_high'])
  assert.equal(glm.reasoning.defaultEffort, 'high')

  // A model with no thinking levels exposes none, so the picker hides the control.
  const plain = await adapter.resolveModel('trae', 'MiniMax-M3')
  assert.equal(plain.reasoning, undefined)
  assert.equal(plain.context.contextWindow, 1000000)
})
