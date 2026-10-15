/**
 * Harness LLM adapter that talks to Trae's llm_raw_chat endpoint directly —
 * no trae2api process, no Python, no traecli.
 */

import { randomUUID } from 'node:crypto'
import {
  LlmAdapter,
  LlmError,
  type ContentBlock,
  type FinishReason,
  type GenerateOptions,
  type LlmModelInfo,
  type LlmProviderInfo,
  type LlmResolvedModelInfo,
  type ReasoningEffortId,
  type StreamChunk,
  type TokenUsage,
  type ToolCallId,
} from '@deepseek-ai/dsh-llm'
import type { TraeAuth } from './trae/auth.ts'
import type { FinishedTurn } from './trae/suggest.ts'
import { EFFORT_NAMES, findModel, TRAE_ROUTES, type TraeEffort, type TraeRoute } from './trae/catalog.ts'
import {
  approxTokens,
  classify,
  LoopDetector,
  sessionUuid,
  TextToolCallSniffer,
  toTraeMessages,
  toTraeTools,
  traeEvents,
  upstreamMessage,
  wireContent,
  type TraeEvent,
  type TraeImages,
} from './trae/wire.ts'

export const CHAT_PATH = '/api/ide/v2/llm_raw_chat'

export interface TraeIdentity {
  appId: string
  ideFunction: string
  ideVersion: string
  ideVersionCode: string
  clientVersion: string
  originator: string
  userAgent: string
}

export interface AdapterOptions {
  displayName: string
  host: string
  identity: TraeIdentity
  auth: TraeAuth
  /** Max ms between two upstream bytes before the turn is abandoned. */
  readTimeoutMs: number
  /** Extra attempts for a turn that produced nothing (or a transient 3003). */
  emptyRetries: number
  /** Repetition guard span in characters; 0 disables. */
  loopGuardChars: number
  /**
   * Mounted harness attachment store, resolved per request; absent (or a
   * provider that cannot project images) degrades images to their
   * `[image omitted]` note instead of failing the turn.
   */
  resolveAttachments?: () => AttachmentStoreLike | undefined
  /** A main-loop request (one carrying tools) is about to run in this session. */
  onTurnStart?: (sessionId: string) => void
  /** A main-loop request ended the turn with a plain answer, no tool calls. */
  onTurnEnd?: (turn: FinishedTurn) => void
  logger: { info(...a: unknown[]): void; warn(...a: unknown[]): void }
}

/**
 * The slice of `@deepseek-ai/dsh-attachment`'s AttachmentStore used here:
 * `readImageRequest(ref, target)` returns deterministic request bytes for one
 * durable normalized image reference (the same seam dsh-llm-deepseek uses).
 * `ImageBlock` is imported structurally so the plugin keeps only dsh-llm as a
 * declared dependency.
 */
export interface AttachmentStoreLike {
  readImageRequest(
    ref: ImageBlock['attachment'],
    target: { width: number; height: number; maxBytes: number },
    signal?: AbortSignal,
  ): Promise<{ data: Uint8Array; mediaType: string; bytes: number; width: number; height: number }>
}

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))

type ImageBlock = Extract<ContentBlock, { type: 'image' }>

/** Every image occurrence in the request, in message order (deduplicated by caller). */
function* imageRefs(options: GenerateOptions): Generator<ImageBlock['attachment']> {
  for (const message of options.messages) {
    const content = (message as { content?: readonly ContentBlock[] }).content ?? []
    for (const block of content) if (block.type === 'image') yield (block as ImageBlock).attachment
  }
}

/**
 * Byte budget per request image. Trae's endpoint is the OpenAI-style wire, and
 * the enterprise gateway has shown no published grid, so images are sent at
 * their normalized size up to 1024px per side (README's tested 64×64 PNG passes
 * untouched; huge screenshots get scaled by the attachment provider's ladder
 * rather than refused by upstream).
 */
