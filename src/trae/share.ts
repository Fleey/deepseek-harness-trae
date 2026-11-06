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
 * `turn_ids` 字段名骗人：实测（企业版 PAT，2026-11-06）要填的是 **user 消息的
 * `message_id`**，不是消息对象上那个 `turn_id`（助手消息自带、结算时由服务端
 * 签发并回填到 user/assistant 两侧，但不是 `createShare` 的入参）。详见 `turnIdsOf`。
 * 前端硬上限 50。
 *
 * 接口 origin 与链接 origin 是两回事（逆向报告 v2，TRAE SOLO CN 0.1.61 的
 * `product.json` bootConfig）：
 *
 *   bootConfig.remote.trae.normal              https://trae-api-cn.mchost.guru  ← 写 API 真身
 *   bootConfig.artifactShareOrigin.trae.normal https://share.traecontent.cn     ← 链接域名
 *   bootConfig.soloUrl                         https://work.trae.cn
 *
 * 客户端的 POST 打 `trae-api-cn.mchost.guru`，链接拼在 `share.traecontent.cn`
 * （bundle 里硬编码的兜底是 `.com`，bootConfig 覆盖它，不生效）。实测
 * mchost.guru / work.trae.cn / share.traecontent.cn 是同一个消费站命名空间，
 * 企业版 api.enterprise.trae.cn 则是另一套。
 *
 * 生命周期（v2 实测）：链接有效期 = 创建后 1 年；`PATCH /share/:id/status`
 * `{status:'disabled'}` 关闭（之后匿名读 403 992701），`{status:'active'}` 重开；
 * `DELETE /share/:id` 撤销（之后 410 992702）。同参数连铸两次得到两个 id，不幂等。
 */

import type { TraeAuth } from './auth.ts'

/** CN 前台站；分享链接就是拼在这个 origin 后面。 */
export const SHARE_ORIGIN = 'https://share.traecontent.cn'
/** 分享接口的默认 origin：客户端 bootConfig `remote.trae.normal`（报告 v2）。 */
export const SHARE_API_ORIGIN = 'https://trae-api-cn.mchost.guru'
/** 审核轮询的整体上限（bundle：整个铸链接 120 s 超时）。 */
export const AUDIT_DEADLINE_MS = 120_000
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
  // Generic: createShare says "no messages match the specified turn_ids"
  // (turn_ids want the *user* message_id), local_conversation "invalid parameter".
  991102: '请求参数不合法',
  991200: '聊天服务里没有这条会话',
  992700: '分享不存在',
  992701: '分享已关闭，或无权操作这条分享',
  992702: '分享已被撤销（删除）',
  992704: '源会话不存在',
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
  /**
   * The API host that answered. A share id belongs to exactly one namespace,
   * and its front-end page lives on that namespace's origin (shareOriginFor) —
   * this is how the caller knows which link to hand out.
   */
  host?: string
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
  /**
   * 服务端在回合结算时签发、并**同时回填到 user 和 assistant 两侧**的同一个
   * 值。注意它**不是** `createShare` 的入参（见 `turnIdsOf`）。
   */
  turnId?: string
  replyToMessageId?: string
  content?: string
  query?: string
}

