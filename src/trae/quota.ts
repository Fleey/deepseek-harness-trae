/**
 * Trae quota (额度) lookup.
 *
 * Read from the two first-party clients, which ask the same service in two
 * spellings:
 *   - traecli 0.206.1-tob (`codex-rs/models-manager/src/trae.rs`) asks
 *     `/trae/api/v1/pay/ide_user_ent_usage` and reads each entitlement pack's
 *     `basic_usage_limit` against its `basic_usage_amount`;
 *   - the TRAE SOLO CN IDE asks `/trae/api/v2/pay/ide_user_ent_usage` with
 *     `{ require_usage: true }` and reads `credits_limit` against
 *     `usage.credits_amount` (its `cnCreditsUsage` module).
 * Both answer `user_entitlement_pack_list[]`; a limit of -1 means unlimited and
 * a limit of 0 means the pack carries no quota of this kind. This module tries
 * both paths and accepts both spellings, snake or camel case.
 *
 * The service is not on the enterprise API host: there both paths are a bare
 * gateway 404, while `api.trae.cn` answers them (401 without a token, with the
 * `is_dollar_usage_billing` fields of this very response). Both clients learn
 * the host from `CheckLogin`'s `AIPayHost` (asked for with `GetAIPayHost`), so
 * this does too, and falls back to `api.trae.cn` when that yields nothing.
 *
 * An answer the parser does not recognise is passed through (trimmed) for the
 * UI to show rather than reported as "no quota".
 *
 * Measured with an enterprise (ToB) PAT on 2026-10-13: this API is the CN
 * consumer one and knows nothing about an enterprise seat's quota.
 * `CheckLogin` names no `AIPayHost` (`Host: ""`), both paths are an openresty
 * 404 on `api.enterprise.trae.cn`, and `api.trae.cn` answers 200 with the
 * seat's *personal* free entitlement only — `product_type: 0`,
 * `display_desc: "免费"`, `entitlement_id: "free_utc…"`, every numeric limit 0
 * (v2 does not even return numeric limits, just `enable_solo_*` booleans).
 * The seat's real quota lives on the enterprise tenant (the JWT's
 * `tob_tenant_id` / `tenant_id: "tob_online"`), which no known IDE-facing
 * endpoint exposes. So a ToB token that gets back nothing but a free personal
 * pack is reported as an enterprise seat (`seat: 'enterprise'`) rather than as
 * an account with no quota.
 */

import { decodeJwt, parseExpiry, type TraeAuth } from './auth.ts'

/** Tried in order: the enterprise CLI's path first, then the IDE's. */
export const QUOTA_PATHS = ['/trae/api/v1/pay/ide_user_ent_usage', '/trae/api/v2/pay/ide_user_ent_usage'] as const
/** Asked on the API host for the account's pay host. */
export const CHECK_LOGIN_PATH = '/cloudide/api/v3/trae/CheckLogin'
/** The IDE's `ug` host for CN, used when CheckLogin names no pay host. */
export const FALLBACK_PAY_HOST = 'https://api.trae.cn'

export interface QuotaPack {
  name: string
  /** `null` = unlimited. */
  limit: number | null
  used: number
  /** `null` = unlimited. */
  remaining: number | null
  /** Epoch ms the pack ends, when upstream says. */
  endsAt?: number
}

export interface QuotaSnapshot {
  packs: QuotaPack[]
  /** Totals over `packs`; `null` when any pack is unlimited. */
  limit: number | null
  used: number
  remaining: number | null
  /** Upstream bills this account in US dollars rather than credits. */
  dollars: boolean
  /** Earliest end among the packs. */
  endsAt?: number
  fetchedAt: number
  /** Only when the answer had no recognisable pack list: a trimmed copy of it. */
  raw?: string
  /** `host + path` that produced this snapshot, for the UI to name when it is empty. */
  source?: string
  /** `'enterprise'` when the token is a ToB seat, whose quota this API never carries. */
  seat?: 'enterprise'
  /** The enterprise tenant id from the JWT, when there is one. */
  tenant?: string
  /** Per-model usage, when it came from the enterprise console (see `tob.ts`). */
  models?: { name: string; tokens: number; cost: number }[]
}

type Json = Record<string, unknown>

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function field(obj: Json | undefined, ...keys: string[]): unknown {
  if (!obj) return undefined
  for (const key of keys) if (obj[key] !== undefined && obj[key] !== null) return obj[key]
  return undefined
}

function objectAt(obj: Json | undefined, ...keys: string[]): Json | undefined {
  const value = field(obj, ...keys)
  return isObject(value) ? value : undefined
}

