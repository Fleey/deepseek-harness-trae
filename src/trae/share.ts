/**
 * Trae 分享链接：读一条分享，以及铸一条新的。
 *
 * 这一层和 llm_raw_chat 不是同一套东西，接入前需要分清：
 *
 * - `llm_raw_chat`（adapter.ts）是**模型调用层**，一次 POST 一次回答，请求里
 *   没有 message id —— debug.ts 里那句 "carries **no message ids at all**"
 *   说的就是它。它拿到的 `session_id` 是本插件合成的一个 UUID
 *   （wire.ts `conversationUuid`），只在 prompt 缓存的意义上是"会话"。
 * - 分享走的是**聊天服务层** `/api/remote/v1/share`，参数是
 *   `chat_session_id` + `turn_ids`，这两个都是聊天服务自己签发的不透明 id
 *   （14 字符、大小写敏感、服务端查表，反推不出来）。本插件合成的 UUID 在
 *   这里**不是**合法入参。
 *
 * 所以本模块分两条路，鉴权要求也不同（均为零凭证实测）：
 *
 * | 方法 | 端点 | 匿名 |
 * |---|---|---|
 * | GET | `/api/remote/v1/share/:id` | 200 |
 * | GET | `/api/remote/v1/share/:id/messages` | 200 |
 * | GET | `/api/remote/v1/share/:id/audit_status` | 200 |
 * | POST | `/api/remote/v1/share` | 401 |
 * | PATCH | `/api/remote/v1/share/:id/status` | 401 |
 * | GET | `/api/remote/v1/chat_sessions` | 401 |
 *
 * 读那条路连 PAT 都不用，装好插件就能用；铸链接和列会话要 JWT，走本插件已有
 * 的 `TraeAuth`。
 *
 * 铸一条链接的真实流程（从前端 bundle 逐字段还原）：
 *
 *   POST /api/remote/v1/share
 *   { chat_session_id, turn_ids: [...], anonymous: false, creator_name }
 *   → { share_session_id, status: 'auditing' | 'passed' | 'failed', expires_at }
 *
 *   status === 'auditing' 时轮询 /audit_status（15 次 × 1s，timeout 5s）
 *   → 前台链接 https://share.traecontent.cn/share/<share_session_id>?enter_from=pc
 *
 * `turn_ids` 来自消息对象自带的 `turn_id` 字段，前端硬上限 50。
 */

import type { TraeAuth } from './auth.ts'

/** CN 前台站；分享链接就是拼在这个 origin 后面。 */
export const SHARE_ORIGIN = 'https://share.traecontent.cn'
/** 所有分享接口共用的前缀。 */
export const SHARE_PATH = '/api/remote/v1/share'
/** 聊天服务的会话列表 —— 真 `chat_session_id` 从这里来。 */
export const SESSIONS_PATH = '/api/remote/v1/chat_sessions'
/** 前端硬上限（bundle: `JW = 50`）。 */
export const TURN_LIMIT = 50
/** 审核轮询：bundle 里是 `for (i = 0; i < 15; i++)` + `sleep(1e3)`。 */
export const AUDIT_ATTEMPTS = 15
export const AUDIT_INTERVAL_MS = 1000
export const AUDIT_TIMEOUT_MS = 5000

/**
 * 分享接口自己的业务码。和 llm_raw_chat 的 3003/4023/4027 不是一个体系，
 * 这组 9927xx 全部来自聊天服务。
 */
export const SHARE_CODES: Readonly<Record<number, string>> = {
  992700: '分享不存在（或已被删除）',
  992701: '无权访问这条分享',
  992702: '分享已被撤销',
  992704: '源会话不可用',
  992705: '无权访问源会话',
  992706: '分享已过期',
  992707: '分享仍在审核中',
  993202: '工件分享不存在',
  993400: '同一条会话已有冲突的分享',
  993401: '内容审核未通过',
  993403: '会话分享资源数量超限',
  1001: '未鉴权：PAT 缺失或失效',
}

type Json = Record<string, unknown>
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)

