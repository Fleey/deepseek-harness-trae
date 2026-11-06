/**
 * 把一段对话镜像进 Trae 聊天服务，再铸成一条**消费站**分享链接。
 *
 * 为什么需要这一层（而不是直接调 share.create）：
 *
 * `llm_raw_chat`（adapter.ts）是模型接口，请求里没有任何 message id，会话 id
 * 是本地 sha1 出来的 UUID（wire.ts `conversationUuid`）。分享属于聊天服务，
 * 要的是聊天服务自己签发的 `chat_session_id` 和每条消息的 `message_id`。两套
 * id 空间不通用，所以「分享当前 dsh 会话」只能先在聊天服务里造出一个等价
 * 会话 —— 也就是这个模块。
 *
 * ## 成本，说在前面
 *
 * 每个 user 回合都是一次**真实的模型调用**：`sendMessage` 立刻返回
 * `accepted` 和一个 `message_id`，但 `turn_id` 要等助手消息落地后服务端才
 * 回填。没有「只存不跑」的通道 —— `batch_sync_history` 要服务端签发的
 * `handoff_id`（自造 409 991210），`sendMessage` 的 `dry_run`/`append_only`
 * 之类参数被静默忽略。
 *
 * 等结算的理由不是「否则铸不进去」：拿刚返回的 `message_id` 立刻铸链接也会
 * 200。理由是**早了铸出来的是冻结快照** —— 只有那条 `in_progress` 的 user
 * 消息，助手回答永不补进来（share.ts `chat writes` 段有 35 秒的实测记录）。
 * 镜像要的是带答案的链接，所以每轮都得等。
 *
 * 所以 `mirrorConversation` 的 `turns` 长度就是这次要花的模型调用次数。
 * 调用方应当先问过用户，再传一个明确的 `maxTurns`；本模块不替你决定。
 *
 * ## 为什么镜像到消费站
 *
 * 两套部署是**独立的分享命名空间**（实测双向）：
 *
 *   在 work.trae.cn 铸       → share.traecontent.cn 200 / 企业站 404 992700
 *   在 api.enterprise.trae.cn 铸 → 企业站 200 / share.traecontent.cn 404 992700
 *
 * 而且只有消费站的 `/share/<id>` 页面**不用登录**就能看（企业站那个页面渲染
 * 出来是登录表单，尽管它的数据接口匿名可读）。链接要发给租户外的人，就必须
 * 铸在消费站。企业 PAT 在消费站里建会话/发消息/铸链接全部 200（实测），
 * 所以这不需要另一个账号 —— 只提示一点：那些回合算谁的额度，接口不说。
 */

import type { TraeAuth } from './auth.ts'
import { SHARE_API_ORIGIN, ShareError, shareOriginFor, shareUrl, TraeShare, type ShareLink } from './share.ts'

/** 一句话一个回合：镜像只关心「谁说了什么」。 */
export interface MirrorTurn {
  role: 'user' | 'assistant'
  text: string
}

export interface MirrorOptions {
  /** 聊天服务所在的站点；空 = 消费站写接口 `trae-api-cn.mchost.guru`（报告 v2）。 */
  host?: string
  auth: TraeAuth
  userAgent: string
  logger?: { info(...a: unknown[]): void; warn(...a: unknown[]): void }
}

/** 一次镜像的结果，含代价。 */
export interface MirrorResult {
  chatSessionId: string
  /** 已经落地、可以拿去分享的 user 消息 id。 */
  userMessageIds: string[]
  /** 实际发生的模型调用次数 —— 等于 true 的 `role` 只有 user。 */
  modelCalls: number
  /** 助手回答的纯文本（截断前的原文各自保留在 turns 里）。 */
  answers: string[]
  /** 镜像没有跑完时（超时/取消）已落地的回合。 */
  partial: boolean
}

/**
 * 从一条消息的 `content` 里取可读文本。
 *
 * 两种形态（同一接口，按 role 分）：
 *
 *   user      `[{"type":"text","text_content":"…"}]`
 *   assistant `{"task_id":"…","messages":[{"type":"plan_item","plan_item":{…}}]}`
 *
 * 助手侧没有「一句话答案」这种字段：一个回合是若干 plan_item，模型最后调用
 * `finish` 工具收尾，**答案在 `tool_call_info.params.summary` 里**（实测：
 * 问「3+3」得到 `{"name":"finish","params":{"summary":"6"}}`）。`thought` 与
 * `reasoning_content` 是过程，不是答案，所以放在最后的兜底位。
 */
export function textOfContent(content: string | undefined): string {
  if (!content) return ''
  let parsed: unknown
  try { parsed = JSON.parse(content) } catch { return content }

  // user: [{type:'text', text_content}]
  if (Array.isArray(parsed)) {
    return parsed
      .map(part => {
        if (typeof part !== 'object' || part === null) return ''
        const p = part as Record<string, unknown>
        return typeof p.text_content === 'string' ? p.text_content : ''
      })
      .filter(Boolean)
      .join('\n')
  }
  if (typeof parsed !== 'object' || parsed === null) return ''

  // assistant: {messages:[{plan_item:{tool_call_info:{name:'finish',params:{summary}}}}]}
  const messages = (parsed as Record<string, unknown>).messages
  if (!Array.isArray(messages)) return ''
  const summaries: string[] = []
  const thoughts: string[] = []
  for (const entry of messages) {
    if (typeof entry !== 'object' || entry === null) continue
    const plan = (entry as Record<string, unknown>).plan_item
    if (typeof plan !== 'object' || plan === null) continue
    const info = (plan as Record<string, unknown>).tool_call_info
    if (typeof info === 'object' && info !== null) {
      const params = (info as Record<string, unknown>).params
      if (typeof params === 'object' && params !== null) {
        const summary = (params as Record<string, unknown>).summary
        if (typeof summary === 'string' && summary.trim()) summaries.push(summary.trim())
      }
    }
    // 过程文本只作兜底：一个回合可能只有思考没有 summary（被中断时）。
    for (const key of ['thought', 'reasoning_content']) {
      const text = (plan as Record<string, unknown>)[key]
      if (typeof text === 'string' && text.trim()) thoughts.push(text.trim())
    }
  }
  return summaries.join('\n') || thoughts.join('\n')
}

