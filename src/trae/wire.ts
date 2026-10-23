/**
 * llm_raw_chat wire format, ported from trae2api's direct mode
 * (trae2api/direct.py, direct_routes.py, text_tool_calls.py).
 */

import { createHash, randomUUID } from 'node:crypto'
import {
  CONTEXT_WINDOW_EXCEEDED_CODE, QUOTA_EXCEEDED_CODE, isContextWindowExceededError, isQuotaExceededError,
} from '@deepseek-ai/dsh-llm'
import type { ContentBlock, GenerateOptions, RequestMessage, ToolSchema } from '@deepseek-ai/dsh-llm'

// ----------------------------------------------------------------- request

export interface TraePart { type: 'text'; text: string }
/**
 * An image part on a user message, the one shape upstream accepts (the same
 * `{"type":"image_url","image_url":{"url": ...}}` trae2api forwards, direct_routes.py).
 * Only `data:` URIs are used: remote http(s) links would make upstream fetch
 * arbitrary URLs, and the harness hands us bytes, not links.
 */
export interface TraeImagePart { type: 'image_url'; image_url: { url: string } }
export interface TraeToolCall {
  id: string
  index: number
  type: 'function'
  function_call: { name: string; arguments: string }
}
export interface TraeMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: TraePart[]
  /** Image parts of this user message, appended to `content` on the wire. */
  images?: TraeImagePart[]
  tool_calls?: TraeToolCall[]
  tool_call_id?: string
}

/** The wire shape of one message: text parts with image parts interleaved at the end. */
export function wireContent(message: TraeMessage): (TraePart | TraeImagePart)[] {
  return message.images?.length ? [...message.content, ...message.images] : message.content
}

/**
 * Resolved request bytes for every image the request retains, keyed by the
 * durable attachment id, as a `data:` URI ready for the wire. Built by the
 * adapter from the harness attachment store; an image whose id is missing
 * from this map degrades to the `[image omitted]` note.
 */
export type TraeImages = ReadonlyMap<string, string>

function textOf(content: readonly ContentBlock[], imageNote: boolean): string {
  const parts: string[] = []
  for (const block of content) {
    if (block.type === 'text') parts.push(block.text)
    else if (block.type === 'image' && imageNote) parts.push('[image omitted]')
  }
  return parts.join('\n\n')
}

/** The image parts of one user message, in block order; unknown ids are skipped. */
function imagePartsOf(content: readonly ContentBlock[], images: TraeImages | undefined): TraeImagePart[] {
  if (!images || images.size === 0) return []
  const out: TraeImagePart[] = []
  for (const block of content) {
    if (block.type !== 'image') continue
    const url = images.get(block.attachment.attachmentId)
    if (url) out.push({ type: 'image_url', image_url: { url } })
  }
  return out
}

const parts = (text: string): TraePart[] => [{ type: 'text', text }]

/** Harness history -> Trae messages (before repair). */
function rawMessages(options: GenerateOptions, images: TraeImages | undefined): TraeMessage[] {
  const out: TraeMessage[] = []
  if (options.system) out.push({ role: 'system', content: parts(options.system) })
  for (const message of options.messages as readonly RequestMessage[]) {
    switch (message.role) {
      case 'system':
      case 'developer': {
        // Trae's endpoint only knows system/user/assistant/tool.
        const text = textOf(message.content, false)
        if (text) out.push({ role: 'system', content: parts(text) })
        break
      }
      case 'user': {
        const imageParts = imagePartsOf(message.content, images)
        out.push({
          role: 'user',
          content: parts(textOf(message.content, imageParts.length === 0)),
          ...imageParts.length ? { images: imageParts } : {},
        })
        break
      }
      case 'assistant': {
        const text = textOf(message.content, false)
        const calls = message.content
          .filter((b): b is Extract<ContentBlock, { type: 'tool-call' }> => b.type === 'tool-call')
          .map((b, index): TraeToolCall => ({
            id: String(b.id), index, type: 'function',
            function_call: { name: b.name, arguments: b.arguments || '{}' },
          }))
        if (!text && calls.length === 0) break
        out.push({ role: 'assistant', content: text ? parts(text) : [], ...calls.length ? { tool_calls: calls } : {} })
        break
      }
      case 'tool':
        out.push({
          role: 'tool',
          tool_call_id: String(message.toolCallId),
          // Upstream takes images on user turns only, never on a tool result.
          content: parts(textOf(message.content, true) || (message.isError ? 'error' : '')),
        })
        break
      default:
        break
    }
  }
  return out
}

