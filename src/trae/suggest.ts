/**
 * Next-input suggestions: once a Trae turn ends with a plain answer, ask the
 * same model — cheaply, no tools, lowest thinking level — what the user is
 * likely to type next. The browser half shows it as ghost text in the empty
 * composer and Tab accepts it.
 *
 * Kept per session in memory only; a suggestion belongs to the turn that
 * produced it and is replaced (or dropped) by the next one.
 */

import { randomUUID } from 'node:crypto'
import type { ContentBlock, GenerateOptions, RequestMessage } from '@deepseek-ai/dsh-llm'
import type { CueEvent } from './cue.ts'
import { sessionUuid } from './wire.ts'

/** One finished turn, as the adapter saw it. */
export interface FinishedTurn {
  sessionId: string
  /** Picker id of the model that answered. */
  model: string
  /** The request that produced the final answer. */
  options: GenerateOptions
  /** The final answer's visible text. */
  answer: string
}

export interface SuggestionsOptions {
  /** One tool-less completion on `model`; resolves to the visible text. */
  complete(model: string, system: string, user: string, signal: AbortSignal): Promise<string>
  /** Model to ask instead of the one that answered; empty = the same one. */
  model: string
  timeoutMs: number
  /** Report shown/accepted suggestions as Cue events (false = skipped); absent = no reporting. */
  report?: (events: CueEvent[]) => Promise<boolean>
  logger: { warn(...a: unknown[]): void }
}

/** What the composer did with a suggestion. */
export type SuggestionAction = 'shown' | 'accept'

export interface Suggestion {
  /** The suggested next user message; empty when the model had none. */
  text: string
  /** When the turn it follows ended (ms epoch). */
  at: number
  /** Stable id of this suggestion: the `resp_id` its shown/accept events share. */
  id: string
}

interface Entry {
  id: string
  at: number
  /** Upstream conversation id of the session (the chat's own `session_id`). */
  conversationId: string
  pending: Promise<void>
  text: string
  abort: AbortController
  /** When the composer first showed it; undefined until then. */
  shownAt?: number
  accepted: boolean
}

/** Sessions remembered at once; the oldest is forgotten first. */
const MAX_SESSIONS = 64
/** How much of the conversation the suggester sees. */
const USER_TURNS = 3
const USER_CHARS = 1_200
const ANSWER_CHARS = 3_000
/** Longest suggestion kept; anything longer is not a "next input". */
const MAX_SUGGESTION = 200

export const SUGGEST_SYSTEM = [
  'You predict the next message the user will type into a coding-agent chat, right after reading the assistant\'s latest answer.',
  'Write it as the user, in the same language the user writes in, as one short line (at most ~30 Chinese characters or ~15 English words).',
  'Prefer the obvious next step: confirming a proposed action, asking for the follow-up the answer offered, or the natural next request.',
  'Output ONLY that message — no quotes, no prefix, no explanation. If there is no natural follow-up, output nothing.',
].join('\n')

function textOf(content: readonly ContentBlock[]): string {
  return content.filter(b => b.type === 'text').map(b => (b as { text: string }).text).join('\n').trim()
}

const clip = (text: string, max: number, tail = false): string =>
  text.length <= max ? text : tail ? `…${text.slice(-max)}` : `${text.slice(0, max)}…`

/** The suggester's user prompt: the last few user messages and the final answer. */
export function suggestPrompt(turn: Pick<FinishedTurn, 'options' | 'answer'>): string {
  const users: string[] = []
  const messages = turn.options.messages as readonly RequestMessage[]
  for (let i = messages.length - 1; i >= 0 && users.length < USER_TURNS; i--) {
    const message = messages[i]!
    if (message.role !== 'user') continue
    const text = textOf(message.content)
    if (text) users.unshift(clip(text, USER_CHARS))
  }
  return [
    ...users.map((text, i) => `<user_message index="${i + 1}">\n${text}\n</user_message>`),
    `<assistant_answer>\n${clip(turn.answer.trim(), ANSWER_CHARS, true)}\n</assistant_answer>`,
    'The user\'s next message:',
  ].join('\n\n')
}

