/**
 * Next-step choices: once a Trae turn ends with a plain answer, ask the same
 * model — cheaply, no tools, lowest thinking level — which decisions the
 * answer leaves the user (the change it offered, the command it proposed, …)
 * and what the user could answer to each. The browser half shows every
 * decision as its own card above the composer with the model's answers as
 * buttons; a button sends its reply as the user's next message.
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

/** One answer to a card's question: a button. */
export interface SuggestionChoice {
  /** Button text, e.g. "写出改动". */
  label: string
  /** Sent as the user's next message when the button is pressed. */
  reply: string
}

/** One decision the answer leaves the user: a card. */
export interface SuggestionCard {
  /** What the card asks, e.g. "要把加保护逻辑的改动写出来吗？"; may be empty. */
  question: string
  /** The answers offered, recommended first; never empty. */
  choices: SuggestionChoice[]
}

export interface Suggestion {
  /** One card per decision, most likely first; empty when the model had none. */
  cards: SuggestionCard[]
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
  cards: SuggestionCard[]
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
/** Most cards shown at once; each sits above the composer. */
export const MAX_CARDS = 3
/** Most buttons on one card. */
export const MAX_CHOICES = 4
/** Longest question, label or reply kept; anything longer is not a quick choice. */
const MAX_TEXT = 200

export const SUGGEST_SYSTEM = [
  'You read a coding-agent chat right after the assistant\'s latest answer and work out what the user is most likely to decide next:',
  'the actions the answer proposed or offered (a change to write, a command to run, a document to draft, …), or else the obvious follow-up.',
  `Output ONLY a JSON array of 0 to ${MAX_CARDS} cards, most likely first:`,
  '[{"question": "...", "choices": [{"label": "...", "reply": "..."}]}]',
  '- One card per independent decision. Alternatives for the same decision go into the same card as separate choices, never into separate cards.',
  '- "question": one short question to the user (at most ~30 Chinese characters or ~15 English words), e.g. "要把加保护逻辑的改动写出来吗？" or "先做哪一个？".',
  `- "choices": 1 to ${MAX_CHOICES} answers the user would pick from, recommended first. Fit them to the question — they need not be yes/no: name the concrete options when there are several, and include a "not now" style answer only when declining is a real option.`,
  '- "label": the button text, 1 to 6 words (at most ~10 Chinese characters), e.g. "写出改动", "整理成文档", "暂不用".',
  '- "reply": the message sent when the button is pressed, written as the user, e.g. "把加保护逻辑的改动写出来".',
  '- Write everything in the same language the user writes in.',
  'No code fences, no explanation. If the answer leaves the user nothing to decide, output [].',
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
    'The cards, as the JSON array:',
  ].join('\n\n')
}

/** One line of model text -> a clean phrase, or '' when it is not usable. */
function cleanLine(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  let text = raw.trim()
  text = text.replace(/^(?:user|用户|下一条消息|next message)\s*[:：]\s*/i, '')
  text = text.replace(/^["'“”‘’「」『』`]+|["'“”‘’「」『』`]+$/g, '').trim()
  return text.length > MAX_TEXT ? '' : text
}

function choiceOf(item: unknown): SuggestionChoice | undefined {
  if (typeof item === 'string') {
    const text = cleanLine(item)
    return text ? { label: text, reply: text } : undefined
  }
  if (!item || typeof item !== 'object') return undefined
  const { label, reply } = item as { label?: unknown; reply?: unknown }
  // Without a reply the button has nothing to send; without a label it says what it sends.
  const message = cleanLine(reply)
  return message ? { label: cleanLine(label) || message, reply: message } : undefined
}

function cardOf(item: unknown): SuggestionCard | undefined {
  // A bare string is one step the user can only take.
  if (typeof item === 'string') {
    const choice = choiceOf(item)
    return choice ? { question: '', choices: [choice] } : undefined
  }
  if (!item || typeof item !== 'object') return undefined
  const { question, choices } = item as { question?: unknown; choices?: unknown }
  const kept: SuggestionChoice[] = []
  for (const entry of Array.isArray(choices) ? choices : []) {
    const choice = choiceOf(entry)
    if (choice && !kept.some(c => c.reply === choice.reply)) kept.push(choice)
    if (kept.length === MAX_CHOICES) break
  }
  return kept.length > 0 ? { question: cleanLine(question), choices: kept } : undefined
}

/**
 * Model output -> the cards, most likely first. The JSON array is what the
 * model is asked for; a model that answers with a bare line instead still
 * yields that line as one card with one button.
 */
export function parseSuggestions(raw: string): SuggestionCard[] {
  const text = raw.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/```(?:json)?/gi, '').trim()
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  let items: unknown[] | undefined
  if (start !== -1 && end > start) {
    try {
      const parsed: unknown = JSON.parse(text.slice(start, end + 1))
      if (Array.isArray(parsed)) items = parsed
    } catch { /* not JSON after all */ }
  }
  if (!items) {
    const line = text.split(/\r?\n/).map(l => l.trim()).find(l => l.length > 0) ?? ''
    // Half a JSON answer is not a message anyone meant to send.
    items = line && !/^[[{]/.test(line) ? [line] : []
  }
  const cards: SuggestionCard[] = []
  for (const item of items) {
    const card = cardOf(item)
    if (card) cards.push(card)
    if (cards.length === MAX_CARDS) break
  }
  return cards
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
      cards: [], abort, pending: Promise.resolve(), accepted: false,
    }
    entry.pending = this.generate(turn, abort.signal).then(
      (cards) => { entry.cards = cards },
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
    return { cards: entry.cards, at: entry.at, id: entry.id }
  }

  /**
   * The composer showed suggestion `id`'s cards, or the user pressed button
   * `pick.choice` on card `pick.card`. Each happens at most once per
   * suggestion, and only for the session's current, non-empty one; the visible
   * time is measured here, not taken from the browser. Resolves to whether an
   * event went out.
   */
  async record(sessionId: string, id: string, action: SuggestionAction, pick?: { card: number; choice: number }): Promise<boolean> {
    const entry = this.entries.get(sessionId)
    if (!entry || entry.id !== id || entry.cards.length === 0 || entry.accepted) return false
    const now = Date.now()
    const base = { resp_id: entry.id, type: '', conversation_id: entry.conversationId }
    let event: CueEvent
    if (action === 'shown') {
      if (entry.shownAt !== undefined) return false
      entry.shownAt = now
      event = { event: 'code_gen_shown', payload: base }
    } else {
      const chosen = pick ? entry.cards[pick.card]?.choices[pick.choice] : undefined
      if (!chosen) return false
      entry.accepted = true
      entry.shownAt ??= now
      event = {
        event: 'code_gen_accept',
        payload: {
          ...base,
          accept_content: chosen.reply,
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

  private async generate(turn: FinishedTurn, signal: AbortSignal): Promise<SuggestionCard[]> {
    const timeout = AbortSignal.timeout(this.opts.timeoutMs)
    const both = AbortSignal.any([signal, timeout])
    const raw = await this.opts.complete(this.opts.model || turn.model, SUGGEST_SYSTEM, suggestPrompt(turn), both)
    return parseSuggestions(raw)
  }
}
