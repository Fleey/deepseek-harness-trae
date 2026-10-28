#!/usr/bin/env node
/**
 * Which header names the request in Trae's own logs?
 *
 * The support line this plugin copies (src/trae/debug.ts) carries a `traceId`.
 * `traceOf()` looks for upstream's own name for the request in the response —
 * `x-tt-logid`, `x-tt-trace-id`, `x-trace-id` — and falls back to the
 * `x-request-id` the turn sent. This probe runs one real, tiny turn and prints
 * every response header, so that list answers to a measurement rather than to
 * convention.
 *
 * Run on 2026-10-28 against api.enterprise.trae.cn: `llm_raw_chat` answered
 * with `x-tt-logid: 2026102816265801000315823240915B1` and no other trace
 * header, so `traceOf()` picked it. Worth re-running whenever upstream's
 * gateway changes.
 *
 *   TRAE_PAT=<your PAT> node tools/probe_trace.mjs [model]
 *
 * It prints header names and values, the status line, and which header
 * `traceOf()` would pick. It never prints the PAT or the JWT, and it cancels
 * the answer stream as soon as the headers are in, so the turn costs one short
 * prompt. Cookies are shown by name only.
 *
 * Needs `npm run build:test` first (it reads `traceOf` from lib/testing.mjs, so
 * the probe and the plugin agree by construction).
 */

import { traceOf } from '../lib/testing.mjs'

const HOST = 'https://api.enterprise.trae.cn'
const EXCHANGE_PATH = '/cloudide/api/v3/trae/oauth/ExchangeToken'
const CHAT_PATH = '/api/ide/v2/llm_raw_chat'
const CLI_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const CLIENT_VERSION = '0.206.1-tob'
const USER_AGENT = `codex_exec/${CLIENT_VERSION} (dsh-trae2api) unknown (codex_exec; ${CLIENT_VERSION})`

const pat = (process.env.TRAE_PAT ?? '').trim()
if (!pat) {
  console.error('usage: TRAE_PAT=<your PAT> node tools/probe_trace.mjs [model]')
  console.error('(the PAT is read from the environment and never printed)')
  process.exit(2)
}
const model = process.argv[2] ?? 'Doubao-Seed-2.1-Turbo'

/** Every response header, with cookie values left out. */
function dumpHeaders(label, headers) {
  console.log(`\n--- ${label} ---`)
  const names = [...headers.keys()].sort()
  for (const name of names) {
    const value = /cookie/i.test(name) ? '<redacted>' : headers.get(name)
    console.log(`${name}: ${value}`)
  }
}

/** The same envelope walk as src/trae/auth.ts: the token sits under an
 * `OauthToken` / `Token` object on some deployments and directly on `Data` as
 * a string on others, so a nested object is only stepped into when it is one. */
function unwrapToken(body) {
  const isObject = value => typeof value === 'object' && value !== null && !Array.isArray(value)
  for (const candidate of [body?.Result, body?.Data, body?.data, body?.result, body]) {
    if (!isObject(candidate)) continue
    const inner = isObject(candidate.OauthToken) ? candidate.OauthToken
      : isObject(candidate.Token) ? candidate.Token
        : candidate
    for (const key of ['Token', 'token', 'AccessToken', 'access_token', 'accessToken']) {
      if (typeof inner[key] === 'string' && inner[key].length > 20) return inner[key]
    }
  }
  return undefined
}

const exchange = await fetch(`${HOST}${EXCHANGE_PATH}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json', 'user-agent': USER_AGENT },
  body: JSON.stringify({ RefreshToken: pat, ClientID: CLI_CLIENT_ID }),
  signal: AbortSignal.timeout(30_000),
})
const exchangeBody = await exchange.json().catch(() => undefined)
dumpHeaders(`ExchangeToken HTTP ${exchange.status}`, exchange.headers)
const token = unwrapToken(exchangeBody)
if (!token) {
  console.error(`\nExchangeToken did not return a token (HTTP ${exchange.status}). Check the PAT.`)
  process.exit(1)
}

const requestId = crypto.randomUUID()
const sent = {
  'content-type': 'application/json',
  accept: 'text/event-stream',
  originator: 'codex_exec',
  'user-agent': USER_AGENT,
  'x-request-id': requestId,
  authorization: `Cloud-IDE-JWT ${token}`,
  'x-app-id': '7b3f9dc2-8a4e-5c6d-2f1b-9e4a3c5b7df0',
  'x-ide-function': 'chat',
  'x-ide-version': '99.99.99',
  'x-ide-version-code': '20260908',
  version: CLIENT_VERSION,
}
const chat = await fetch(`${HOST}${CHAT_PATH}`, {
  method: 'POST',
  headers: sent,
  body: JSON.stringify({
    function: 'chat',
    config_name: model,
    model_name: model,
    user_input: '',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    session_id: crypto.randomUUID(),
    conversation_id: crypto.randomUUID(),
    metadata: { agent_type: 'chat', use_prompt_cache_pool: true },
    tools: [],
    mode_type: 0,
    access_type: 4,
  }),
  signal: AbortSignal.timeout(60_000),
})
dumpHeaders(`llm_raw_chat HTTP ${chat.status}`, chat.headers)

// A refusal says as much about the headers as an answer does, and its body
// names the reason.
if (!chat.ok) console.log(`\nbody: ${(await chat.text()).slice(0, 300)}`)
else await chat.body?.cancel()

console.log(`\nx-request-id sent: ${requestId}`)
const picked = traceOf(chat.headers, requestId)
console.log(`traceOf() picks:   ${picked}${picked === requestId ? '  (fell back to the id we sent — no upstream trace header matched)' : ''}`)