function field(obj: Json | undefined, ...keys: string[]): unknown {
  if (!obj) return undefined
  for (const key of keys) if (obj[key] !== undefined && obj[key] !== null) return obj[key]
  return undefined
}

/** 会话元数据，字段名按服务端原样。 */
export interface ShareSession {
  shareSessionId: string
  title?: string
  mode?: string
  createdAt?: string
  creatorName?: string
  anonymous: boolean
  /** `active` / `deleted` / `auditing` / `banned`。 */
  status?: string
  /** `all`（对话）/ `artifact`（HTML 工件）。 */
  shareType?: string
  artifactPath?: string
  expiresAt?: string
  /**
   * 附件直链。服务端给的是一个 **JSON 字符串**，这里已经解开：
   * path -> { download_url, entry_url?, file_token?, content_length? }。
   * 这些链接是 TOS 预签名地址，且 CDN 侧有 Referer 闸门 —— 直接 curl 是
   * 403，必须带 `Referer: https://share.traecontent.cn/`。
   */
  entries: Readonly<Record<string, ShareEntry>>
  /** 原始响应体，排障用。 */
  raw: Json
}

export interface ShareEntry {
  downloadUrl?: string
  entryUrl?: string
  fileToken?: string
  contentLength?: number
}

/** 一条消息。`content` / `query` 都是 JSON 字符串，保持原样不递归解。 */
export interface ShareMessage {
  shareSessionId: string
  messageId: string
  role: 'user' | 'assistant' | string
  /** `general`（用户提问）/ `task`（助手回答）。 */
  messageType?: string
  status?: string
  messageIndex?: number
  agentType?: string
  createdAt?: string
  /** 助手消息这样拿到，也正是 `turn_ids` 要填的东西。 */
  turnId?: string
  replyToMessageId?: string
  content?: string
  query?: string
}

/** 铸出来的链接。 */
export interface ShareLink {
  shareSessionId: string
  url: string
  status?: string
  expiresAt?: string
  /** 审核轮询了几次；0 = 服务端直接 passed。 */
  auditPolls: number
}

/** 分享接口的业务错误，`code` 保留服务端原值。 */
export class ShareError extends Error {
  constructor(message: string, readonly code: number, readonly status?: number) {
    super(message)
    this.name = 'ShareError'
  }
}

function describe(code: number, message: unknown): string {
  const reason = SHARE_CODES[code]
  const detail = typeof message === 'string' && message.trim() ? message.trim() : ''
  if (reason && detail) return `${reason}（${code}）：${detail}`
  if (reason) return `${reason}（${code}）`
  return detail ? `${code}：${detail}` : String(code)
}

/** 服务端把 `artifact_entries` 打包成一个 JSON 字符串再套在字段里，要解两层。 */
export function parseEntries(value: unknown): Record<string, ShareEntry> {
  let parsed: unknown = value
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value) } catch { return {} }
  }
  if (!isObject(parsed)) return {}
  const out: Record<string, ShareEntry> = {}
  for (const [path, entry] of Object.entries(parsed)) {
    if (!isObject(entry)) continue
    const downloadUrl = field(entry, 'download_url', 'downloadUrl')
    const entryUrl = field(entry, 'entry_url', 'entryUrl')
    const fileToken = field(entry, 'file_token', 'fileToken')
    const contentLength = Number(field(entry, 'content_length', 'contentLength'))
    out[path] = {
      ...typeof downloadUrl === 'string' ? { downloadUrl } : {},
      ...typeof entryUrl === 'string' ? { entryUrl } : {},
      ...typeof fileToken === 'string' ? { fileToken } : {},
      ...Number.isFinite(contentLength) && contentLength >= 0 ? { contentLength } : {},
    }
  }
  return out
}

