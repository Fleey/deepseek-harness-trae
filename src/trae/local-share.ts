/**
 * Share a dsh session as a Trae "local conversation": every turn its own pair
 * of bubbles, and each answer with the steps that led to it (what the model
 * said, thought, which tool it ran and what came back), the way a TRAE SOLO
 * share page shows its own agent at work.
 *
 * Why this and not the mirror (mirror.ts): the chat service only accepts user
 * messages and writes the answers itself, so a mirrored session is either one
 * bubble holding the whole transcript or a replay with Trae's *new* answers.
 * TRAE SOLO CN shares its local-mode sessions — which the chat service never
 * saw either — by uploading the messages themselves (report v2 §7, solo-lite
 * 0.1.61 `424.d691e580.mjs`, `ee` / `$`):
 *
 *   POST {remote}/api/remote/v1/share/local_conversation
 *   { local_session_id, chat_session_id, source_updated_at, title, mode,
 *     anonymous, creator_name, messages: [...], resources: [], env: 'local' }
 *   → { share_session_id, status: 'active' | 'auditing' | 'audit_failed', … }
 *
 * The server stores those messages as sent, so no model call is made and the
 * page shows exactly what happened here. It does not check the session is
 * real — any `local_session_id` is accepted (report v3 §5.2) — and refuses
 * more than 50 turns (`messages exceed maximum of 50 turns`), an empty list,
 * and the read-only `chat_start_time` / `chat_end_time` (all `991102`).
 *
 * A message's `content` is the chat service's own shape, read off a real share:
 *
 *   user       [{"text_content": "…", "type": "text"}]   (+ `query` in send form)
 *   assistant  {"messages": [{"id", "type": "plan_item", "plan_item": {…}}], "task_id"}
 *
 * where a plan item is one step — `thought` (said), `reasoning_content`
 * (thought privately), `tool_call_info: {id, name, params, result}` — and the
 * answer is the last step: the `finish` tool, its `params.summary` the text.
 * The page renders a step by its tool name, so dsh's tool names are mapped onto
 * the families the renderer knows (`Shell`, `Read`, `Write`, `Edit`, `LS`,
 * `Grep`, `WebSearch`, `WebFetch`, `TodoWrite`, `AskUserQuestion`); anything
 * else keeps its own name.
 */

import { createHash } from 'node:crypto'
import type { ContentBlock, RequestMessage } from '@deepseek-ai/dsh-llm'

/** Most turns one share carries (client: `cannot share more than 50 turns`). */
export const LOCAL_SHARE_TURNS = 50
/** Steps kept per answer; a long agent loop keeps its latest ones. */
export const LOCAL_SHARE_STEPS = 120
/** Longest text kept per field (a tool's output, a thought, an argument). */
export const LOCAL_SHARE_FIELD_CHARS = 4_000
/** Longest question or answer kept: those are what the page is read for. */
export const LOCAL_SHARE_TEXT_CHARS = 20_000

export interface ToolStep {
  id: string
  name: string
  /** The call's arguments, parsed when they are JSON. */
  args: Record<string, unknown>
  /** What came back, as text. */
  output?: string
  isError?: boolean
}

export interface TurnStep {
  /** Text the model said before this step's tool call. */
  text?: string
  reasoning?: string
  tool?: ToolStep
}

export interface ConversationTurn {
  user: string
  steps: TurnStep[]
  answer: string
  answerReasoning?: string
  /** Picker id of the model that answered, when known. */
  model?: string
}

/**
 * Lines the harness writes into a user message for the model's benefit, not
 * the user's: a model switch notice and the three lines of the time-context
 * snapshot (`packages/context/time-context/src/index.ts` `renderText`):
 *
 *   Time sampled while preparing turn N, step M: <timestamp>
 *   Browser time zone for this request: <zone>. <instruction>
 *   Elapsed since the preceding model-visible message|step context: <duration>
 *
 * They would read as part of the question — and, being the first line of the
 * first message, as the title of a share. `isContextMessage` already drops the
 * message whole; this is the second line of defence for a request whose
 * `source` did not survive, and for a user message the model switch annotated.
 */
const HARNESS_NOTES = [
  /^\[model changed:[^\]]*\]\s*$/,
  /^Time sampled while preparing turn \d+, step \d+: .*$/,
  /^Browser time zone for this request: .*$/,
  /^Elapsed since the preceding (?:model-visible message|step context): .*$/,
]

