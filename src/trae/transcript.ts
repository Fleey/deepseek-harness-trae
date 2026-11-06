/**
 * What a dsh session said, as far as this plugin saw it — the raw material for
 * "share this session".
 *
 * The harness keeps the conversation in its own storage, which a plugin should
 * not parse. What the plugin does see is every agent-loop request: its
 * `messages` are the whole history up to that request, and the turn's final
 * answer comes back through the stream. So after each finished Trae turn the
 * transcript is rebuilt from the two and kept in memory, per session.
 *
 * Only text survives: tool calls, tool results, images and reasoning are what
 * the agent did, not what was said, and the share page shows prose. Several
 * assistant texts inside one turn (narration between tool steps, then the
 * answer) collapse into one assistant row, so the rows alternate user /
 * assistant the way a reader expects.
 */

import type { ContentBlock, RequestMessage } from '@deepseek-ai/dsh-llm'
import type { ConversationTurn } from './local-share.ts'

export interface TranscriptRow {
  role: 'user' | 'assistant'
  text: string
}

function textOf(content: readonly ContentBlock[] | string | undefined): string {
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  return content
    .filter(block => block.type === 'text')
    .map(block => (block as { text: string }).text)
    .join('\n')
    .trim()
}

/** One request's history plus the answer it ended with -> alternating rows. */
export function transcriptOf(messages: readonly RequestMessage[], answer = ''): TranscriptRow[] {
  const rows: TranscriptRow[] = []
  const push = (role: TranscriptRow['role'], text: string): void => {
    if (!text) return
    const last = rows[rows.length - 1]
    if (last?.role === role) last.text = `${last.text}\n\n${text}`
    else rows.push({ role, text })
  }
  for (const message of messages) {
    if (message.role !== 'user' && message.role !== 'assistant') continue
    push(message.role, textOf((message as { content?: readonly ContentBlock[] }).content))
  }
  push('assistant', answer.trim())
  return rows
}

/** How many questions a transcript holds — what a turn-by-turn replay costs. */
export function userTurns(rows: readonly TranscriptRow[]): number {
  return rows.filter(row => row.role === 'user').length
}

/**
 * The whole transcript as one message, for sharing it verbatim at the cost of
 * a single model call: the chat service only accepts user messages and makes
 * the answers itself, so the original answers can only travel as text inside
 * one. The lead-in asks the agent to acknowledge and do nothing else.
 *
 * Over `maxChars`, the oldest rows go first and the message says so.
 */
export function transcriptMessage(rows: readonly TranscriptRow[], maxChars = 60_000): { text: string; rows: number; truncated: boolean } {
  // The share page's title comes from this exchange, and an acknowledgement
  // ("已收到对话记录") made a useless one; a title for the conversation is
  // what the reader of the link wants to see at the top.
  const lead = '以下是一段已经结束的对话记录（DeepSeek Harness 里用 Trae 模型完成），只用于分享查看。'
    + '请不要执行任何操作、不要调用任何工具，只回复一行：概括这段对话的标题（不超过 20 个字），不要别的内容。'
  const blocks = rows.map(row => `【${row.role === 'user' ? '用户' : '助手'}】\n${row.text}`)
  let kept = blocks.length
  let body = blocks.join('\n\n')
  while (kept > 1 && body.length > maxChars) {
    kept -= 1
    body = blocks.slice(blocks.length - kept).join('\n\n')
  }
  if (body.length > maxChars) body = `…${body.slice(body.length - maxChars)}`
  const truncated = kept < blocks.length || body.startsWith('…')
  const note = truncated ? `\n\n（记录太长，只保留了最近的 ${kept} 段。）` : ''
  return { text: `${lead}${note}\n\n---\n\n${body}`, rows: kept, truncated }
}

/** What the store keeps of one session. */
export interface KeptSession {
  rows: TranscriptRow[]
  /** The same conversation turn by turn, steps included (local-share.ts). */
  turns: ConversationTurn[]
  /** When each turn was first seen, in ms, by turn index. */
  times: number[]
  /** When this was last updated, in ms. */
  at: number
}

/** Last transcript per session, most recently used last, bounded. */
export class TranscriptStore {
  private readonly kept = new Map<string, KeptSession>()

  constructor(private readonly limit = 64) {}

  set(sessionId: string, rows: TranscriptRow[], turns: ConversationTurn[] = []): void {
    const now = Date.now()
    const previous = this.kept.get(sessionId)
    // A turn keeps the time it was first seen; turns already in the history
    // the first time round all read as "now", which is the best known.
    const times = turns.map((_, i) => previous?.times[i] ?? now)
    this.kept.delete(sessionId)
    this.kept.set(sessionId, { rows, turns, times, at: now })
    while (this.kept.size > this.limit) this.kept.delete(this.kept.keys().next().value!)
  }

  get(sessionId: string): KeptSession | undefined {
    return this.kept.get(sessionId)
  }
}
