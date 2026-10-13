/**
 * Enterprise (ToB) quota, read from the Trae enterprise console.
 *
 * The IDE-facing `ide_user_ent_usage` API (see `quota.ts`) is the CN consumer
 * one: for an enterprise seat it answers nothing but a personal free
 * entitlement with every limit 0. The figures the console's 「个人用量」 page
 * shows come from two of its own endpoints instead (measured 2026-10-13 from
 * the console bundle and against a real tenant):
 *
 *   - `config/get_personal_quota` → `user_model_quota`:
 *     `seat_pool_currency_quota` (the seat's allowance) and
 *     `paygo_currency_quota` (the pay-as-you-go allowance on top of it);
 *   - `config/get_user_model_usage` → `user_usage_list[]`, each with
 *     `in_seat_detail.chat_usage_details[]` (per model `total_token_usage` and
 *     `total_cost_currency`) and `model_usage_detail_list[]` for the paygo
 *     side. The `seat_total_cost_currency` / `extra_total_cost_currency`
 *     aggregates come back null in practice, so they are summed here.
 *
 * Both are console endpoints and take the browser's own session cookie
 * (`X-Cloudide-Tob-Session`); a Cloud-IDE JWT is refused with `30011 请先登录`,
 * `account/check_token` does not mint one, and no exchange on the console host
 * sets the cookie. So the only way in is the console's own password login
 * (`account/login`, `{ Email, Password }`), which is what this module does —
 * with credentials the user puts in the plugin's credential store, never in
 * config. SSO-only tenants cannot use this path.
 */

import type { QuotaPack, QuotaSnapshot } from './quota.ts'

export const TOB_CONSOLE_HOST = 'https://console.enterprise.trae.cn'
export const TOB_LOGIN_PATH = '/trae/gtm/tob/api/v1/account/login'
export const TOB_QUOTA_PATH = '/trae/gtm/tob/api/v1/config/get_personal_quota'
export const TOB_USAGE_PATH = '/trae/gtm/tob/api/v1/config/get_user_model_usage'
/** The console's session cookie; its login sets it, every other call needs it. */
export const TOB_SESSION_COOKIE = 'X-Cloudide-Tob-Session'
/** The console's "you are not logged in" business code. */
const NOT_LOGGED_IN = 30011

type Json = Record<string, unknown>

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function num(value: unknown): number | undefined {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined
}

/** Σ `total_cost_currency` over a `*_usage_details` / `*_detail_list` array. */
function costOf(list: unknown): number {
  if (!Array.isArray(list)) return 0
  let total = 0
  for (const entry of list) {
    if (isObject(entry)) total += num(entry.total_cost_currency) ?? 0
  }
  return total
}

export interface TobUsageModel {
  name: string
  tokens: number
  cost: number
}

/**
 * Turn the console's two answers into the same snapshot shape the IDE API
 * produces: one pack for the seat allowance, one for pay-as-you-go. A quota of
 * 0 means that side is not granted, so it carries no pack; a negative one means
 * unlimited, as everywhere else here.
 */
export function parseTobQuota(quotaBody: unknown, usageBody: unknown, now = Date.now()): QuotaSnapshot {
  const quota = isObject(quotaBody) && isObject(quotaBody.user_model_quota) ? quotaBody.user_model_quota : undefined
  const list = isObject(usageBody) && Array.isArray(usageBody.user_usage_list) ? usageBody.user_usage_list : []

  let seatUsed = 0
  let paygoUsed = 0
  const models: TobUsageModel[] = []
  for (const entry of list) {
    if (!isObject(entry)) continue
    const inSeat = isObject(entry.in_seat_detail) ? entry.in_seat_detail : undefined
    seatUsed += num(entry.seat_total_cost_currency) ?? costOf(inSeat?.chat_usage_details)
    paygoUsed += num(entry.extra_total_cost_currency) ?? costOf(entry.model_usage_detail_list)
    for (const source of [inSeat?.chat_usage_details, entry.model_usage_detail_list]) {
      if (!Array.isArray(source)) continue
      for (const model of source) {
        if (!isObject(model)) continue
        const tokens = num(model.total_token_usage) ?? 0
        const cost = num(model.total_cost_currency) ?? 0
        if (tokens === 0 && cost === 0) continue
        const name = typeof model.display_name === 'string' && model.display_name.trim() ? model.display_name.trim()
          : typeof model.config_name === 'string' ? model.config_name : '—'
        models.push({ name, tokens, cost })
      }
    }
  }
  models.sort((a, b) => b.cost - a.cost)

  const packs: QuotaPack[] = []
  const add = (name: string, limit: number | undefined, used: number): void => {
    if (limit === undefined || limit === 0) return
    const unlimited = limit < 0
    packs.push({ name, limit: unlimited ? null : limit, used, remaining: unlimited ? null : Math.max(limit - used, 0) })
  }
  add('席位额度', num(quota?.seat_pool_currency_quota), seatUsed)
  add('超额（按量）', num(quota?.paygo_currency_quota), paygoUsed)

  const unlimited = packs.some(pack => pack.limit === null)
  return {
    packs,
    limit: unlimited ? null : packs.reduce((sum, pack) => sum + pack.limit!, 0),
    used: packs.reduce((sum, pack) => sum + pack.used, 0),
    remaining: unlimited ? null : packs.reduce((sum, pack) => sum + pack.remaining!, 0),
    dollars: false,
    fetchedAt: now,
    seat: 'enterprise',
    ...typeof quota?.tenant_id === 'string' ? { tenant: quota.tenant_id } : {},
    ...models.length > 0 ? { models: models.slice(0, 12) } : {},
  }
}