function numberOf(value: unknown): number | undefined {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined
}

/** First numeric value under any of `keys`, searching the sources in order. */
function firstNumber(sources: readonly (Json | undefined)[], keys: readonly string[]): number | undefined {
  for (const source of sources) {
    for (const key of keys) {
      const n = numberOf(source?.[key])
      if (n !== undefined) return n
    }
  }
  return undefined
}

const LIMIT_KEYS = ['basic_usage_limit', 'basicUsageLimit', 'credits_limit', 'creditsLimit'] as const
const USED_KEYS = ['basic_usage_amount', 'basicUsageAmount', 'credits_amount', 'creditsAmount'] as const
const LIST_KEYS = ['user_entitlement_pack_list', 'userEntitlementPackList'] as const

/** `CommercialProductType` from the IDE's commercial SDK. */
const PRODUCT_NAMES: Record<number, string> = { 0: 'Free', 1: 'Pro', 2: '加油包', 3: 'Pro+', 4: 'Ultra', 5: 'Lite', 100: 'Express' }

/** The object holding the pack list, wherever the gateway put it. */
function payload(body: Json): Json | undefined {
  for (const candidate of [body.data, body.Data, body.Result, body.result, body]) {
    if (isObject(candidate) && LIST_KEYS.some(key => Array.isArray(candidate[key]))) return candidate
  }
  return undefined
}

function businessError(body: Json): string | undefined {
  const meta = objectAt(body, 'ResponseMetadata')
  const source = objectAt(meta, 'Error') ?? body
  const code = field(source, 'code', 'Code')
  const message = field(source, 'message', 'Message', 'msg')
  if (code === undefined || code === 0 || code === '0') return undefined
  return [String(code), typeof message === 'string' ? message : ''].filter(Boolean).join(' ')
}

/**
 * Turn an `ide_user_ent_usage` answer into totals, the way the IDE's
 * `cnCreditsUsage` does: unlimited wins, a zero limit is skipped, and
 * remaining never goes below zero. Packs already past their end are dropped.
 * @throws when upstream answered with a business error and no pack list.
 */
export function parseQuota(body: unknown, now = Date.now()): QuotaSnapshot {
  const empty: QuotaSnapshot = { packs: [], limit: 0, used: 0, remaining: 0, dollars: false, fetchedAt: now }
  if (!isObject(body)) return { ...empty, raw: String(body).slice(0, 2000) }
  const data = payload(body)
  if (!data) {
    const error = businessError(body)
    if (error) throw new Error(`Trae 拒绝了额度查询：${error}`)
    return { ...empty, raw: JSON.stringify(body).slice(0, 2000) }
  }
  const list = field(data, ...LIST_KEYS) as unknown[]
  const packs: QuotaPack[] = []
  // A pack whose limit keys exist but read 0 is a recognised format saying
  // "no quota" (free tier); only entries with no known key at all count as
  // "the format changed on us".
  let recognized = false
  for (const [index, entry] of list.entries()) {
    if (!isObject(entry)) continue
    const base = objectAt(entry, 'entitlement_base_info', 'entitlementBaseInfo')
    const subscription = objectAt(objectAt(base, 'product_extra', 'productExtra'), 'subscription_extra', 'subscriptionExtra')
    const quotas = [objectAt(base, 'quota'), objectAt(subscription, 'quota'), objectAt(entry, 'quota')]
    const limit = firstNumber(quotas, LIMIT_KEYS)
    if (limit === undefined) continue
    recognized = true
    if (limit === 0) continue
    const endsAt = parseExpiry(field(base, 'end_time', 'endTime') ?? field(entry, 'expire_time', 'expireTime'))
    if (endsAt !== undefined && endsAt <= now) continue
    const used = Math.max(0, firstNumber([objectAt(entry, 'usage'), ...quotas], USED_KEYS) ?? 0)
    const unlimited = limit < 0
    const desc = field(entry, 'display_desc', 'displayDesc')
    const productType = numberOf(field(base, 'product_type', 'productType'))
    packs.push({
      name: typeof desc === 'string' && desc.trim() ? desc.trim()
        : productType !== undefined && PRODUCT_NAMES[productType] ? PRODUCT_NAMES[productType]!
          : `套餐 ${index + 1}`,
      limit: unlimited ? null : limit,
      used,
      remaining: unlimited ? null : Math.max(limit - used, 0),
      ...endsAt !== undefined ? { endsAt } : {},
    })
  }
  const unlimited = packs.some(p => p.limit === null)
  const ends = packs.map(p => p.endsAt).filter((t): t is number => t !== undefined)
  const snapshot: QuotaSnapshot = {
    packs,
    limit: unlimited ? null : packs.reduce((sum, p) => sum + p.limit!, 0),
    used: packs.reduce((sum, p) => sum + p.used, 0),
    remaining: unlimited ? null : packs.reduce((sum, p) => sum + p.remaining!, 0),
    dollars: field(data, 'is_dollar_usage_billing', 'isDollarUsageBilling') === true,
    fetchedAt: now,
    ...ends.length > 0 ? { endsAt: Math.min(...ends) } : {},
  }
  // A pack list was present but carried no limit key we know: show the answer
  // instead of claiming the account has nothing. Packs that read a known 0
  // limit are a normal "no quota" answer, not a format change.
  if (packs.length === 0 && list.length > 0 && !recognized) snapshot.raw = JSON.stringify(body).slice(0, 2000)
  return snapshot
}