/** 一个 `/share/:id` 响应体 -> `ShareSession`。 */
export function parseSession(body: unknown): ShareSession {
  if (!isObject(body)) throw new ShareError('分享响应不是 JSON 对象', -1)
  const code = Number(field(body, 'code') ?? 0)
  if (code !== 0) throw new ShareError(describe(code, field(body, 'message')), code)
  const data = field(body, 'data')
  if (!isObject(data)) throw new ShareError('分享响应里没有 data', 0)
  const id = field(data, 'share_session_id', 'shareSessionId')
  if (typeof id !== 'string' || !id) throw new ShareError('分享响应里没有 share_session_id', 0)
  const str = (...keys: string[]): string | undefined => {
    const v = field(data, ...keys)
    return typeof v === 'string' && v ? v : undefined
  }
  return {
    shareSessionId: id,
    ...str('title') ? { title: str('title')! } : {},
    ...str('mode') ? { mode: str('mode')! } : {},
    ...str('created_at', 'createdAt') ? { createdAt: str('created_at', 'createdAt')! } : {},
    ...str('creator_name', 'creatorName') ? { creatorName: str('creator_name', 'creatorName')! } : {},
    anonymous: field(data, 'anonymous') === true,
    ...str('status') ? { status: str('status')! } : {},
    ...str('share_type', 'shareType') ? { shareType: str('share_type', 'shareType')! } : {},
    ...str('artifact_path', 'artifactPath') ? { artifactPath: str('artifact_path', 'artifactPath')! } : {},
    ...str('expires_at', 'expiresAt') ? { expiresAt: str('expires_at', 'expiresAt')! } : {},
    entries: parseEntries(field(data, 'artifact_entries', 'artifactEntries')),
    raw: data,
  }
}

/** 一个 `/share/:id/messages` 响应体 -> 消息数组（单页）。 */
export function parseMessages(body: unknown): { items: ShareMessage[]; hasMore: boolean; nextToken?: string } {
  if (!isObject(body)) throw new ShareError('消息响应不是 JSON 对象', -1)
  const code = Number(field(body, 'code') ?? 0)
  if (code !== 0) throw new ShareError(describe(code, field(body, 'message')), code)
  const data = field(body, 'data')
  const list = isObject(data) ? field(data, 'items') : undefined
  const items: ShareMessage[] = []
  if (Array.isArray(list)) {
    for (const entry of list) {
      if (!isObject(entry)) continue
      const messageId = field(entry, 'message_id', 'messageId')
      if (typeof messageId !== 'string' || !messageId) continue
      const role = field(entry, 'role')
      const str = (...keys: string[]): string | undefined => {
        const v = field(entry, ...keys)
        return typeof v === 'string' && v ? v : undefined
      }
      const index = Number(field(entry, 'message_index', 'messageIndex'))
      items.push({
        shareSessionId: str('share_session_id', 'shareSessionId') ?? '',
        messageId,
        role: typeof role === 'string' ? role : 'user',
        ...str('message_type', 'messageType') ? { messageType: str('message_type', 'messageType')! } : {},
        ...str('status') ? { status: str('status')! } : {},
        ...Number.isFinite(index) ? { messageIndex: index } : {},
        ...str('agent_type', 'agentType') ? { agentType: str('agent_type', 'agentType')! } : {},
        ...str('created_at', 'createdAt') ? { createdAt: str('created_at', 'createdAt')! } : {},
        ...str('turn_id', 'turnId') ? { turnId: str('turn_id', 'turnId')! } : {},
        ...str('reply_to_message_id', 'replyToMessageId') ? { replyToMessageId: str('reply_to_message_id', 'replyToMessageId')! } : {},
        ...typeof field(entry, 'content') === 'string' ? { content: field(entry, 'content') as string } : {},
        ...typeof field(entry, 'query') === 'string' ? { query: field(entry, 'query') as string } : {},
      })
    }
  }
  const nextToken = isObject(data) ? field(data, 'next_page_token', 'nextPageToken') : undefined
  return {
    items,
    hasMore: isObject(data) && field(data, 'has_more', 'hasMore') === true,
    ...typeof nextToken === 'string' && nextToken ? { nextToken } : {},
  }
}

/** 从消息里挑出 `turn_ids`：助手消息自带 `turn_id`，正是 createShare 要的。 */
export function turnIdsOf(messages: readonly ShareMessage[]): string[] {
  const seen = new Set<string>()
  for (const message of messages) if (message.turnId) seen.add(message.turnId)
  return [...seen]
}