const plain = (m: TraeMessage): string => m.content.map(p => p.text).join('\n')

function demote(result: TraeMessage): TraeMessage {
  const text = plain(result)
  return { role: 'user', content: parts(text ? `[result of an earlier tool call]\n${text}` : '[an earlier tool call returned nothing]') }
}

/**
 * Make the call/result pairing upstream insists on hold (else `4027`): a tool
 * result must follow the assistant message that made the call, and every call
 * must be answered. Orphan results become user text; unanswered calls are
 * folded into the assistant's prose.
 */
export function repairToolHistory(messages: TraeMessage[]): TraeMessage[] {
  const out: TraeMessage[] = []
  let i = 0
  while (i < messages.length) {
    const msg = messages[i]!
    if (msg.role === 'tool') { out.push(demote(msg)); i++; continue }
    if (msg.role !== 'assistant' || !msg.tool_calls?.length) { out.push(msg); i++; continue }
    let end = i + 1
    while (end < messages.length && messages[end]!.role === 'tool') end++
    const unused = msg.tool_calls.map(c => c.id).filter(Boolean)
    const answered = new Set<string>()
    const results: TraeMessage[] = []
    const demoted: TraeMessage[] = []
    for (let result of messages.slice(i + 1, end)) {
      let id = result.tool_call_id ?? ''
      if (!id && unused.length) { id = unused[0]!; result = { ...result, tool_call_id: id } }
      const at = unused.indexOf(id)
      if (at >= 0) { unused.splice(at, 1); answered.add(id); results.push(result) } else demoted.push(demote(result))
    }
    const kept = msg.tool_calls.filter(c => answered.has(c.id)).map((c, index) => ({ ...c, index }))
    const dropped = msg.tool_calls.filter(c => !answered.has(c.id))
    if (dropped.length) {
      const note = dropped.map(c => `[called tool ${c.function_call.name} with ${c.function_call.arguments}]`).join('\n')
      const text = plain(msg)
      out.push({ role: 'assistant', content: parts(text ? `${text}\n${note}` : note), ...kept.length ? { tool_calls: kept } : {} })
    } else {
      out.push(msg)
    }
    out.push(...results, ...demoted)
    i = end
  }
  // Upstream rejects a message with neither content nor a call.
  return out.map(m => (m.content.length === 0 && !m.tool_calls?.length) ? { ...m, content: parts('') } : m)
}

export function toTraeMessages(options: GenerateOptions, images: TraeImages | undefined = undefined): TraeMessage[] {
  return repairToolHistory(rawMessages(options, images))
}

/** Upstream wants the nested function shape with `parameters` as a JSON *string*. */
export function toTraeTools(tools: readonly ToolSchema[] | undefined): unknown[] {
  return (tools ?? []).map(t => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: JSON.stringify(t.parameters ?? {}) },
  }))
}

const SESSION_NAMESPACE = '1b9a4f0e-6c2d-5e73-9a41-0d8b3f7c2a56'

/** Upstream's session_id is a UUID: reuse the harness's own, hashing it when it is not one. */
export function sessionUuid(sessionId: string | undefined): string {
  if (!sessionId) return randomUUID()
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId)) return sessionId.toLowerCase()
  const hex = createHash('sha1').update(SESSION_NAMESPACE).update(sessionId).digest('hex').slice(0, 32).split('')
  hex[12] = '5'
  hex[16] = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16)
  const h = hex.join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/**
 * Upstream conversation id for one harness session on one model variant at one
 * thinking level.
 *
 * `conversation_id` is where upstream keeps a chat's server-side state — the
 * shared prefix cache `use_prompt_cache_pool` buys among it — and that state is
 * bound to the model the conversation started on: a turn that changes
 * `model_name` or `reasoning_effort` under the same id is answered as if it had
 * not, so the picker looks ignored. Each (session, model key, level) therefore
 * gets its own upstream conversation, and switching back to a level this
 * session already used lands on its own conversation again, cache included.
 */