class QuotaHttpError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

/**
 * The enterprise tenant a JWT belongs to, if any: ToB tokens carry
 * `tob_tenant_id` (a numeric id) and `tenant_id: "tob_online"`; a consumer
 * token carries neither.
 */
export function enterpriseTenant(token: string): string | undefined {
  const claims = decodeJwt(token)
  const data = isObject(claims?.data) ? claims.data : claims
  const tob = field(data, 'tob_tenant_id', 'tobTenantId', 'tobTenantID')
  if (tob !== undefined && String(tob).trim() && String(tob).trim() !== '0') return String(tob).trim()
  const tenant = field(data, 'tenant_id', 'tenantId', 'tenantID')
  return typeof tenant === 'string' && /^tob/i.test(tenant.trim()) ? tenant.trim() : undefined
}

/** `api.trae.cn`, `https://api.trae.cn/` → `https://api.trae.cn`. */
export function normalizeHost(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '')
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

export interface QuotaOptions {
  /** The API host (where CheckLogin lives). */
  host: string
  /** A fixed pay host; empty = ask CheckLogin, then fall back to api.trae.cn. */
  payHost?: string
  auth: TraeAuth
  userAgent: string
  /** Identity headers for a call on `host`, given a JWT. */
  headers: (token: string) => Record<string, string>
  /** Answers younger than this are served from memory. */
  ttlMs?: number
  /**
   * The enterprise console reader (`tob.ts`), asked first for a ToB seat and
   * only then. It answers `undefined` when no console account is configured.
   */
  tob?: { read(now?: number): Promise<QuotaSnapshot | undefined>; reset(): void }
}

/** Cached, de-duplicated quota reads for the settings card and the composer chip. */
export class TraeQuota {
  private cached: QuotaSnapshot | undefined
  private pending: Promise<QuotaSnapshot> | undefined
  private payHosts: string[] | undefined
  /** The host + path that answered last; asked first next time. */
  private preferred: { host: string; path: string } | undefined

  constructor(private readonly opts: QuotaOptions) {}

  /** Forget everything learned for the current PAT. */
  reset(): void {
    this.cached = undefined; this.pending = undefined; this.payHosts = undefined; this.preferred = undefined
    this.opts.tob?.reset()
  }

  get(force = false): Promise<QuotaSnapshot> {
    const ttl = this.opts.ttlMs ?? 60_000
    if (!force && this.cached && Date.now() - this.cached.fetchedAt < ttl) return Promise.resolve(this.cached)
    if (this.pending) return this.pending
    const pending = this.read().then(
      (snapshot) => {
        if (this.pending === pending) { this.cached = snapshot; this.pending = undefined }
        return snapshot
      },
      (error: unknown) => { if (this.pending === pending) this.pending = undefined; throw error },
    )
    this.pending = pending
    return pending
  }