function stripNotes(text: string): string {
  return text
    .split('\n')
    .filter(line => !HARNESS_NOTES.some(re => re.test(line.trim())))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** A user-role message the harness wrote (`source.kind` other than `user`). */
export function isContextMessage(message: RequestMessage): boolean {
  const kind = (message as { source?: { kind?: unknown } }).source?.kind
  return message.role === 'user' && typeof kind === 'string' && kind !== 'user'
}

function blocks(message: RequestMessage): readonly ContentBlock[] {
  const content = (message as { content?: readonly ContentBlock[] | string }).content
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  return Array.isArray(content) ? content : []
}

function textOf(content: readonly ContentBlock[]): string {
  return content.filter(b => b.type === 'text').map(b => (b as { text: string }).text).join('\n').trim()
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>
    return { input: parsed }
  } catch {
    return raw ? { input: raw } : {}
  }
}

/**
 * One finished request's history plus its final answer -> turns.
 *
 * A turn opens at each user message that carries text (tool results are their
 * own `tool` role, and `developer` / `system` context is not part of what was
 * said). Inside it, every assistant message's tool calls become steps — with
 * the text and reasoning that came before each call — and a tool message fills
 * in the result of the call it answers. An assistant message without calls is
 * that turn's answer. The request in hand stops before its own answer, which
 * is why `answer` / `reasoning` are passed separately and close the last turn.
 */
export function conversationTurns(
  messages: readonly RequestMessage[],
  answer: string,
  options: { reasoning?: string; model?: string } = {},
): ConversationTurn[] {
  const turns: ConversationTurn[] = []
  const calls = new Map<string, ToolStep>()
  let current: ConversationTurn | undefined
  for (const message of messages) {
    const content = blocks(message)
    if (message.role === 'user') {
      // The harness sends its own context as user messages too — the runtime
      // snapshot, the sampled clock and time zone, … — each with a `source`
      // whose kind is not `user`. Those are for the model, not part of what
      // was asked.
      if (isContextMessage(message)) continue
      const text = stripNotes(textOf(content))
      if (!text) continue
      current = { user: text, steps: [], answer: '' }
      turns.push(current)
      continue
    }
    if (!current) continue // a greeting before anyone asked anything
    if (message.role === 'assistant') {
      const model = (message as { source?: { model?: string } }).source?.model
      if (model) current.model = model
      let said = ''
      let thought = ''
      let called = false
      for (const block of content) {
        if (block.type === 'text') said = said ? `${said}\n${block.text}` : block.text
        else if (block.type === 'reasoning') thought = thought ? `${thought}\n${block.text}` : block.text
        else if (block.type === 'tool-call') {
          const tool: ToolStep = { id: String(block.id), name: block.name, args: parseArgs(block.arguments) }
          calls.set(tool.id, tool)
          current.steps.push({
            ...said.trim() ? { text: said.trim() } : {},
            ...thought.trim() ? { reasoning: thought.trim() } : {},
            tool,
          })
          said = ''
          thought = ''
          called = true
        }
      }
      if (!called) {
        // No call: this message answered the turn.
        current.answer = said.trim()
        if (thought.trim()) current.answerReasoning = thought.trim()
      } else if (said.trim() || thought.trim()) {
        // Words after the last call in the same message: a step of their own.
        current.steps.push({ ...said.trim() ? { text: said.trim() } : {}, ...thought.trim() ? { reasoning: thought.trim() } : {} })
      }
      continue
    }
    if (message.role === 'tool') {
      const id = String((message as { toolCallId?: string }).toolCallId ?? '')
      const tool = calls.get(id)
      if (!tool) continue
      tool.output = textOf(content)
      if ((message as { isError?: boolean }).isError) tool.isError = true
    }
  }
  const last = turns[turns.length - 1]
  if (last) {
    if (answer.trim()) last.answer = answer.trim()
    if (options.reasoning?.trim()) last.answerReasoning = options.reasoning.trim()
    if (options.model) last.model = options.model
  }
  return turns
}

// ------------------------------------------------------------------ wire

/** A 24-hex id like the chat service's ObjectIds, stable for the same seed. */
export function objectId(seed: string): string {
  return createHash('sha1').update(seed).digest('hex').slice(0, 24)
}

const clip = (text: string | undefined, max = LOCAL_SHARE_FIELD_CHARS): string => {
  if (!text) return ''
  return text.length <= max ? text : `${text.slice(0, max)}\n…（已截断，原文 ${text.length} 字）`
}

function clipArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(args)) {
    out[key] = typeof value === 'string' ? clip(value) : value
  }
  return out
}

const pick = (args: Record<string, unknown>, ...keys: string[]): string | undefined => {
  for (const key of keys) if (typeof args[key] === 'string' && args[key]) return args[key] as string
  return undefined
}

/**
 * dsh tool -> the Trae tool family the share page renders, with the argument
 * names that family reads added beside the tool's own (which stay, so nothing
 * the call carried is lost).
 */