/** `share_session_id` -> 前台链接（bundle: `${origin}/share/${id}?enter_from=pc`）。 */
export function shareUrl(id: string, origin = SHARE_ORIGIN): string {
  return `${origin}/share/${id}?enter_from=pc`
}

/** artifact 型分享的前台链接（bundle: `${origin}/artifact/${id}`）。 */
export function artifactUrl(id: string, origin = SHARE_ORIGIN): string {
  return `${origin}/artifact/${id}`
}

export interface ShareOptions {
  /** API host（与 adapter 同一个，CN 企业版是 api.enterprise.trae.cn）。 */
  host: string
  /** 铸链接、列会话要用；读分享不需要。 */
  auth?: TraeAuth
  userAgent: string
  logger?: { info(...a: unknown[]): void; warn(...a: unknown[]): void }
  /** 读结果的缓存时间；`0` 关掉缓存。 */
  ttlMs?: number
}

/** 分享接口的客户端：读缓存、铸带审核轮询、错误翻译成可读中文。 */
export class TraeShare {
  private readonly cache = new Map<string, { at: number; value: ShareSession }>()

  constructor(private readonly opts: ShareOptions) {}

  /** PAT 变了，缓存作废。 */
  reset(): void { this.cache.clear() }

  private base(): string { return this.opts.host.replace(/\/+$/, '') }

  /** 一次 POST/GET；`token` 缺省表示匿名。 */
  private async call(
    method: string,
    path: string,
    options: { token?: string; body?: unknown; signal?: AbortSignal; accept?: string } = {},
  ): Promise<{ status: number; body: unknown; text: string }> {
    const headers: Record<string, string> = {
      accept: options.accept ?? 'application/json',
      'user-agent': this.opts.userAgent,
    }
    if (options.body !== undefined) headers['content-type'] = 'application/json'
    if (options.token) headers.authorization = `Cloud-IDE-JWT ${options.token}`
    let res: Response
    try {
      res = await fetch(`${this.base()}${path}`, {
        method,
        headers,
        ...options.body !== undefined ? { body: JSON.stringify(options.body) } : {},
        signal: options.signal ?? AbortSignal.timeout(20_000),
      })
    } catch (error) {
      throw new ShareError(`无法连接 ${this.base()}（${error instanceof Error ? error.message : String(error)}）`, -1)
    }
    const text = await res.text()
    let body: unknown
    try { body = JSON.parse(text) } catch { body = undefined }
    return { status: res.status, body, text }
  }

  /** JWT，铸链接/列会话用；没有 auth 时给出明确的一句话。 */
  private async token(): Promise<string> {
    if (!this.opts.auth) throw new ShareError('这个分享操作需要 PAT，但插件没有挂上鉴权', -1)
    return (await this.opts.auth.get()).token
  }

  /**
   * 读一条分享。**不需要任何凭证** —— 只要 id 是对的就能读，这也是为什么
   * 链接一旦外流，内容就被原文拉走：服务端不校验调用方和分享者的关系。
   */
  async get(id: string, options: { force?: boolean; signal?: AbortSignal } = {}): Promise<ShareSession> {
    const ttl = this.opts.ttlMs ?? 60_000
    if (!options.force && ttl > 0) {
      const hit = this.cache.get(id)
      if (hit && Date.now() - hit.at < ttl) return hit.value
    }
    const { status, body, text } = await this.call('GET', `${SHARE_PATH}/${encodeURIComponent(id)}`, {
      ...options.signal ? { signal: options.signal } : {},
    })
    if (status === 404 && isObject(body) && Number(field(body, 'code')) === 992700) {
      throw new ShareError(describe(992700, field(body, 'message')), 992700, 404)
    }
    if (!isObject(body)) {
      throw new ShareError(`分享响应不是 JSON（HTTP ${status}）：${text.slice(0, 200)}`, -1, status)
    }
    const value = parseSession(body)
    if (ttl > 0) this.cache.set(id, { at: Date.now(), value })
    return value
  }