/** 铸出来的链接。 */
export interface ShareLink {
  shareSessionId: string
  url: string
  /** 最终状态：审核轮询放行后是 `passed`，`skipAudit` 时是服务端首次给的值。 */
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

/**
 * 「全选」时要发的 `turn_ids`。
 *
 * 名字骗人：`createShare` 收的是 **user 消息的 `message_id`**，不是消息对象上
 * 那个 `turn_id` 字段。实测（企业版 PAT，2026-11-06）：
 *
 *   turn_ids: ['<assistant.turn_id>']      → 400 991102 no messages match
 *   turn_ids: ['<assistant.message_id>']   → 400 991102 no messages match
 *   turn_ids: ['<user.message_id>']        → 200，链接可读
 *
 * 也就是说一对 user/assistant 由 user 那条来代表。只取 user 侧，避免把
 * assistant 的 id 混进去让整次请求被拒。
 */
export function turnIdsOf(messages: readonly ShareMessage[]): string[] {
  const seen = new Set<string>()
  for (const message of messages) {
    if (message.role !== 'user') continue
    if (message.messageId) seen.add(message.messageId)
  }
  return [...seen]
}

/**
 * 「全选」时要发的 `turn_ids`：前端一次最多选 50 轮，会话更长时取最近的 50 轮
 * （最新的对话才是想分享的那部分），而不是让整次铸链接因为超限失败。
 */
export function latestTurns(turnIds: readonly string[], limit = TURN_LIMIT): string[] {
  return turnIds.length > limit ? turnIds.slice(turnIds.length - limit) : [...turnIds]
}

/**
 * 分享 API host -> 它的前台分享页 origin。
 *
 * 两个部署是**两套独立的分享命名空间**（实测 2026-11-06，同一企业版 PAT）：
 *
 *   api.enterprise.trae.cn 铸的 id  → share.traecontent.cn 404 992700
 *                                     api.enterprise.trae.cn 200
 *                                     console.enterprise.trae.cn/share/<id> 200（匿名可读）
 *   share.traecontent.cn 铸的 id    → share.traecontent.cn 200
 *                                     api.enterprise.trae.cn 404 992700
 *
 * 所以链接必须拼在**铸它的那套**前台站上：给一个企业版 id 配消费站域名，
 * 打开就是"此链接已失效"。查不到映射时按消费站处理（那是默认部署）。
 */
const SHARE_PAGE_ORIGINS: Readonly<Record<string, string>> = {
  'https://share.traecontent.cn': 'https://share.traecontent.cn',
  'https://work.trae.cn': 'https://share.traecontent.cn',
  'https://trae-api-cn.mchost.guru': 'https://share.traecontent.cn',
  'https://api.enterprise.trae.cn': 'https://console.enterprise.trae.cn',
  'https://console.enterprise.trae.cn': 'https://console.enterprise.trae.cn',
}

/** 某个分享 API host 对应的前台分享站。 */
export function shareOriginFor(host: string): string {
  const key = host.trim().replace(/\/+$/, '')
  return SHARE_PAGE_ORIGINS[key] ?? SHARE_ORIGIN
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

  /** The origin this client speaks to, without a trailing slash. */
  get host(): string { return this.base() }

  /** 一次 POST/GET；`token` 缺省表示匿名。 */
  private async call(
    method: string,
    path: string,
    options: { token?: string; body?: unknown; signal?: AbortSignal; accept?: string; timeoutMs?: number } = {},
  ): Promise<{ status: number; body: unknown; text: string }> {
    const headers: Record<string, string> = {
      accept: options.accept ?? 'application/json',
      'user-agent': this.opts.userAgent,
    }
    if (options.body !== undefined) headers['content-type'] = 'application/json'
    if (options.token) headers.authorization = `Cloud-IDE-JWT ${options.token}`
    // The per-request timeout always applies; a caller's signal only adds a
    // way to cancel sooner, it does not lift the timeout.
    const timeout = AbortSignal.timeout(options.timeoutMs ?? 20_000)
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
    let res: Response
    try {
      res = await fetch(`${this.base()}${path}`, {
        method,
        headers,
        ...options.body !== undefined ? { body: JSON.stringify(options.body) } : {},
        signal,
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
    // The host that answered is part of the answer: an id lives in exactly one
    // namespace, and its front-end page is on that namespace's own origin
    // (shareOriginFor). Nothing else can tell the two apart.
    const value = { ...parseSession(body), host: this.base() }
    if (ttl > 0) this.cache.set(id, { at: Date.now(), value })
    return value
  }

  /** The same read, on one named host — for finding out which namespace an id lives in. */
  async getOn(host: string, id: string, options: { signal?: AbortSignal } = {}): Promise<ShareSession> {
    const client = host.replace(/\/+$/, '') === this.base() ? this : new TraeShare({ ...this.opts, host, ttlMs: 0 })
    return client.get(id, { force: true, ...options.signal ? { signal: options.signal } : {} })
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

  /** 审核状态（匿名可读，但只有铸链接的过程中才需要它）；单次 timeout 5s，同前端。 */
  async auditStatus(id: string, signal?: AbortSignal): Promise<string | undefined> {
    return (await this.auditAnswer(id, signal)).status
  }

  /** `audit_status` 的整个回答：业务码、状态、服务端原话。 */
  private async auditAnswer(id: string, signal?: AbortSignal): Promise<{ code: number; status?: string; message?: string }> {
    const { status: http, body, text } = await this.call('GET', `${SHARE_PATH}/${encodeURIComponent(id)}/audit_status`, {
      timeoutMs: AUDIT_TIMEOUT_MS,
      ...signal ? { signal } : {},
    })
    if (!isObject(body)) return { code: -1, message: `审核查询不是 JSON（HTTP ${http}）：${text.slice(0, 120)}` }
    const data = field(body, 'data')
    const status = isObject(data) ? field(data, 'status') : undefined
    const message = field(body, 'message')
    return {
      code: Number(field(body, 'code') ?? 0),
      ...typeof status === 'string' && status ? { status } : {},
      ...typeof message === 'string' ? { message } : {},
    }
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
        // bundle: `currentUser.username.trim()`.
        creator_name: (input.creatorName ?? '').trim(),
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
    // 服务端当场判了不通过：链接打不开，不能当成功交出去。bundle 认的是
    // `audit_failed`；`failed` 是审核接口的写法，一并当失败。
    if (initial === 'audit_failed' || initial === 'failed') throw new ShareError(describe(993401, 'share audit failed'), 993401, status)
    let auditPolls = 0
    let final = typeof initial === 'string' ? initial : undefined
    // 只有处在审核中才轮询；服务端直接 passed 的不必再问一次。
    if (initial === 'auditing' && !input.skipAudit) {
      auditPolls = await this.awaitAudit(id, input.signal)
      final = 'passed'
    }
    return {
      shareSessionId: id,
      url: shareUrl(id, shareOriginFor(this.base())),
      ...final ? { status: final } : {},
      ...typeof expiresAt === 'string' ? { expiresAt } : {},
      auditPolls,
    }
  }

  /**
   * 铸一条「本地会话」分享：消息由调用方整段带上（local-share.ts 拼好的
   * body），服务端原样存，不跑模型。客户端 `ee()` 的同一个端点。
   */
  async createLocal(body: Record<string, unknown>, signal?: AbortSignal): Promise<ShareLink & { title?: string }> {
    const token = await this.token()
    const { status, body: answer, text } = await this.call('POST', `${SHARE_PATH}/local_conversation`, {
      token,
      body,
      // A long session is a big body; give the upload room.
      timeoutMs: 60_000,
      ...signal ? { signal } : {},
    })
    if (status === 401) throw new ShareError(describe(1001, 'PAT 缺失或失效'), 1001, 401)
    if (!isObject(answer)) throw new ShareError(`本地会话分享响应不是 JSON（HTTP ${status}）：${text.slice(0, 200)}`, -1, status)
    const code = Number(field(answer, 'code') ?? 0)
    if (code !== 0) throw new ShareError(describe(code, field(answer, 'message')), code, status)
    const data = field(answer, 'data')
    const id = isObject(data) ? field(data, 'share_session_id', 'shareSessionId') : undefined
    if (typeof id !== 'string' || !id) throw new ShareError('本地会话分享响应里没有 share_session_id', 0, status)
    const initial = isObject(data) ? field(data, 'status') : undefined
    if (initial === 'audit_failed' || initial === 'failed') throw new ShareError(describe(993401, 'share audit failed'), 993401, status)
    let auditPolls = 0
    let final = typeof initial === 'string' ? initial : undefined
    if (initial === 'auditing') {
      auditPolls = await this.awaitAudit(id, signal)
      final = 'active'
    }
    const expiresAt = isObject(data) ? field(data, 'expires_at', 'expiresAt') : undefined
    const title = isObject(data) ? field(data, 'title') : undefined
    return {
      shareSessionId: id,
      url: shareUrl(id, shareOriginFor(this.base())),
      ...final ? { status: final } : {},
      ...typeof expiresAt === 'string' ? { expiresAt } : {},
      ...typeof title === 'string' ? { title } : {},
      auditPolls,
    }
  }

  /**
   * 审核轮询，对齐前端 `P()`（报告 v2 §1.3）：最多 15 次、间隔 1s、单次
   * timeout 5s、整体 120s。
   *
   * - `passed` 放行；`failed` 抛「内容审核未通过」。
   * - 业务码非 0 或没有 status：`992700`（刚铸好、读侧还没同步）前 14 轮
   *   容忍重试，其他码当场抛服务端原话 —— 同前端。
   * - 连接失败/超时只算这一次没问到（前端没有这一层；插件跑在用户网络上，
   *   不让一次抖动把已经铸好的链接判成失败）。
   */
  private async awaitAudit(id: string, signal?: AbortSignal): Promise<number> {
    const deadline = Date.now() + AUDIT_DEADLINE_MS
    let lastError: unknown
    for (let attempt = 0; attempt < AUDIT_ATTEMPTS; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, AUDIT_INTERVAL_MS))
      if (signal?.aborted) throw new ShareError('审核轮询被取消', -1)
      if (Date.now() > deadline) break
      let answer: { code: number; status?: string; message?: string }
      try {
        answer = await this.auditAnswer(id, signal)
      } catch (error) {
        if (signal?.aborted) throw new ShareError('审核轮询被取消', -1)
        lastError = error
        continue
      }
      if (answer.code !== 0 || !answer.status) {
        if (answer.code === 992700 && attempt < AUDIT_ATTEMPTS - 1) continue
        throw new ShareError(describe(answer.code, answer.message ?? 'audit status unavailable'), answer.code)
      }
      if (answer.status === 'passed') return attempt + 1
      if (answer.status === 'failed' || answer.status === 'audit_failed') {
        throw new ShareError(describe(993401, 'share audit failed'), 993401)
      }
      this.opts.logger?.info(`dsh-trae2api: 分享 ${id} 审核中（${attempt + 1}/${AUDIT_ATTEMPTS}）`)
    }
    const detail = lastError instanceof Error ? `；最后一次查询：${lastError.message}` : ''
    throw new ShareError(`审核轮询超时（share audit is still in progress）${detail}`, 992707)
  }

  /**
   * 改分享状态：`disabled` 关闭（之后匿名读 403 992701），`active` 重开。
   * 只有分享者本人能改（别人的 id 是 403 992701）。
   */
  async setStatus(id: string, status: 'disabled' | 'active'): Promise<{ shareSessionId: string; status?: string }> {
    const token = await this.token()
    const { status: http, body, text } = await this.call(
      'PATCH', `${SHARE_PATH}/${encodeURIComponent(id)}/status`,
      { token, body: { status } },
    )
    if (http === 401) throw new ShareError(describe(1001, 'PAT 缺失或失效'), 1001, 401)
    if (!isObject(body)) throw new ShareError(`改状态响应不是 JSON（HTTP ${http}）：${text.slice(0, 200)}`, -1, http)
    const code = Number(field(body, 'code') ?? 0)
    if (code !== 0) throw new ShareError(describe(code, field(body, 'message')), code, http)
    this.cache.delete(id)
    const data = field(body, 'data')
    const next = isObject(data) ? field(data, 'status') : undefined
    return { shareSessionId: id, status: typeof next === 'string' ? next : status }
  }

  /** 撤销一条分享：`DELETE /share/:id`，之后读是 410 992702。不能恢复。 */
  async remove(id: string): Promise<{ shareSessionId: string }> {
    const token = await this.token()
    const { status: http, body, text } = await this.call('DELETE', `${SHARE_PATH}/${encodeURIComponent(id)}`, { token })
    if (http === 401) throw new ShareError(describe(1001, 'PAT 缺失或失效'), 1001, 401)
    if (!isObject(body)) throw new ShareError(`撤销响应不是 JSON（HTTP ${http}）：${text.slice(0, 200)}`, -1, http)
    const code = Number(field(body, 'code') ?? 0)
    if (code !== 0) throw new ShareError(describe(code, field(body, 'message')), code, http)
    this.cache.delete(id)
    return { shareSessionId: id }
  }

  /**
   * 列本账号自己铸过的分享（`GET /share`，要 JWT）。列表键名还没有抓包定死，
   * 和会话列表一样取常见名字下的第一个数组。
   */
  async list(pageSize = 50): Promise<{ items: ShareSession[]; keys: string[]; host: string }> {
    const token = await this.token()
    const { status, body, text } = await this.call('GET', `${SHARE_PATH}?page_size=${pageSize}`, { token })
    if (status === 401) throw new ShareError(describe(1001, 'PAT 缺失或失效'), 1001, 401)
    if (!isObject(body)) throw new ShareError(`分享列表不是 JSON（HTTP ${status}）：${text.slice(0, 200)}`, -1, status)
    const code = Number(field(body, 'code') ?? 0)
    if (code !== 0) throw new ShareError(describe(code, field(body, 'message')), code, status)
    const data = field(body, 'data')
    const raw = Array.isArray(data)
      ? data
      : isObject(data) ? field(data, 'items', 'shares', 'share_sessions', 'shareSessions', 'list', 'records') : undefined
    const items: ShareSession[] = []
    for (const entry of Array.isArray(raw) ? raw : []) {
      try { items.push({ ...parseSession({ code: 0, data: entry }), host: this.base() }) } catch { /* not a share row */ }
    }
    return {
      items,
      keys: isObject(data) ? Object.keys(data) : Array.isArray(data) ? ['<array>'] : [],
      host: this.base(),
    }
  }

  /**
   * 列本账号的聊天会话 —— 真 `chat_session_id` 的唯一来源。铸链接前先跑一次
   * 这个，才知道该填什么。
   */
  async sessions(pageSize = 20): Promise<{ items: Json[]; raw: Json; keys: string[]; host: string }> {
    const token = await this.token()
    const { status, body, text } = await this.call('GET', `${SESSIONS_PATH}?page_size=${pageSize}`, { token })
    if (status === 401) throw new ShareError(describe(1001, 'PAT 缺失或失效'), 1001, 401)
    if (!isObject(body)) throw new ShareError(`会话列表不是 JSON（HTTP ${status}）：${text.slice(0, 200)}`, -1, status)
    const code = Number(field(body, 'code') ?? 0)
    if (code !== 0) throw new ShareError(describe(code, field(body, 'message')), code, status)
    const data = field(body, 'data')
    // The list key is not pinned down by a live capture yet; take the first
    // array under the usual names rather than answer "no sessions" for a
    // shape this parser did not expect.
    const list = Array.isArray(data)
      ? data
      : isObject(data) ? field(data, 'items', 'sessions', 'chat_sessions', 'chatSessions', 'list', 'records') : undefined
    const items = Array.isArray(list) ? list.filter(isObject) : []
    return {
      items,
      raw: isObject(data) ? data : {},
      // For the diagnostic line when the list comes back empty.
      keys: isObject(data) ? Object.keys(data) : Array.isArray(data) ? ['<array>'] : [],
      host: this.base(),
    }
  }

  /**
   * 一个真会话的全部 `turn_ids`（从它的消息里捞，注意填的是 user 消息的
   * `message_id`，见 `turnIdsOf`），按 `page_token` 翻完所有页 —— 只看第一页
   * 会把长会话的后半截漏掉。
   */
  async turnsOf(chatSessionId: string, signal?: AbortSignal): Promise<string[]> {
    const token = await this.token()
    const items: ShareMessage[] = []
    let pageToken: string | undefined
    for (let page = 0; page < 50; page++) {
      const query = new URLSearchParams({ page_size: '100' })
      if (pageToken) query.set('page_token', pageToken)
      const { status, body, text } = await this.call(
        'GET', `${SESSIONS_PATH}/${encodeURIComponent(chatSessionId)}/messages?${query}`,
        { token, ...signal ? { signal } : {} },
      )
      if (status === 401) throw new ShareError(describe(1001, 'PAT 缺失或失效'), 1001, 401)
      if (!isObject(body)) throw new ShareError(`会话消息不是 JSON（HTTP ${status}）：${text.slice(0, 200)}`, -1, status)
      const code = Number(field(body, 'code') ?? 0)
      if (code !== 0) throw new ShareError(describe(code, field(body, 'message')), code, status)
      const parsed = parseMessages(body)
      items.push(...parsed.items)
      if (!parsed.hasMore || !parsed.nextToken) break
      pageToken = parsed.nextToken
    }
    return turnIdsOf(items)
  }

  // ------------------------------------------------------------ chat writes
  //
  // Everything below writes to Trae's chat service, which is a different layer
  // from llm_raw_chat (see the file header). Three measured facts shape it:
  //
  //  - the request body carries `content: []` — empty. The text goes in `query`
  //    and the server derives `content` from it. Sending both is harmless but
  //    pointless; sending only `content` and an empty `query` leaves the turn
  //    with nothing to answer.
  //  - `sendMessage` does **not** return a `turn_id`. The whole response is
  //    `{code, data: {message_id, accepted, status: 'in_progress'}, message}` —
  //    `message_id` is all a freshly started turn gives back.
  //  - minting a share does **not** require a settled turn. `POST
  //    /api/remote/v1/share` with that fresh `message_id`, 0.28s after
  //    `sendMessage` and with the model still running, answers 200 and hands
  //    back a `share_session_id`. The gate was never "can it be minted".
  //
  // What the gate really is: a link minted before the turn settles is a
  // **frozen snapshot**. Measured on such a link, 35s of it — `msgs=1`, the one
  // row the user wrote, `status: in_progress` at t+0s, t+5s, … t+35s. The
  // assistant answer never backfills, while the session side at that same
  // moment (`GET /chat_sessions/:id/messages`) already shows user and assistant
  // both `completed`. So settling is about the shared copy containing the
  // answer — not about getting past a 400.
  //
  // `turn_id` lands late, and lands as a pair: t+0.27s `sendMessage` returns
  // `message_id`; t+0.40s the user row reads `user:-:in_progress` (no `turn_id`
  // yet); t+4.07s both rows flip to `user:<turn_id>:completed` and
  // `assistant:<turn_id>:completed` carrying the *same* server-generated id.
  // Hence `waitForTurn` waits for two `completed` rows, not one.
  //
  // There is still no path that stores a turn without running the model:
  // `batch_sync_history` exists but wants a server-issued `handoff_id` (a
  // fabricated one is 409 991210), and `sendMessage` has no "store without
  // running" flag — `dry_run`, `append_only` and friends are silently ignored.
  // Mirroring N turns therefore costs N model calls.

  /** One user turn on the wire, as the Trae front end sends it. */
  private sendBody(chatSessionId: string, text: string): Record<string, unknown> {
    return {
      chat_session_id: chatSessionId,
      // Empty on purpose: the server fills `content` from `query`.
      content: [],
      query: JSON.stringify([{ type: 'text', data: { content: text } }]),
      // Empty + `auto` lets upstream pick; a model name here would have to be
      // kept in step with the catalog by hand.
      model_name: '',
      agent_type: '',
      agent_id: null,
      model_selection_strategy: 'auto',
      common_params: JSON.stringify({ solo_chat_mode: 'work' }),
    }
  }

  /**
   * Create an empty chat session on this client's host.
   *
   * `mode` and `env` are all that is needed; the front end sends a dozen more
   * fields for project and worktree setups, none of which a mirrored
   * conversation has. The consumer site also answers a `remote_project_id`,
   * the workspace it provisioned — not used here.
   */
  async createSession(mode = 'work', env = 'remote', signal?: AbortSignal): Promise<string> {
    const token = await this.token()
    const { status, body, text } = await this.call('POST', SESSIONS_PATH, {
      token,
      body: { mode, env },
      ...signal ? { signal } : {},
    })
    if (status === 401) throw new ShareError(describe(1001, 'PAT 缺失或失效'), 1001, 401)
    if (!isObject(body)) throw new ShareError(`建会话响应不是 JSON（HTTP ${status}）：${text.slice(0, 200)}`, -1, status)
    const code = Number(field(body, 'code') ?? 0)
    if (code !== 0) throw new ShareError(describe(code, field(body, 'message')), code, status)
    const data = field(body, 'data')
    const id = isObject(data) ? field(data, 'chat_session_id', 'chatSessionId') : undefined
    if (typeof id !== 'string' || !id) throw new ShareError('建会话响应里没有 chat_session_id', 0, status)
    return id
  }

  /**
   * Post one user message and return its `message_id`.
   *
   * That id exists immediately (t+0.27s measured) and is already enough to mint
   * a share with — but the turn is `in_progress` and has no `turn_id` yet, so a
   * link built now freezes on this single user row. `waitForTurn` is what makes
   * the answer part of the share.
   */
  async sendMessage(chatSessionId: string, text: string, signal?: AbortSignal): Promise<string> {
    const token = await this.token()
    const path = `${SESSIONS_PATH}/${encodeURIComponent(chatSessionId)}/messages`
    const { status, body, text: raw } = await this.call('POST', path, {
      token,
      body: this.sendBody(chatSessionId, text),
      ...signal ? { signal } : {},
    })
    if (status === 401) throw new ShareError(describe(1001, 'PAT 缺失或失效'), 1001, 401)
    if (!isObject(body)) throw new ShareError(`发消息响应不是 JSON（HTTP ${status}）：${raw.slice(0, 200)}`, -1, status)
    const code = Number(field(body, 'code') ?? 0)
    if (code !== 0) throw new ShareError(describe(code, field(body, 'message')), code, status)
    const data = field(body, 'data')
    const id = isObject(data) ? field(data, 'message_id', 'messageId') : undefined
    if (typeof id !== 'string' || !id) throw new ShareError('发消息响应里没有 message_id', 0, status)
    return id
  }

  /** One page of message rows — the raw material `waitForTurn` polls for state. */
  async readMessages(chatSessionId: string, signal?: AbortSignal): Promise<ShareMessage[]> {
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
    return parseMessages(body).items
  }

  /**
   * Wait for both sides of a turn to reach `completed`, then report the user row
   * a share points at plus the pair's `turn_id` and the answer text.
   *
   * Not a prerequisite for minting — a share minted right after `sendMessage`
   * returns 200 just fine. It is a prerequisite for the link to *contain* the
   * answer: the pre-settle snapshot stays at one `in_progress` user row and
   * never backfills (measured over 35s). Both rows flip to `completed` in the
   * same observation window (~4s in), user and assistant sharing one
   * server-issued `turn_id`, which is why this waits on the pair.
   *
   * The model runs a while (seconds to a minute); polling is the only signal
   * this API offers, as there is no per-turn status endpoint that is cheaper.
   */
  async waitForTurn(
    chatSessionId: string,
    userMessageId: string,
    options: { timeoutMs?: number; intervalMs?: number; signal?: AbortSignal } = {},
  ): Promise<{ userMessageId: string; turnId?: string; answer?: string }> {
    const timeoutMs = options.timeoutMs ?? 120_000
    const intervalMs = options.intervalMs ?? 2_000
    const deadline = Date.now() + timeoutMs
    for (;;) {
      if (options.signal?.aborted) throw new ShareError('等待回合被取消', -1)
      const items = await this.readMessages(chatSessionId, options.signal)
      const user = items.find(m => m.messageId === userMessageId)
      const assistant = items.find(m => m.role === 'assistant' && m.replyToMessageId === userMessageId)
        ?? items.find(m => m.role === 'assistant' && m.turnId && m.turnId === user?.turnId)
      if (user && user.status === 'completed' && assistant && assistant.status === 'completed') {
        return {
          userMessageId,
          ...user.turnId ? { turnId: user.turnId } : {},
          ...assistant.content ? { answer: assistant.content } : {},
        }
      }
      if (Date.now() >= deadline) {
        throw new ShareError(`等待回合超时（${Math.round(timeoutMs / 1000)}s）：${userMessageId}`, -1)
      }
      await new Promise(r => setTimeout(r, intervalMs))
    }
  }
}