export function conversationUuid(sessionId: string | undefined, modelKey: string, effort: string | undefined): string {
  if (!sessionId) return randomUUID()
  return sessionUuid(`${sessionId}\u0000${modelKey}\u0000${effort ?? ''}`)
}

// ----------------------------------------------------------------- response

export interface TraeEvent { event: string; data: Record<string, unknown> }

/** Decode Trae's private SSE (`event:` / `data:` lines). */
export async function* traeEvents(body: ReadableStream<Uint8Array>): AsyncIterable<TraeEvent> {
  const decoder = new TextDecoder()
  const reader = body.getReader()
  let buffer = ''
  let event: string | undefined
  const take = (line: string): TraeEvent | undefined => {
    line = line.replace(/\r$/, '')
    if (line.startsWith('event:')) { event = line.slice(6).trim(); return undefined }
    if (!line.startsWith('data:')) return undefined
    const payload = line.slice(5).trim()
    if (!payload || payload === '[DONE]') return undefined
    try {
      const parsed = JSON.parse(payload) as unknown
      const data = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        ? parsed as Record<string, unknown> : { value: parsed }
      return { event: event ?? 'message', data }
    } catch { return undefined }
  }
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let nl: number
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const ev = take(buffer.slice(0, nl))
        buffer = buffer.slice(nl + 1)
        if (ev) yield ev
      }
    }
    buffer += decoder.decode()
    if (buffer) { const ev = take(buffer); if (ev) yield ev }
  } finally {
    reader.releaseLock()
  }
}

// ----------------------------------------------------------------- errors

const RATE_LIMIT = ['rate limit', 'rate-limit', 'rate limited', 'too many requests']
const OVERLOADED = ['unavailable', 'all models failed', 'try again']
const TIMED_OUT = ['timeout', 'timed out', 'deadline exceeded']
const PROVIDER_STATUS = /status[ _]?code[:=]\s*(\d{3})/

/**
 * The host's code for an HTTP failure on a Trae endpoint. The codes dsh-llm
 * retries (`RATE_LIMIT / SERVER / TIMEOUT / TRANSPORT`) and the one
 * dsh-compaction-basic keys off (`CONTEXT_WINDOW_EXCEEDED`) only reach it if
 * the adapter names them, and upstream states an over-long request as a 400
 * with the reason in its body rather than as a status of its own.
 */
export function httpCode(status: number, detail: string): string {
  if (status === 401 || status === 403) return 'AUTH'
  const reason = `${status} ${detail}`
  if (isContextWindowExceededError(reason)) return CONTEXT_WINDOW_EXCEEDED_CODE
  if (isQuotaExceededError(reason)) return QUOTA_EXCEEDED_CODE
  if (status === 429) return 'RATE_LIMIT'
  if (status === 408 || status === 504) return 'TIMEOUT'
  if (status >= 500) return 'SERVER'
  return 'PROVIDER_HTTP_ERROR'
}

/** The most useful line out of an upstream error blob. */
export function upstreamMessage(data: Record<string, unknown>): string {
  let detail = ''
  for (const key of ['message', 'error']) {
    const v = data[key]
    if (typeof v === 'string' && v.trim()) { detail = v.trim(); break }
  }
  if (!detail) detail = JSON.stringify(data)
  const chain = data.model_call_chain
  if (Array.isArray(chain)) {
    const first = chain.find(l => l && typeof l === 'object' && (l as Record<string, unknown>).error) as Record<string, unknown> | undefined
    if (first) detail = `${detail}: ${String(first.error).trim()}`
  }
  if (Number(data.code) === 4023) detail += '（上游不认识这个模型名：该模型多半已经下线，或者插件的模型目录和 x-ide-version-code 不同代。对照 ~/.trae/cli/models_cache.json 里现在还在的模型）'
  return detail.replace(/\n/g, ' ').slice(0, 400)
}