/** Model output -> one clean line, or '' when it is not usable as a suggestion. */
export function cleanSuggestion(raw: string): string {
  let text = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
  text = text.split(/\r?\n/).map(line => line.trim()).find(line => line.length > 0) ?? ''
  text = text.replace(/^(?:user|用户|下一条消息|next message)\s*[:：]\s*/i, '')
  text = text.replace(/^["'“”‘’「」『』`]+|["'“”‘’「」『』`]+$/g, '').trim()
  if (text.length > MAX_SUGGESTION) return ''
  return text
}

export class TraeSuggestions {
  private readonly entries = new Map<string, Entry>()

  constructor(private readonly opts: SuggestionsOptions) {}

  /** A turn ended with a plain answer: start working out what comes next. */
  turnEnded(turn: FinishedTurn): void {
    if (!turn.answer.trim()) return
    this.drop(turn.sessionId)
    const abort = new AbortController()
    const entry: Entry = {
      id: randomUUID(), at: Date.now(), conversationId: sessionUuid(turn.sessionId),
      text: '', abort, pending: Promise.resolve(), accepted: false,
    }
    entry.pending = this.generate(turn, abort.signal).then(
      (text) => { entry.text = text },
      (error) => {
        if (!abort.signal.aborted) this.opts.logger.warn(`dsh-trae2api: suggestion failed (${error instanceof Error ? error.message : String(error)})`)
      },
    )
    this.entries.set(turn.sessionId, entry)
    while (this.entries.size > MAX_SESSIONS) this.drop(this.entries.keys().next().value!)
  }

  /** A new turn started: whatever was suggested for the last one is stale. */
  turnStarted(sessionId: string): void {
    this.drop(sessionId)
  }

  /**
   * The current suggestion for a session, waiting up to `waitMs` for one that
   * is still being generated. `null` = nothing (yet) for this session.
   */
  async get(sessionId: string, waitMs: number): Promise<Suggestion | null> {
    const entry = this.entries.get(sessionId)
    if (!entry) return null
    if (waitMs > 0) {
      let timer: ReturnType<typeof setTimeout> | undefined
      await Promise.race([entry.pending, new Promise<void>((resolve) => { timer = setTimeout(resolve, waitMs) })])
      clearTimeout(timer)
    }
    // Replaced or dropped while waiting.
    if (this.entries.get(sessionId) !== entry) return null
    return { text: entry.text, at: entry.at, id: entry.id }
  }

  /**
   * The composer showed or accepted suggestion `id`. Each happens at most once
   * per suggestion, and only for the session's current, non-empty one; the
   * visible time is measured here, not taken from the browser. Resolves to
   * whether an event went out.
   */
  async record(sessionId: string, id: string, action: SuggestionAction): Promise<boolean> {
    const entry = this.entries.get(sessionId)
    if (!entry || entry.id !== id || !entry.text || entry.accepted) return false
    const now = Date.now()
    const base = { resp_id: entry.id, type: '', conversation_id: entry.conversationId }
    let event: CueEvent
    if (action === 'shown') {
      if (entry.shownAt !== undefined) return false
      entry.shownAt = now
      event = { event: 'code_gen_shown', payload: base }
    } else {
      entry.accepted = true
      entry.shownAt ??= now
      event = {
        event: 'code_gen_accept',
        payload: {
          ...base,
          accept_content: entry.text,
          accept_prefix: '',
          accept_suffix: '',
          suggestion_visible_duration: now - entry.shownAt,
          tab_mode: '',
        },
      }
    }
    if (!this.opts.report) return false
    try {
      return await this.opts.report([event])
    } catch (error) {
      this.opts.logger.warn(`dsh-trae2api: Cue report failed (${error instanceof Error ? error.message : String(error)})`)
      return false
    }
  }

  private drop(sessionId: string): void {
    const entry = this.entries.get(sessionId)
    if (!entry) return
    entry.abort.abort()
    this.entries.delete(sessionId)
  }

  private async generate(turn: FinishedTurn, signal: AbortSignal): Promise<string> {
    const timeout = AbortSignal.timeout(this.opts.timeoutMs)
    const both = AbortSignal.any([signal, timeout])
    const raw = await this.opts.complete(this.opts.model || turn.model, SUGGEST_SYSTEM, suggestPrompt(turn), both)
    return cleanSuggestion(raw)
  }
}