const REQUEST_IMAGE_LONG_EDGE = 1024
const REQUEST_IMAGE_MAX_BYTES = 2 * 1024 * 1024

/**
 * Output cap the backend grants a turn, the other half of the context window
 * (168K + 32K = 200K on a `__dev` key, 936K + 64K = 1M on `__max`). Observed
 * on a Kimi-K3 capture and applied to every route by its Max-ness; a model
 * whose own cap turns out to differ wants its own catalog field.
 */
const OUTPUT_TOKENS = 32_000
const MAX_OUTPUT_TOKENS = 64_000

/** The identity headers every Trae API call carries (chat and quota alike). */
export function traeHeaders(id: TraeIdentity, token: string, accept: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    accept,
    originator: id.originator,
    'user-agent': id.userAgent,
    'x-request-id': randomUUID(),
    authorization: `Cloud-IDE-JWT ${token}`,
    'x-app-id': id.appId,
    'x-ide-function': id.ideFunction,
    'x-ide-version': id.ideVersion,
    'x-ide-version-code': id.ideVersionCode,
    version: id.clientVersion,
  }
}

function effortFor(route: TraeRoute, requested: string | undefined): TraeEffort | undefined {
  if (!requested || route.efforts.length === 0) return undefined
  const lower = requested.toLowerCase()
  if (route.efforts.includes(lower as TraeEffort)) return lower as TraeEffort
  // A level named in the other source's vocabulary still lands on the right
  // button: the two ladders (light/high/extra_high and low/high/xhigh) are the
  // same three steps under different names.
  const rung = ({ none: 0, minimal: 0, light: 0, low: 0, medium: 1, high: 1, extra_high: 2, xhigh: 2, max: 2, ultra: 2 } as Record<string, number>)[lower]
  if (rung === undefined) return undefined
  const ladder: readonly TraeEffort[][] = [['light', 'low'], ['high'], ['extra_high', 'xhigh']]
  return ladder[rung]!.find(name => route.efforts.includes(name))
}

function usageOf(data: Record<string, unknown>): TokenUsage {
  const n = (k: string): number => Number(data[k]) || 0
  const prompt = n('prompt_tokens')
  const read = n('cache_read_input_tokens')
  const write = n('cache_creation_input_tokens')
  const out: TokenUsage = {
    inputTokens: Math.max(0, prompt - read - write),
    outputTokens: n('completion_tokens'),
  }
  if (n('total_tokens')) out.totalTokens = n('total_tokens')
  if (read) out.cacheReadTokens = read
  if (write) out.cacheWriteTokens = write
  if (n('reasoning_tokens')) out.reasoningTokens = n('reasoning_tokens')
  return out
}