/**
 * Map an upstream error to an LlmError code; also says whether a retry may help.
 *
 * The codes are the host's own vocabulary, not descriptive names: dsh-llm
 * retries only `EMPTY_RESPONSE / RATE_LIMIT / SERVER / TIMEOUT / TRANSPORT`,
 * and dsh-compaction-basic compacts only on `CONTEXT_WINDOW_EXCEEDED`. A
 * `PROVIDER_*` code reads fine in a log and makes both of them sit the failure
 * out, so a transient upstream fault would reach the user untried.
 *
 * `retryable` is this plugin's own in-turn loop (a 3003 or an empty answer
 * costs one more POST and usually lands), which is why a quota or an
 * over-long request is false here even though the host has its own answer for
 * them.
 */
export function classify(data: Record<string, unknown>): { code: string; retryable: boolean } {
  const detail = upstreamMessage(data)
  const reason = detail.toLowerCase()
  const code = Number(data.code) || 0
  // Both before the status and marker checks: upstream delivers either one as
  // prose, sometimes with a 400 quoted inside, and the host's answer to them
  // (compact, or stop and say the balance is gone) beats any retry.
  const joined = `${code || ''} ${String(data.type ?? '')} ${detail}`
  if (isContextWindowExceededError(joined)) return { code: CONTEXT_WINDOW_EXCEEDED_CODE, retryable: false }
  if (isQuotaExceededError(joined)) return { code: QUOTA_EXCEEDED_CODE, retryable: false }
  const m = PROVIDER_STATUS.exec(reason)
  const status = m ? Number(m[1]) : undefined
  if (status !== undefined && status >= 400 && status <= 599) {
    if (status === 429) return { code: 'RATE_LIMIT', retryable: true }
    if (status === 408 || status === 504) return { code: 'TIMEOUT', retryable: true }
    if (status < 500) return { code: 'INVALID_REQUEST', retryable: false }
    return { code: 'SERVER', retryable: true }
  }
  if (RATE_LIMIT.some(x => reason.includes(x))) return { code: 'RATE_LIMIT', retryable: true }
  if (TIMED_OUT.some(x => reason.includes(x))) return { code: 'TIMEOUT', retryable: true }
  if (code === 3003 || OVERLOADED.some(x => reason.includes(x))) return { code: 'SERVER', retryable: true }
  if (code === 4023) return { code: 'MODEL_NOT_FOUND', retryable: false }
  if (code === 4001) return { code: 'INVALID_REQUEST', retryable: false }
  return { code: 'PROVIDER_ERROR', retryable: false }
}

// ----------------------------------------------------------------- guards

const WIDE_CHAR_START = 0x2e80

/** Rough token count (CJK ≈ 1/char, else ≈ 4 chars/token). */
export function approxTokens(text: string): number {
  let wide = 0
  for (const ch of text) if (ch.codePointAt(0)! >= WIDE_CHAR_START) wide++
  return wide + Math.ceil((text.length - wide) / 4)
}

/** Trips when the stream's tail is one short unit repeated (a collapsed model never stops). */
export class LoopDetector {
  private tail = ''
  private since = 0
  constructor(private readonly span = 600, private readonly maxUnit = 32, private readonly minRepeats = 10) {}
  add(text: string): boolean {
    if (!this.span || !text) return false
    this.tail = (this.tail + text).slice(-Math.max(this.span * 2, 256))
    this.since += text.length
    if (this.since < 64) return false
    this.since = 0
    const tail = this.tail
    for (let unit = 1; unit <= this.maxUnit && unit * this.minRepeats <= tail.length; unit++) {
      const piece = tail.slice(-unit)
      let repeats = 1
      while ((repeats + 1) * unit <= tail.length && tail.slice(-(repeats + 1) * unit, -repeats * unit) === piece) repeats++
      if (repeats >= this.minRepeats && repeats * unit >= this.span) return true
    }
    return false
  }
}

// ----------------------------------------------------------------- text tool calls

const INVOKE_OPEN = /<invoke\s+name=["']([^"']+)["']\s*>/i
const PARAMETER = /<parameter\s+name=["']([^"']+)["']\s*>([\s\S]*?)<\/parameter>/gi
const INVOKE_CLOSE = '</invoke>'
const WRAPPERS = ['<tool_calls>', '</tool_calls>']
const STARTS = [...WRAPPERS, '<invoke']
const LONGEST = Math.max(...STARTS.map(s => s.length))
/**
 * Longest run of backticks held back between deltas so the code scanner never
 * sees a split run. A longer run is already past every fence length that
 * matters, so releasing it costs nothing a real answer would notice.
 */