export function traeTool(name: string, args: Record<string, unknown>): { name: string; params: Record<string, unknown> } {
  const n = name.toLowerCase()
  const path = pick(args, 'file_path', 'path', 'file', 'filename', 'filePath', 'target_file')
  const params = clipArgs(args)
  if (/^(bash|shell|sh|exec|exec_command|run_command|run|terminal|command)$/.test(n) || /bash|shell|exec|command/.test(n)) {
    const command = pick(args, 'command', 'cmd', 'script', 'input') ?? ''
    return { name: 'Shell', params: { ...params, command: clip(command), description: pick(args, 'description') ?? '' } }
  }
  if (/^(read|read_file|view|view_file|cat|open)$/.test(n)) return { name: 'Read', params: { ...params, ...path ? { file_path: path } : {} } }
  if (/^(write|write_file|create|create_file|write_to_file)$/.test(n)) return { name: 'Write', params: { ...params, ...path ? { file_path: path } : {} } }
  if (/edit|replace|patch|apply/.test(n)) return { name: 'Edit', params: { ...params, ...path ? { file_path: path } : {} } }
  if (/^(ls|list|list_dir|list_files|view_folder|tree)$/.test(n)) return { name: 'LS', params: { ...params, ...path ? { path } : {} } }
  if (/^glob$/.test(n)) return { name: 'Glob', params }
  if (/grep|search_files|file_search|find|ripgrep|rg/.test(n)) return { name: 'Grep', params }
  if (/web_?search|search_web|websearch/.test(n)) return { name: 'WebSearch', params: { ...params, query: pick(args, 'query', 'q') ?? '' } }
  if (/fetch|browse|http|url/.test(n)) return { name: 'WebFetch', params: { ...params, url: pick(args, 'url', 'uri') ?? '' } }
  if (/todo/.test(n)) return { name: 'TodoWrite', params }
  if (/ask_user|question/.test(n)) return { name: 'AskUserQuestion', params }
  return { name, params }
}

function toolResult(tool: ToolStep, name: string): Record<string, unknown> {
  const status = tool.isError ? 'error' : 'success'
  const output = clip(tool.output)
  if (name === 'Shell') {
    return {
      status,
      images: null,
      is_truncated: null,
      render: null,
      data: {
        display_command: typeof (tool.args.command ?? tool.args.cmd) === 'string' ? clip(String(tool.args.command ?? tool.args.cmd)) : '',
        exit_code: tool.isError ? 1 : 0,
        status: 'completed',
        stdout: output,
      },
    }
  }
  return { status, images: null, is_truncated: null, render: null, data: { output } }
}

interface PlanItemInput {
  seed: string
  model: string
  done: boolean
  thought?: string
  reasoning?: string
  tool: { name: string; params: Record<string, unknown>; result: Record<string, unknown> }
  at: number
}

function planItem(input: PlanItemInput): Record<string, unknown> {
  return {
    id: objectId(`${input.seed}:entry`),
    type: 'plan_item',
    plan_item: {
      agent_display_name: input.model || 'DeepSeek Harness',
      agent_id: 'solo_work_lite',
      agent_status: { run_mode: 'foreground', status: input.done ? 'completed' : 'running' },
      hide: null,
      id: objectId(`${input.seed}:plan`),
      plan_type: null,
      reasoning_content: clip(input.reasoning),
      render_mode: null,
      thought: clip(input.thought),
      timing: { generated_at_ms: input.at, tool_call_started_at_ms: input.at, tool_call_finished_at_ms: input.at },
      tool_call_info: {
        id: objectId(`${input.seed}:call`),
        name: input.tool.name,
        params: input.tool.params,
        result: input.tool.result,
      },
    },
  }
}

export interface LocalShareOptions {
  /** The dsh session id; seeds every id so a re-share names the same things. */
  sessionId: string
  title?: string
  anonymous?: boolean
  creatorName?: string
  /** When each turn was first seen, by turn index; missing = `updatedAt`. */
  turnTimes?: readonly number[]
  /** When the session last changed, in ms. */
  updatedAt: number
}