/**
 * 把 `turns` 按顺序喂进一条新会话。
 *
 * - assistant 回合**不发**：聊天服务的助手消息来自模型，不能注入。所以
 *   assistant 的文本只用作上下文提示吗？不能——服务端不读。它在这里仅用于
 *   对齐结构，实际只有 user 回合会产生请求。
 * - 每个 user 回合都等模型跑完才进下一轮。不是怕 `createShare` 拒绝 —— 挂起
 *   状态也能铸成功 —— 而是怕铸出一张停在 `in_progress`、没有答案的快照。
 * - `maxTurns` 是硬上限：超出就停，返回 `partial: true`。不做静默截断，因为
 *   每一截断都省掉一次真实模型调用，这件事要显式。
 */
export async function mirrorConversation(
  turns: readonly MirrorTurn[],
  options: MirrorOptions & {
    /** 最多发几个 user 回合；必填，防止无意中把长会话整段烧掉。 */
    maxTurns: number
    /** 单个回合等模型的上限，默认 120s。 */
    turnTimeoutMs?: number
    signal?: AbortSignal
  },
): Promise<MirrorResult> {
  const host = (options.host?.trim() || '').replace(/\/+$/, '') || undefined
  const share = new TraeShare({
    host: host ?? SHARE_API_ORIGIN,
    auth: options.auth,
    userAgent: options.userAgent,
    ...options.logger ? { logger: options.logger } : {},
    ttlMs: 0,
  })

  const users = turns.filter(t => t.role === 'user')
  if (users.length === 0) throw new ShareError('没有 user 回合可镜像', -1)
  if (options.maxTurns <= 0) throw new ShareError('maxTurns 必须为正数', -1)

  // 只镜像最近的 maxTurns 个 user 回合：分享的通常是后半段。
  const wanted = users.slice(Math.max(0, users.length - options.maxTurns))
  options.logger?.info(
    `dsh-trae2api: 镜像 ${wanted.length} 个回合到 ${share.host}（= ${wanted.length} 次模型调用）`,
  )

  const chatSessionId = await share.createSession('work', 'remote', options.signal)
  const userMessageIds: string[] = []
  const answers: string[] = []
  let partial = false

  for (const turn of wanted) {
    if (options.signal?.aborted) { partial = true; break }
    const messageId = await share.sendMessage(chatSessionId, turn.text, options.signal)
    try {
      const settled = await share.waitForTurn(chatSessionId, messageId, {
        ...options.turnTimeoutMs !== undefined ? { timeoutMs: options.turnTimeoutMs } : {},
        ...options.signal ? { signal: options.signal } : {},
      })
      userMessageIds.push(settled.userMessageId)
      answers.push(textOfContent(settled.answer))
      options.logger?.info(
        `dsh-trae2api: 回合落地 ${settled.userMessageId}`
        + (settled.turnId ? `（turn ${settled.turnId}）` : ''),
      )
    } catch (error) {
      // 已发生的调用不能当没发生：把 id 记下来，标记 partial，让调用方决定
      // 是拿半截成绩铸链接，还是整个删掉。
      userMessageIds.push(messageId)
      partial = true
      const reason = error instanceof Error ? error.message : String(error)
      options.logger?.warn(`dsh-trae2api: 回合 ${messageId} 未结算（${reason}），镜像中止`)
      break
    }
  }

  return { chatSessionId, userMessageIds, modelCalls: userMessageIds.length, answers, partial }
}

/**
 * 镜像 + 铸一条消费站链接。
 *
 * 返回的 `url` 一定拼在 `share.traecontent.cn` 上 —— 那是唯一不需要登录就能
 * 打开的分享站（见文件头）。落地站由 `shareOriginFor(writer.host)` 决定，
 * 不硬编码，以防有人把 `host` 指到企业站上。
 */
export async function mirrorAndShare(
  turns: readonly MirrorTurn[],
  options: MirrorOptions & {
    maxTurns: number
    creatorName?: string
    anonymous?: boolean
    turnTimeoutMs?: number
    signal?: AbortSignal
  },
): Promise<MirrorResult & { link: ShareLink; url: string }> {
  const mirrored = await mirrorConversation(turns, options)
  if (mirrored.userMessageIds.length === 0) {
    throw new ShareError('镜像没有落地任何回合，无法生成分享', -1)
  }
  const host = (options.host?.trim() || '').replace(/\/+$/, '') || SHARE_API_ORIGIN
  const share = new TraeShare({
    host, auth: options.auth, userAgent: options.userAgent,
    ...options.logger ? { logger: options.logger } : {},
    ttlMs: 0,
  })
  const link = await share.create({
    chatSessionId: mirrored.chatSessionId,
    turnIds: mirrored.userMessageIds,
    anonymous: options.anonymous === true,
    ...options.creatorName ? { creatorName: options.creatorName } : {},
    ...options.signal ? { signal: options.signal } : {},
  })
  // 链接站点跟着「铸它的那套」走，而不是固定常量。
  const origin = shareOriginFor(share.host)
  return { ...mirrored, link, url: shareUrl(link.shareSessionId, origin) }
}