const BACKTICK_HOLD = 16

export interface RecoveredCall { id: string; name: string; arguments: string }

function unescapeHtml(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, '\'').replace(/&amp;/g, '&')
}

function coerce(raw: string, schema: Record<string, unknown> | undefined): unknown {
  const text = unescapeHtml(raw).replace(/^\n/, '').replace(/\n$/, '')
  const kind = schema?.type
  if (kind === 'integer' || kind === 'number') {
    const n = kind === 'integer' ? Number.parseInt(text, 10) : Number.parseFloat(text)
    return Number.isFinite(n) && String(n) !== 'NaN' && /^-?\d/.test(text.trim()) ? n : text
  }
  if (kind === 'boolean') {
    const l = text.trim().toLowerCase()
    return l === 'true' ? true : l === 'false' ? false : text
  }
  if (kind === 'array' || kind === 'object') { try { return JSON.parse(text) } catch { return text } }
  return text
}

/**
 * Enough of CommonMark's code rules to tell an answer's own tool call from a
 * quoted example: fenced blocks (a run of three or more backticks alone on its
 * line) and inline spans (a run closed by an equal run before the line ends).
 * Deliberately coarse — it only ever decides whether a marker is prose.
 */
export class CodeScanner {
  /** Backticks that opened the fence currently open; 0 = none. */
  private fence = 0
  /** Backticks that opened the inline span currently open; 0 = none. */
  private span = 0
  /** Nothing but whitespace since the last newline. */
  private blank = true

  /** Whether the next character sits inside a fence or an inline span. */
  get inCode(): boolean {
    return this.fence > 0 || this.span > 0
  }

  /** Track `text`. It must not split a backtick run (see `BACKTICK_HOLD`). */
  push(text: string): void {
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]!
      if (ch === '\n') { this.blank = true; this.span = 0; continue }
      if (ch !== '`') { if (ch !== ' ' && ch !== '\t' && ch !== '\r') this.blank = false; continue }
      let run = 1
      while (i + run < text.length && text[i + run] === '`') run++
      i += run - 1
      const atLineStart = this.blank
      this.blank = false
      if (this.fence > 0) {
        // Only a run at least as long as the opener, alone on its line, closes it.
        if (run >= this.fence && atLineStart) this.fence = 0
      } else if (this.span > 0) {
        if (run === this.span) this.span = 0
      } else if (run >= 3 && atLineStart) {
        this.fence = run
      } else {
        this.span = run
      }
    }
  }
}

/** One stretch of the answer's tail: plain text, a swallowed wrapper, or a call. */
interface Piece {
  /** What the text looked like on the wire, used when recovery is rejected. */
  raw: string
  /** What stays in the answer when recovery wins. */
  visible: string
  call?: RecoveredCall
}

/**
 * Recover tool calls the model wrote as `<tool_calls><invoke name=…>` prose
 * instead of real tool calls, without turning a quoted example into one.
 *
 * Three conditions, because any one of them alone is easy to walk past:
 *  - the markers must not sit in a code fence or an inline span, so an answer
 *    that explains the XML format keeps its example;
 *  - nothing but whitespace may follow them, so a README or page the model
 *    merely retells cannot reach the host (a real call ends the answer);
 *  - the turn must have carried no native `tool_calls` (the caller passes that
 *    to `flush`), since a model that can call properly just did.
 * Only names the request offered are converted, and a block naming anything
 * else leaves the whole tail as text rather than recovering its siblings.
 */
export class TextToolCallSniffer {
  private buffer = ''
  private capturing = false
  /** Set once a candidate is seen: everything after it waits for `flush`. */
  private deferred: Piece[] | undefined
  private readonly code = new CodeScanner()

  constructor(
    private readonly schemas: ReadonlyMap<string, Record<string, unknown>>,
    private readonly enabled = true,
  ) {}

  private get off(): boolean {
    return !this.enabled || this.schemas.size === 0
  }