  /**
   * 读一条分享的全部消息，自动翻页（`page_token` 语义是"从第 N+1 条开始"，
   * `page_size` 服务端不设上限）。
   */
  async messages(id: string, options: { pageSize?: number; signal?: AbortSignal } = {}): Promise<ShareMessage[]> {
    const pageSize = options.pageSize ?? 100
    const out: ShareMessage[] = []
    let pageToken: string | undefined
    for (let page = 0; page < 200; page++) {
      const query = new URLSearchParams({ page_size: String(pageSize) })
      if (pageToken) query.set('page_token', pageToken)
      const path = `${SHARE_PATH}/${encodeURIComponent(id)}/messages?${query}`
      const { body } = await this.call('GET', path, { ...options.signal ? { signal: options.signal } : {} })
      const parsed = parseMessages(body)
      out.push(...parsed.items)
      if (!parsed.hasMore || !parsed.nextToken) break
      pageToken = parsed.nextToken
    }
    return out
  }

  /** 审核状态（匿名可读，但只有铸链接的过程中才需要它）。 */
  async auditStatus(id: string, signal?: AbortSignal): Promise<string | undefined> {
    const { body } = await this.call('GET', `${SHARE_PATH}/${encodeURIComponent(id)}/audit_status`, {
      ...signal ? { signal } : {},
    })
    if (!isObject(body)) return undefined
    const data = field(body, 'data')
    const status = isObject(data) ? field(data, 'status') : undefined
    return typeof status === 'string' ? status : undefined
  }

  /**
   * 铸一条对话分享链接。
   *
   * `chatSessionId` / `turnIds` 必须是聊天服务自己的 id —— 不是本插件合成的
   * UUID（见文件头）。
   */
  async create(input: {
    chatSessionId: string
    turnIds: string[]
    anonymous?: boolean
    creatorName?: string
    /** true = 不轮询审核，立刻返回 `auditing` 状态。 */
    skipAudit?: boolean
    signal?: AbortSignal
  }): Promise<ShareLink> {
    if (input.turnIds.length === 0) throw new ShareError('turn_ids 不能为空（前端也要求至少选一轮）', -1)
    if (input.turnIds.length > TURN_LIMIT) {
      throw new ShareError(`turn 数 ${input.turnIds.length} 超过上限 ${TURN_LIMIT}`, -1)
    }
    const token = await this.token()
    const { status, body, text } = await this.call('POST', SHARE_PATH, {
      token,
      body: {
        chat_session_id: input.chatSessionId,
        turn_ids: input.turnIds,
        anonymous: input.anonymous === true,
        creator_name: input.creatorName ?? '',
      },
      ...input.signal ? { signal: input.signal } : {},
    })
    if (status === 401) throw new ShareError(describe(1001, 'PAT 缺失或失效'), 1001, 401)
    if (!isObject(body)) throw new ShareError(`铸链接响应不是 JSON（HTTP ${status}）：${text.slice(0, 200)}`, -1, status)
    const code = Number(field(body, 'code') ?? 0)
    if (code !== 0) throw new ShareError(describe(code, field(body, 'message')), code, status)
    const data = field(body, 'data')
    if (!isObject(data)) throw new ShareError('铸链接响应里没有 data', 0, status)
    const id = field(data, 'share_session_id', 'shareSessionId')
    if (typeof id !== 'string' || !id) throw new ShareError('铸链接响应里没有 share_session_id', 0, status)
    const initial = field(data, 'status')
    const expiresAt = field(data, 'expires_at', 'expiresAt')
    let auditPolls = 0
    // 只有处在审核中才轮询；服务端直接 passed 的不必再问一次。
    if (initial === 'auditing' && !input.skipAudit) {
      auditPolls = await this.awaitAudit(id, input.signal)
    }
    return {
      shareSessionId: id,
      url: shareUrl(id),
      ...typeof initial === 'string' ? { status: initial } : {},
      ...typeof expiresAt === 'string' ? { expiresAt } : {},
      auditPolls,
    }
  }