export class TraeAdapter extends LlmAdapter {
  constructor(private readonly opts: AdapterOptions) {
    super()
  }

  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: this.opts.displayName }
  }

  /**
   * The catalog is built in, but listing also proves the PAT works: an
   * unconfigured or rejected PAT makes the model picker show the reason
   * instead of a silently missing group.
   */
  override async listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    await this.opts.auth.get()
    return TRAE_ROUTES.map(r => ({
      provider, id: r.id, name: r.id,
      description: r.maxMode ? '1M 上下文（Max）' : `${Math.round(r.contextWindow / 1000)}K 上下文`,
      inputModalities: (r.multimodal ? ['text', 'image'] : ['text']) as readonly ('text' | 'image')[],
    }))
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    const known = findModel(model)
    const info: LlmResolvedModelInfo = {
      provider,
      id: model,
      name: known?.id ?? model,
      inputModalities: (known?.multimodal ? ['text', 'image'] : ['text']) as readonly ('text' | 'image')[],
      // Hard-coded per model from the IDE capability table, so the loop plans
      // compaction against the window the backend actually enforces.
      context: { contextWindow: known?.contextWindow ?? 200_000 },
      // The output half of that window: switching a route to its `__max` key
      // doubles what the backend lets the model write. llm_raw_chat itself
      // ignores `max_tokens`, so this is also the only cap `stream` can hold
      // the turn to — without it the loop sends no budget and nothing cuts a
      // runaway answer.
      defaultMaxTokens: known?.maxMode ? MAX_OUTPUT_TOKENS : OUTPUT_TOKENS,
    }
    if (known && known.efforts.length > 0) {
      info.reasoning = {
        efforts: known.efforts.map(e => ({ id: e as ReasoningEffortId, name: EFFORT_NAMES[e] })),
        ...known.defaultEffort ? { defaultEffort: known.defaultEffort as ReasoningEffortId } : {},
      }
    }
    return Promise.resolve(info)
  }

  private headers(token: string): Record<string, string> {
    return traeHeaders(this.opts.identity, token, 'text/event-stream')
  }

  /** One POST; yields decoded events. Retries once with a fresh JWT on 401/403. */
  private async *once(body: string, signal: AbortSignal): AsyncIterable<TraeEvent> {
    let session = await this.opts.auth.get()
    for (let attempt = 0; ; attempt++) {
      let res: Response
      try {
        res = await fetch(`${this.opts.host}${CHAT_PATH}`, { method: 'POST', headers: this.headers(session.token), body, signal })
      } catch (error) {
        if (signal.aborted) throw error
        throw new LlmError(`Trae：无法连接 ${this.opts.host}（${error instanceof Error ? error.message : String(error)}）`, 'PROVIDER_UNAVAILABLE')
      }
      if ((res.status === 401 || res.status === 403) && attempt === 0) {
        await res.body?.cancel()
        session = await this.opts.auth.get(true)
        continue
      }
      if (!res.ok) {
        const detail = (await res.text()).slice(0, 400)
        const code = res.status === 401 || res.status === 403 ? 'AUTH' : res.status === 429 ? 'RATE_LIMIT' : res.status >= 500 ? 'PROVIDER_UNAVAILABLE' : 'PROVIDER_HTTP_ERROR'
        throw new LlmError(`Trae llm_raw_chat HTTP ${res.status}${detail ? `：${detail}` : ''}`, code, { status: res.status })
      }
      if (!res.body) throw new LlmError('Trae 返回了空响应体', 'PROVIDER_PROTOCOL_ERROR')
      yield* traeEvents(res.body)
      return
    }
  }

  /**
   * Resolve request bytes for every image occurrence on a multimodal route.
   * Failure to read one image degrades that image to its `[image omitted]`
   * note rather than failing the whole turn: a screenshot the model cannot
   * see is still more useful than a refused request.
   */
  private async prepareImages(options: GenerateOptions, signal?: AbortSignal): Promise<TraeImages> {
    const attachments = this.opts.resolveAttachments?.()
    const map = new Map<string, string>()
    if (!attachments) return map
    for (const ref of imageRefs(options)) {
      if (map.has(ref.attachmentId)) continue
      try {
        const target = { width: REQUEST_IMAGE_LONG_EDGE, height: REQUEST_IMAGE_LONG_EDGE, maxBytes: REQUEST_IMAGE_MAX_BYTES }
        const version = await attachments.readImageRequest(ref, target, signal)
        map.set(ref.attachmentId, `data:${version.mediaType};base64,${Buffer.from(version.data).toString('base64')}`)
      } catch (error) {
        if (signal?.aborted) throw error
        this.opts.logger.warn(`dsh-trae2api: 读取图片失败，本轮该图以占位文本发送（${error instanceof Error ? error.message : String(error)}）`)
      }
    }
    return map
  }

  /** The llm_raw_chat request body: one route, one thinking level, one upstream session. */
  private requestBody(route: TraeRoute, effort: TraeEffort | undefined, session: string, messages: unknown[], tools: unknown[]): Record<string, unknown> {
    const body: Record<string, unknown> = {
      function: 'chat',
      config_name: route.configName,
      model_name: route.key,
      user_input: '',
      messages,
      session_id: session,
      conversation_id: session,
      // `use_prompt_cache_pool` is what buys the shared prefix cache; traecli
      // sends it on every turn, and without it each turn pays full prompt price.
      metadata: { agent_type: 'chat', use_prompt_cache_pool: true },
      tools,
      mode_type: 0,
      access_type: 4,
    }
    if (route.maxMarker) {
      // Max without a catalog `max_key`: the standard key stays, so the turn
      // needs the IDE's marker plus the window it wants to reach 1M. With a
      // `max_key`, `model_name` is already the `__max` key and traecli sends
      // neither field — matched here, so the two clients stay distinguishable
      // only by what they genuinely differ on.
      body.model_auto_selection = { strategy: 'max' }
      body.context_window_size = route.contextWindow
    }
    if (effort) {
      // Sent where both first-party clients put it (IDE: custom_model; traecli: top level).
      body.custom_model = {
        config_name: route.configName, model_name: route.key, is_preset: true, use_remote_service: true, reasoning_effort: effort,
      }
      body.reasoning_effort_level = effort
    }
    return body
  }

  /**
   * One tool-less completion, collected rather than streamed — for side
   * requests such as next-input suggestions. Runs on the route's lowest
   * thinking level under a throwaway upstream session, so it never touches
   * the conversation's own server-side state.
   */
  async complete(model: string, system: string, user: string, signal: AbortSignal): Promise<string> {
    const route = findModel(model)
    if (!route) throw new LlmError(`Trae：未知模型「${model}」`, 'MODEL_NOT_FOUND')
    const messages = [
      { role: 'system', content: [{ type: 'text', text: system }] },
      { role: 'user', content: [{ type: 'text', text: user }] },
    ]
    const payload = JSON.stringify(this.requestBody(route, route.efforts[0], randomUUID(), messages, []))
    let text = ''
    let error: Record<string, unknown> | undefined
    for await (const ev of this.once(payload, signal)) {
      if (ev.event === 'output' && typeof ev.data.response === 'string') text += ev.data.response
      else if (ev.event === 'error' || ev.event === 'biz_error') error ??= ev.data
    }
    if (!text && error) throw new LlmError(`Trae：${upstreamMessage(error)}`, classify(error).code)
    return text
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const route = findModel(options.model)
    if (!route) {
      throw new LlmError(`Trae：未知模型「${options.model}」。可用：${TRAE_ROUTES.map(r => r.id).join('、')}`, 'MODEL_NOT_FOUND')
    }
    const effort = effortFor(route, options.reasoningEffort ? String(options.reasoningEffort) : undefined)
    const session = sessionUuid(options.sessionId ? String(options.sessionId) : undefined)
    // Only the agent loop's own requests carry tools; title, compaction and
    // other side requests in the same session neither start nor end a turn.
    const mainLoop = options.sessionId !== undefined && options.purpose === undefined && (options.tools?.length ?? 0) > 0
    if (mainLoop) this.opts.onTurnStart?.(String(options.sessionId))
    // Text-only routes keep the [image omitted] note even if an image slipped
    // through: upstream answers a text-only model handed an image with
    // `1210:messages.content.type 参数非法` wrapped in a fake rate-limit error.
    const images = route.multimodal ? await this.prepareImages(options, options.signal) : undefined
    const messages = toTraeMessages(options, images).map(m => ({
      role: m.role,
      content: wireContent(m),
      ...m.tool_calls?.length ? { tool_calls: m.tool_calls } : {},
      ...m.tool_call_id ? { tool_call_id: m.tool_call_id } : {},
    }))
    const payload = JSON.stringify(this.requestBody(route, effort, session, messages, toTraeTools(options.tools)))
    const schemas = new Map((options.tools ?? []).map(t => [t.name, t.parameters ?? {}]))

    // Our own controller so the guards can cut the upstream stream.
    const controller = new AbortController()
    const onAbort = (): void => controller.abort(options.signal?.reason)
    if (options.signal?.aborted) onAbort()
    options.signal?.addEventListener('abort', onAbort, { once: true })

    let next = 0
    let reasoningIdx: number | undefined
    let reasoningText = ''
    let textIdx: number | undefined
    let text = ''
    const tools = new Map<number, { index: number; id: ToolCallId; name: string; args: string }>()
    const recovered: Array<{ index: number; id: ToolCallId; name: string; args: string }> = []
    const ends: Array<() => StreamChunk> = []
    let usage: TokenUsage | undefined
    let upstreamFinish = 'stop'
    let stopped: 'max-tokens' | undefined
    let produced = false
    let outputTokens = 0
    const budget = options.maxTokens
    const contentLoop = new LoopDetector(this.opts.loopGuardChars)
    const reasoningLoop = new LoopDetector(this.opts.loopGuardChars)
    const sniffer = new TextToolCallSniffer(schemas)

    function* emitText(piece: string): Generator<StreamChunk> {
      if (!piece) return
      if (textIdx === undefined) {
        const idx = textIdx = next++
        yield { type: 'block-start', index: idx, blockType: 'text' }
        ends.push(() => ({ type: 'block-end', index: idx, block: { type: 'text', text } }))
      }
      text += piece
      yield { type: 'text-delta', index: textIdx, text: piece }
    }
    function* emitRecovered(calls: ReadonlyArray<{ id: string; name: string; arguments: string }>): Generator<StreamChunk> {
      for (const c of calls) {
        const state = { index: next++, id: c.id as ToolCallId, name: c.name, args: c.arguments }
        recovered.push(state)
        yield { type: 'block-start', index: state.index, blockType: 'tool-call' }
        yield { type: 'tool-call-delta', index: state.index, id: state.id, name: state.name, argumentsDelta: state.args }
        ends.push(() => ({ type: 'block-end', index: state.index, block: { type: 'tool-call', id: state.id, name: state.name, arguments: state.args } }))
      }
    }

    try {
      const attempts = this.opts.emptyRetries + 1
      for (let attempt = 0; attempt < attempts; attempt++) {
        let error: Record<string, unknown> | undefined
        let idle: ReturnType<typeof setTimeout> | undefined
        const arm = (): void => {
          clearTimeout(idle)
          if (this.opts.readTimeoutMs > 0) idle = setTimeout(() => controller.abort(new Error('idle')), this.opts.readTimeoutMs)
        }
        arm()
        try {
          for await (const ev of this.once(payload, controller.signal)) {
            arm()
            const data = ev.data
            if (ev.event === 'output') {
              const reasoning = typeof data.reasoning_content === 'string' ? data.reasoning_content : ''
              if (reasoning) {
                produced = true
                if (reasoningIdx === undefined) {
                  const idx = reasoningIdx = next++
                  yield { type: 'block-start', index: idx, blockType: 'reasoning' }
                  ends.push(() => ({ type: 'block-end', index: idx, block: { type: 'reasoning', text: reasoningText } }))
                }
                reasoningText += reasoning
                yield { type: 'reasoning-delta', index: reasoningIdx, text: reasoning }
              }
              const response = typeof data.response === 'string' ? data.response : ''
              if (response) {
                produced = true
                const { visible, calls } = sniffer.feed(response)
                yield* emitText(visible)
                yield* emitRecovered(calls)
              }
              const calls = Array.isArray(data.tool_calls) ? data.tool_calls as Array<Record<string, unknown>> : []
              for (const call of calls) {
                produced = true
                const key = Number(call.index) || 0
                const fc = (call.function_call ?? call.function ?? {}) as Record<string, unknown>
                let state = tools.get(key)
                if (!state) {
                  state = { index: next++, id: (typeof call.id === 'string' && call.id ? call.id : `call_${randomUUID().slice(0, 8)}`) as ToolCallId, name: '', args: '' }
                  tools.set(key, state)
                  const s = state
                  yield { type: 'block-start', index: s.index, blockType: 'tool-call' }
                  ends.push(() => ({ type: 'block-end', index: s.index, block: { type: 'tool-call', id: s.id, name: s.name, arguments: s.args || '{}' } }))
                } else if (typeof call.id === 'string' && call.id && state.args === '' && !state.name) {
                  state.id = call.id as ToolCallId
                }
                if (typeof fc.name === 'string' && fc.name) state.name = fc.name
                const fragment = typeof fc.arguments === 'string' ? fc.arguments : fc.arguments !== undefined ? JSON.stringify(fc.arguments) : ''
                state.args += fragment
                yield { type: 'tool-call-delta', index: state.index, id: state.id, ...state.name ? { name: state.name } : {}, argumentsDelta: fragment }
              }
              // Guards: the endpoint ignores max_tokens and has no stop sequences.
              outputTokens += approxTokens(response) + approxTokens(reasoning)
              if (contentLoop.add(response) || reasoningLoop.add(reasoning)) {
                this.opts.logger.warn(`dsh-trae2api: repetition collapse on ${route.id}; cutting the turn`)
                stopped = 'max-tokens'
              } else if (budget !== undefined && budget > 0 && outputTokens >= budget) {
                stopped = 'max-tokens'
              }
              if (stopped) { controller.abort(new Error('guard')); break }
            } else if (ev.event === 'token_usage') {
              usage = usageOf(data)
            } else if (ev.event === 'done') {
              if (typeof data.finish_reason === 'string' && data.finish_reason) upstreamFinish = data.finish_reason
            } else if (ev.event === 'error' || ev.event === 'biz_error') {
              error ??= data
            }
          }
        } catch (err) {
          if (!stopped) {
            if (options.signal?.aborted) throw err
            if (controller.signal.aborted) {
              throw new LlmError(`Trae：上游 ${Math.round(this.opts.readTimeoutMs / 1000)} 秒没有数据，已放弃本轮`, 'PROVIDER_TIMEOUT')
            }
            throw err
          }
        } finally {
          clearTimeout(idle)
        }
        if (produced || stopped) {
          if (error && !stopped) this.opts.logger.warn(`dsh-trae2api: upstream error after output: ${upstreamMessage(error)}`)
          break
        }
        const verdict = error ? classify(error) : { code: 'EMPTY_RESPONSE', retryable: true }
        if (!verdict.retryable || attempt === attempts - 1) {
          throw new LlmError(
            error ? `Trae：${upstreamMessage(error)}` : 'Trae：上游这一轮没有返回任何内容（不是拒绝，属上游故障），请重试。',
            verdict.code,
          )
        }
        this.opts.logger.warn(`dsh-trae2api: empty/transient turn on ${route.id}; retrying`)
        await sleep(1000 * (attempt + 1))
      }

      const tail = sniffer.flush()
      yield* emitText(tail.visible)
      yield* emitRecovered(tail.calls)
      for (const end of ends) yield end()
      if (!usage && stopped) usage = { inputTokens: 0, outputTokens }
      if (usage) yield { type: 'usage', usage }
      let reason: FinishReason
      if (stopped) reason = { kind: 'max-tokens' }
      else if (tools.size > 0 || recovered.length > 0) reason = { kind: 'tool-calls' }
      else if (upstreamFinish === 'length') reason = { kind: 'max-tokens' }
      else reason = { kind: 'stop' }
      // Before `finish`, so the suggestion is already pending by the time the
      // session reports the turn over and the composer asks for it.
      if (mainLoop && reason.kind === 'stop' && text.trim()) {
        try {
          this.opts.onTurnEnd?.({ sessionId: String(options.sessionId), model: route.id, options, answer: text })
        } catch { /* a suggestion must never fail the turn */ }
      }
      yield { type: 'finish', reason }
    } finally {
      options.signal?.removeEventListener('abort', onAbort)
    }
  }
}