  /** Visible text for this delta. Calls are only ever decided by `flush`. */
  feed(text: string): string {
    if (this.off || !text) return text
    this.buffer += text
    const visible: string[] = []
    while (this.step(visible)) { /* advance */ }
    return visible.join('')
  }

  /**
   * End of the answer. `allowRecovery` is the caller's veto: pass false when
   * the turn already produced native tool calls.
   */
  flush(allowRecovery = true): { visible: string; calls: RecoveredCall[] } {
    if (this.off) {
      const rest = this.buffer
      this.buffer = ''
      return { visible: rest, calls: [] }
    }
    const visible: string[] = []
    while (this.step(visible)) { /* advance */ }
    // Whatever is still buffered is an unterminated block: plain text.
    const rest = this.buffer
    this.buffer = ''
    this.capturing = false
    this.emit(rest, visible)
    const pieces = this.deferred ?? []
    this.deferred = undefined
    const calls = pieces.flatMap(p => p.call ? [p.call] : [])
    const recover = allowRecovery && calls.length > 0
      && pieces.every(p => p.call !== undefined || p.visible.trim() === '')
    for (const piece of pieces) visible.push(recover ? piece.visible : piece.raw)
    return { visible: visible.join(''), calls: recover ? calls : [] }
  }

  private step(visible: string[]): boolean {
    if (this.capturing) {
      const end = this.buffer.indexOf(INVOKE_CLOSE)
      if (end < 0) return false
      const block = this.buffer.slice(0, end + INVOKE_CLOSE.length)
      this.buffer = this.buffer.slice(end + INVOKE_CLOSE.length)
      this.capturing = false
      this.code.push(block)
      const call = this.parse(block)
      this.record(call ? { raw: block, visible: '', call } : { raw: block, visible: block })
      return true
    }
    let index = -1
    let marker = ''
    for (const m of STARTS) {
      const found = this.buffer.indexOf(m)
      if (found >= 0 && (index < 0 || found < index)) { index = found; marker = m }
    }
    if (index < 0) {
      const hold = this.hold()
      const release = this.buffer.slice(0, this.buffer.length - hold)
      this.buffer = this.buffer.slice(this.buffer.length - hold)
      this.emit(release, visible)
      return false
    }
    this.emit(this.buffer.slice(0, index), visible)
    this.buffer = this.buffer.slice(index)
    // A marker quoted as code is an example: let it through as the text it is.
    if (this.code.inCode) {
      this.buffer = this.buffer.slice(marker.length)
      this.emit(marker, visible)
      return true
    }
    if (WRAPPERS.includes(marker)) {
      this.buffer = this.buffer.slice(marker.length)
      this.record({ raw: marker, visible: '' })
      return true
    }
    this.capturing = true
    return true
  }

  /** Characters held back so the next delta cannot split a marker or a run. */
  private hold(): number {
    let ticks = 0
    while (ticks < this.buffer.length && ticks < BACKTICK_HOLD && this.buffer.at(-1 - ticks) === '`') ticks++
    if (ticks > 0) return ticks < BACKTICK_HOLD ? ticks : 0
    for (let size = Math.min(this.buffer.length, LONGEST - 1); size > 0; size--) {
      if (STARTS.some(m => m.startsWith(this.buffer.slice(-size)))) return size
    }
    return 0
  }

  /** Route text to the answer, or to the tail once a candidate is pending. */
  private emit(text: string, visible: string[]): void {
    if (!text) return
    this.code.push(text)
    if (this.deferred) this.record({ raw: text, visible: text })
    else visible.push(text)
  }

  private record(piece: Piece): void {
    (this.deferred ??= []).push(piece)
  }

  private parse(block: string): RecoveredCall | undefined {
    const opened = INVOKE_OPEN.exec(block)
    if (!opened) return undefined
    const name = opened[1]!
    const schema = this.schemas.get(name)
    if (!schema) return undefined
    const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>
    const args: Record<string, unknown> = {}
    const rest = block.slice(opened.index + opened[0].length)
    for (const m of rest.matchAll(PARAMETER)) args[m[1]!] = coerce(m[2]!, properties[m[1]!])
    return { id: `call_${randomUUID().replace(/-/g, '').slice(0, 24)}`, name, arguments: JSON.stringify(args) }
  }
}