export interface TobConsoleOptions {
  /** Console origin; the default is the public one. */
  host: string
  userAgent: string
  /** Console account, from config. */
  readEmail: () => Promise<string | undefined>
  /** Console password, from the credential store. */
  readPassword: () => Promise<string | undefined>
}

/** Reads the enterprise console's personal quota page, logging in as needed. */
export class TobConsole {
  private session: string | undefined

  constructor(private readonly opts: TobConsoleOptions) {}

  /** Forget the session (the account or password changed). */
  reset(): void { this.session = undefined }

  /**
   * The seat's quota, or `undefined` when no console account is configured.
   * @throws when the console refuses the login or the reads.
   */
  async read(now = Date.now()): Promise<QuotaSnapshot | undefined> {
    const email = (await this.opts.readEmail())?.trim()
    const password = (await this.opts.readPassword())?.trim()
    if (!email || !password) return undefined
    if (!this.session) await this.login(email, password)
    let quota: Json
    let usage: Json
    try {
      [quota, usage] = await this.pair()
    } catch (error) {
      // The session expires on its own; one re-login, then give up.
      if (!(error instanceof TobSessionError)) throw error
      this.session = undefined
      await this.login(email, password)
      ;[quota, usage] = await this.pair()
    }
    const snapshot = parseTobQuota(quota, usage, now)
    snapshot.source = `${this.host()}${TOB_QUOTA_PATH}`
    return snapshot
  }

  private pair(): Promise<[Json, Json]> {
    return Promise.all([this.post(TOB_QUOTA_PATH, {}), this.post(TOB_USAGE_PATH, {})])
  }

  private host(): string {
    return this.opts.host.trim().replace(/\/+$/, '') || TOB_CONSOLE_HOST
  }

  private async login(email: string, password: string): Promise<void> {
    const host = this.host()
    let res: Response
    try {
      res = await fetch(`${host}${TOB_LOGIN_PATH}`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ Email: email, Password: password }),
        signal: AbortSignal.timeout(20_000),
      })
    } catch (error) {
      throw new Error(`Trae：无法连接企业控制台 ${host}（${error instanceof Error ? error.message : String(error)}）`)
    }
    const cookie = sessionFrom(res)
    const body = await res.json().catch(() => undefined) as unknown
    const code = isObject(body) ? num(body.code) : undefined
    if (!res.ok || (code !== undefined && code !== 0)) {
      const message = isObject(body) && typeof body.message === 'string' ? body.message : `HTTP ${res.status}`
      throw new Error(`Trae：企业控制台登录失败（${message}）。请检查邮箱与密码；SSO 登录的账号无法用这条路径。`)
    }
    if (!cookie) throw new Error('Trae：企业控制台登录成功但没有返回会话 cookie，接口可能已改。')
    this.session = cookie
  }

  private async post(path: string, body: Json): Promise<Json> {
    const host = this.host()
    let res: Response
    try {
      res = await fetch(`${host}${path}`, {
        method: 'POST',
        headers: { ...this.headers(), cookie: `${TOB_SESSION_COOKIE}=${this.session ?? ''}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      })
    } catch (error) {
      throw new Error(`Trae：无法连接企业控制台 ${host}（${error instanceof Error ? error.message : String(error)}）`)
    }
    const answer = await res.json().catch(() => undefined) as unknown
    if (!isObject(answer)) throw new Error(`Trae：企业控制台 ${path} 返回的不是 JSON（HTTP ${res.status}）`)
    const code = num(answer.code)
    if (code === NOT_LOGGED_IN) throw new TobSessionError()
    if (code !== undefined && code !== 0) {
      const message = typeof answer.message === 'string' ? answer.message : ''
      throw new Error(`Trae：企业控制台 ${path} 拒绝了请求（${code}${message ? ` ${message}` : ''}）`)
    }
    return answer
  }

  private headers(): Record<string, string> {
    const host = this.host()
    return {
      'content-type': 'application/json',
      accept: 'application/json',
      'accept-language': 'zh',
      'user-agent': this.opts.userAgent,
      origin: host,
      referer: `${host}/personal/usage`,
    }
  }
}

class TobSessionError extends Error {
  constructor() { super('session expired') }
}

/** The session cookie out of a login answer's `set-cookie` headers. */
function sessionFrom(res: Response): string | undefined {
  const headers = res.headers as Headers & { getSetCookie?: () => string[] }
  const all = headers.getSetCookie?.() ?? (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')!] : [])
  for (const line of all) {
    const match = new RegExp(`${TOB_SESSION_COOKIE}=([^;]+)`, 'i').exec(line)
    if (match) return match[1]
  }
  return undefined
}