  /**
   * 审核轮询，逐字对齐前端：最多 15 次、每次间隔 1s、单次 timeout 5s，
   * `passed` 放行、`failed` 立刻抛、其余继续。
   */
  private async awaitAudit(id: string, signal?: AbortSignal): Promise<number> {
    for (let attempt = 0; attempt < AUDIT_ATTEMPTS; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, AUDIT_INTERVAL_MS))
      if (signal?.aborted) throw new ShareError('审核轮询被取消', -1)
      const status = await this.auditStatus(id, signal)
      if (!status) throw new ShareError('审核查询没有返回 status', -1)
      if (status === 'passed') return attempt + 1
      if (status === 'failed') throw new ShareError(describe(993401, 'share audit failed'), 993401)
      this.opts.logger?.info(`dsh-trae2api: 分享 ${id} 审核中（${attempt + 1}/${AUDIT_ATTEMPTS}）`)
    }
    throw new ShareError('审核轮询超时（share audit is still in progress）', 992707)
  }

  /** 改分享状态：只有 `disabled`（下架）这一条，需要 JWT。 */
  async setStatus(id: string, status: 'disabled'): Promise<{ shareSessionId: string; status?: string }> {
    const token = await this.token()
    const { status: http, body, text } = await this.call(
      'PATCH', `${SHARE_PATH}/${encodeURIComponent(id)}/status`,
      { token, body: { share_session_id: id, status } },
    )
    if (http === 401) throw new ShareError(describe(1001, 'PAT 缺失或失效'), 1001, 401)
    if (!isObject(body)) throw new ShareError(`改状态响应不是 JSON（HTTP ${http}）：${text.slice(0, 200)}`, -1, http)
    const code = Number(field(body, 'code') ?? 0)
    if (code !== 0) throw new ShareError(describe(code, field(body, 'message')), code, http)
    const data = field(body, 'data')
    const next = isObject(data) ? field(data, 'status') : undefined
    return { shareSessionId: id, ...typeof next === 'string' ? { status: next } : {} }
  }

  /**
   * 列本账号的聊天会话 —— 真 `chat_session_id` 的唯一来源。铸链接前先跑一次
   * 这个，才知道该填什么。
   */
  async sessions(pageSize = 20): Promise<{ items: Json[]; raw: Json }> {
    const token = await this.token()
    const { status, body, text } = await this.call('GET', `${SESSIONS_PATH}?page_size=${pageSize}`, { token })
    if (status === 401) throw new ShareError(describe(1001, 'PAT 缺失或失效'), 1001, 401)
    if (!isObject(body)) throw new ShareError(`会话列表不是 JSON（HTTP ${status}）：${text.slice(0, 200)}`, -1, status)
    const code = Number(field(body, 'code') ?? 0)
    if (code !== 0) throw new ShareError(describe(code, field(body, 'message')), code, status)
    const data = field(body, 'data')
    const list = isObject(data) ? field(data, 'items') : undefined
    const items = Array.isArray(list) ? list.filter(isObject) : []
    return { items, raw: isObject(data) ? data : {} }
  }

  /** 一个真会话的 `turn_ids`（从它的消息里捞，助手消息带 `turn_id`）。 */
  async turnsOf(chatSessionId: string, signal?: AbortSignal): Promise<string[]> {
    const token = await this.token()
    const query = new URLSearchParams({ page_size: '100' })
    const { status, body, text } = await this.call(
      'GET', `${SESSIONS_PATH}/${encodeURIComponent(chatSessionId)}/messages?${query}`,
      { token, ...signal ? { signal } : {} },
    )
    if (status === 401) throw new ShareError(describe(1001, 'PAT 缺失或失效'), 1001, 401)
    if (!isObject(body)) throw new ShareError(`会话消息不是 JSON（HTTP ${status}）：${text.slice(0, 200)}`, -1, status)
    const code = Number(field(body, 'code') ?? 0)
    if (code !== 0) throw new ShareError(describe(code, field(body, 'message')), code, status)
    const parsed = parseMessages(body)
    return turnIdsOf(parsed.items)
  }
}