  private async read(): Promise<QuotaSnapshot> {
    // Missing or rejected PAT: not a quota problem, report it as is.
    const { token } = await this.opts.auth.get()
    const tenant = enterpriseTenant(token)
    // An enterprise seat's figures only exist in the console; a consumer token
    // has no console account, so that path is skipped entirely for it.
    if (tenant !== undefined && this.opts.tob) {
      const snapshot = await this.opts.tob.read()
      if (snapshot) return { ...snapshot, tenant: snapshot.tenant ?? tenant }
    }
    const targets: { host: string; path: string }[] = []
    if (this.preferred) targets.push(this.preferred)
    for (const host of await this.hosts(token)) {
      for (const path of QUOTA_PATHS) {
        if (!targets.some(t => t.host === host && t.path === path)) targets.push({ host, path })
      }
    }
    let failure: QuotaHttpError | undefined
    let unrecognised: QuotaSnapshot | undefined
    let empty: QuotaSnapshot | undefined
    // A 404 only says this host/path does not serve it; any other failure is
    // the more useful one to report.
    const record = (error: QuotaHttpError): void => { if (!failure || failure.status === 404) failure = error }
    for (const target of targets) {
      const source = `${target.host}${target.path}`
      let body: unknown
      try {
        body = await this.post(target.host, target.path, token)
      } catch (error) {
        if (!(error instanceof QuotaHttpError)) throw error
        record(error)
        continue
      }
      let snapshot: QuotaSnapshot
      try {
        snapshot = parseQuota(body)
      } catch (error) {
        record(new QuotaHttpError(error instanceof Error ? error.message : String(error), 200))
        continue
      }
      snapshot.source = source
      if (tenant !== undefined) { snapshot.seat = 'enterprise'; snapshot.tenant = tenant }
      if (snapshot.raw === undefined && snapshot.packs.length > 0) {
        this.preferred = target
        return snapshot
      }
      // A pack list this host knows nothing about (an enterprise seat has no
      // personal entitlement packs, so one of these hosts answers an empty
      // list) is not an answer worth stopping on: keep asking the others, and
      // only fall back to it when nothing carries packs.
      if (snapshot.raw === undefined) empty ??= snapshot
      else unrecognised ??= snapshot
    }
    if (empty) return empty
    if (unrecognised) return unrecognised
    throw failure ?? new Error('Trae 额度查询失败')
  }

  /** Pay hosts to try: the configured one, else CheckLogin's, then the fallback. */
  private async hosts(token: string): Promise<string[]> {
    if (this.opts.payHost?.trim()) return [normalizeHost(this.opts.payHost)]
    if (this.payHosts) return this.payHosts
    const discovered = await this.discoverPayHost(token)
    const hosts = [...new Set([...discovered.host ? [discovered.host] : [], FALLBACK_PAY_HOST])]
    // A network failure is worth asking again about next time; an answer is not.
    if (discovered.answered) this.payHosts = hosts
    return hosts
  }

  /** CheckLogin with `GetAIPayHost`, the way the IDE asks it (token in `x-cloudide-token`). */
  private async discoverPayHost(token: string): Promise<{ host?: string; answered: boolean }> {
    let res: Response
    try {
      res = await fetch(`${this.opts.host}${CHECK_LOGIN_PATH}`, {
        method: 'POST',
        headers: { ...this.opts.headers(token), 'x-cloudide-token': token },
        body: JSON.stringify({ GetAIPayHost: true, ReqSource: 'IDE' }),
        signal: AbortSignal.timeout(15_000),
      })
    } catch {
      return { answered: false }
    }
    let body: unknown
    try { body = await res.json() } catch { return { answered: res.ok } }
    const data = isObject(body) ? objectAt(body, 'Data', 'Result', 'data', 'result') : undefined
    const host = field(data, 'AIPayHost', 'AiPayHost', 'ai_pay_host')
    return { answered: res.ok, ...typeof host === 'string' && host.trim() ? { host: normalizeHost(host) } : {} }
  }

  /** One POST to a pay host, with the headers the IDE sends there. */
  private async post(host: string, path: string, token: string): Promise<unknown> {
    let res: Response
    try {
      res = await fetch(`${host}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'user-agent': this.opts.userAgent,
          authorization: `Cloud-IDE-JWT ${token}`,
        },
        body: JSON.stringify({ require_usage: true }),
        signal: AbortSignal.timeout(20_000),
      })
    } catch (error) {
      throw new QuotaHttpError(`Trae：无法连接 ${host}（${error instanceof Error ? error.message : String(error)}）`, 0)
    }
    const text = await res.text()
    if (!res.ok) {
      // A gateway's HTML error page says nothing the status does not.
      let detail = text.trim().startsWith('<') ? '' : text.trim()
      try {
        const body = JSON.parse(text) as unknown
        if (isObject(body)) detail = [field(body, 'code'), field(body, 'message')].filter(v => v !== undefined).join(' ')
      } catch { /* keep text */ }
      const hint = res.status === 404 ? '，该地址不提供此接口' : res.status === 401 || res.status === 403 ? '，该地址不接受当前令牌' : ''
      throw new QuotaHttpError(`Trae 额度查询失败（${host}，HTTP ${res.status}${hint}）${detail ? `：${detail.slice(0, 300)}` : ''}`, res.status)
    }
    try {
      return JSON.parse(text) as unknown
    } catch {
      throw new QuotaHttpError(`Trae 额度查询返回的不是 JSON（${host}）：${text.trim().slice(0, 300)}`, res.status)
    }
  }
}
