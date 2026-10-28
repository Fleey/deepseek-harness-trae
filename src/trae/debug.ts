/**
 * The one-line diagnostic string Trae's own clients copy for support.
 *
 * In TRAE SOLO CN 0.1.61 double-clicking an answer's header copies a line its
 * support side can paste straight into a search:
 *
 *   312308224:a9e9…839c_6ae1a91d…6bff.6ae1a91d…6c02.6ae1a91d…6c00:TraeWork CN.0.1.61.no_sid.no_ppe.T(2026/10/28 15:49:49)
 *   └ user  └ trace          └ chat   └ message    └ reply-to     └ app  └ version └ Slardar └ PPE └ local time
 *
 * built as (external accounts; an internal one gets JSON instead):
 *
 *   `${region ? region + '.' : ''}${userId}:${traceId}_${sessionId}.${messageId}.${replyId}:${appName}.${appVersion}.${sid}.${ppe}`
 *
 * with `no_sid` / `no_ppe` standing in for an absent Slardar session and a
 * non-PPE environment. Its three 24-hex ids are MongoDB ObjectIds minted by
 * Trae's chat service; the client only joins what the server sent it.
 *
 * This plugin speaks `llm_raw_chat` directly, which is a layer below that chat
 * service and carries **no message ids at all**, so the line is filled with
 * what a turn here genuinely has and every missing field keeps the format's
 * own `no_*` placeholder rather than an invented id:
 *
 * - `userId` — `GetUserInfo`'s `UserInfo.UserID`, the same id the IDE reports
 *   under (`no_uid` when it cannot be read).
 * - `traceId` — the trace header upstream answered the turn with, falling back
 *   to the `x-request-id` this plugin sent (that one is in upstream's access
 *   log either way).
 * - `sessionId` — the upstream conversation the turn ran in (wire.ts
 *   `conversationUuid`): a UUID here, not an ObjectId.
 * - `messageId` / `replyId` — `no_mid`: the raw endpoint has neither.
 * - `appName` / `appVersion` — the originator and version this plugin sends in
 *   its identity headers, which is what upstream logged for the request, not
 *   `TraeWork CN`.
 */

/** Placeholders the format itself uses for a field that is not there. */
export const DEBUG_MISSING = {
  user: 'no_uid',
  trace: 'no_trace',
  message: 'no_mid',
  sid: 'no_sid',
  ppe: 'no_ppe',
} as const

/**
 * Response headers that name the request in upstream's own logs, best first.
 *
 * Measured against api.enterprise.trae.cn on 2026-10-28 (tools/probe_trace.mjs):
 * `llm_raw_chat` answers with `x-tt-logid`
 * (`2026102816265801000315823240915B1`) and no other trace header, and
 * `ExchangeToken` even lists it in `access-control-expose-header`. The rest
 * are the gateway family's other spellings, kept as fallbacks; none was seen.
 *
 * It is not the `traceId` Trae's chat service puts in its own support line
 * (a 32-hex `trace_id` on the layer above this one) — it is the name the
 * gateway logged for this request, which is the one answerable here.
 */
const TRACE_HEADERS = ['x-tt-logid', 'x-tt-trace-id', 'x-trace-id', 'x-request-id'] as const

export interface TraeDebugParts {
  /** Region prefix; empty on the CN deployment, as in the sample above. */
  region?: string
  userId?: string
  traceId?: string
  /** Upstream conversation id — the only id here the turn really has. */
  sessionId: string
  messageId?: string
  replyId?: string
  appName: string
  appVersion: string
  slardarSid?: string
  ppe?: string
  /** Turn time in ms; omitted leaves the `T(...)` tail off, as the client does. */
  at?: number
}

/** `2026/10/28 15:49:49` — local time, the way the client's `T(...)` tail reads. */
export function traeDebugTime(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** One diagnostic line in the client's own format. */
export function traeDebugLine(parts: TraeDebugParts): string {
  const region = parts.region ? `${parts.region}.` : ''
  const user = parts.userId || DEBUG_MISSING.user
  const trace = parts.traceId || DEBUG_MISSING.trace
  const message = parts.messageId || DEBUG_MISSING.message
  const reply = parts.replyId || DEBUG_MISSING.message
  const app = `${parts.appName}.${parts.appVersion}.${parts.slardarSid || DEBUG_MISSING.sid}.${parts.ppe || DEBUG_MISSING.ppe}`
  const time = parts.at === undefined ? '' : `.T(${traeDebugTime(parts.at)})`
  return `${region}${user}:${trace}_${parts.sessionId}.${message}.${reply}:${app}${time}`
}

/**
 * How upstream names this request in its logs: its own trace header when it
 * sent one, else the `x-request-id` the turn carried up.
 */
export function traceOf(headers: Headers, sent?: string): string | undefined {
  for (const name of TRACE_HEADERS) {
    const value = headers.get(name)
    if (value) return value
  }
  return sent
}