/** Turns -> the `share/local_conversation` request body. */
export function localShareBody(turns: readonly ConversationTurn[], options: LocalShareOptions): {
  body: Record<string, unknown>
  turns: number
  dropped: number
} {
  const kept = turns.filter(turn => turn.user && (turn.answer || turn.steps.length > 0))
  const shown = kept.slice(Math.max(0, kept.length - LOCAL_SHARE_TURNS))
  const offset = kept.length - shown.length
  const session = objectId(`dsh:${options.sessionId}`)
  const messages: Record<string, unknown>[] = []
  // The server orders a local conversation by `created_at` and renumbers
  // `message_index` from that, falling back to the given index only when every
  // time is equal (report v3 §5.2). Turns seen before the plugin started all
  // share one "first seen" time, so each message gets a strictly later stamp
  // than the one before it, or the page could shuffle them.
  let clock = 0
  const stamp = (at: number): string => {
    clock = Math.max(at, clock + 1)
    return new Date(clock).toISOString()
  }
  shown.forEach((turn, index) => {
    const n = offset + index
    const at = options.turnTimes?.[n] ?? options.updatedAt
    const seed = `${session}:${n}`
    const userId = objectId(`${seed}:user`)
    const turnId = objectId(`${seed}:turn`)
    const model = turn.model ?? ''
    messages.push({
      message_id: userId,
      turn_id: turnId,
      status: 'completed',
      message_type: 'general',
      role: 'user',
      message_index: messages.length + 1,
      content: JSON.stringify([{ text_content: clip(turn.user, LOCAL_SHARE_TEXT_CHARS), type: 'text' }]),
      query: JSON.stringify([{ type: 'text', data: { content: clip(turn.user, LOCAL_SHARE_TEXT_CHARS) } }]),
      agent_type: 'solo_work_lite',
      created_at: stamp(at),
    })
    const steps = turn.steps.slice(Math.max(0, turn.steps.length - LOCAL_SHARE_STEPS))
    // Words with no call of their own ride on the next step's thought (the
    // page has no step kind for "only spoke"), the last ones on the answer's.
    let carry: { text: string[]; reasoning: string[] } = { text: [], reasoning: [] }
    const take = (step: TurnStep): { thought?: string; reasoning?: string } => {
      const text = [...carry.text, ...step.text ? [step.text] : []].join('\n\n')
      const reasoning = [...carry.reasoning, ...step.reasoning ? [step.reasoning] : []].join('\n\n')
      carry = { text: [], reasoning: [] }
      return { ...text ? { thought: text } : {}, ...reasoning ? { reasoning } : {} }
    }
    const items: Record<string, unknown>[] = []
    steps.forEach((step, i) => {
      if (!step.tool) {
        if (step.text) carry.text.push(step.text)
        if (step.reasoning) carry.reasoning.push(step.reasoning)
        return
      }
      const mapped = traeTool(step.tool.name, step.tool.args)
      items.push(planItem({
        seed: `${seed}:step${i}`, model, done: false, at,
        ...take(step),
        tool: { ...mapped, result: toolResult(step.tool, mapped.name) },
      }))
    })
    const tail = take({})
    // The answer, as the client writes it: the `finish` tool's summary.
    const answerReasoning = [tail.reasoning, turn.answerReasoning].filter(Boolean).join('\n\n')
    items.push(planItem({
      seed: `${seed}:finish`, model, done: true, at,
      ...tail.thought ? { thought: tail.thought } : {},
      ...answerReasoning ? { reasoning: answerReasoning } : {},
      tool: {
        name: 'finish',
        params: { summary: clip(turn.answer, LOCAL_SHARE_TEXT_CHARS) || '（这一轮没有文字回答）' },
        result: { status: 'success', images: null, is_truncated: null, render: null, data: { products: null, summary: '' } },
      },
    }))
    messages.push({
      message_id: objectId(`${seed}:assistant`),
      turn_id: turnId,
      status: 'completed',
      message_type: 'task',
      role: 'assistant',
      message_index: messages.length + 1,
      reply_to_message_id: userId,
      content: JSON.stringify({ messages: items, task_id: objectId(`${seed}:task`) }),
      // `chat_start_time` / `chat_end_time` are read-only: either one on any
      // message gets the whole body refused with a bare `991102 invalid
      // parameter` (report v3 §5.2, found by bisecting a read-back share).
      references: '[]',
      doc_references: '{"documents":[]}',
      agent_type: 'solo_work_lite',
      agent_name: model || 'DeepSeek Harness',
      created_at: stamp(at),
    })
  })
  const firstQuestion = shown[0]?.user.split('\n').find(line => line.trim())?.trim() ?? ''
  const title = (options.title?.trim() || firstQuestion || 'DeepSeek Harness 对话').slice(0, 60)
  return {
    body: {
      local_session_id: session,
      chat_session_id: session,
      source_updated_at: new Date(options.updatedAt).toISOString(),
      title,
      mode: 'work',
      anonymous: options.anonymous === true,
      creator_name: (options.creatorName ?? '').trim(),
      messages,
      resources: [],
      env: 'local',
    },
    turns: shown.length,
    dropped: offset,
  }
}
