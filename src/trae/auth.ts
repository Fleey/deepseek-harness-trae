/**
 * Trae enterprise authentication: Personal Access Token -> Cloud-IDE JWT.
 *
 * Mirrors what `traecli login --with-trae-pat` does (read from traecli
 * 0.206.1-tob, `codex_login::trae_pat`): POST the PAT as `RefreshToken`
 * together with the CLI's OAuth client id to
 * `/cloudide/api/v3/trae/oauth/ExchangeToken`; the answer carries a JWT that
 * llm_raw_chat accepts as `Authorization: Cloud-IDE-JWT <token>`.
 *
 * The PAT itself is long-lived, so instead of a separate refresh protocol we
 * simply exchange the PAT again shortly before the JWT expires (or when the
 * backend rejects it).
 */

import { LlmError } from '@deepseek-ai/dsh-llm'

export const TRAE_HOST = 'https://api.enterprise.trae.cn'
export const EXCHANGE_PATH = '/cloudide/api/v3/trae/oauth/ExchangeToken'
/** OAuth client id traecli's PAT login sends. */
export const CLI_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
/** Exchange again this long before the JWT's own expiry. */
const REFRESH_SKEW_MS = 5 * 60_000

export interface TraeSession {
  token: string
  /** Epoch ms. */
  expiresAt: number
  /** Account e-mail decoded from the JWT, for the status line. */
  email?: string
}

type Json = Record<string, unknown>

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function pick(obj: Json, keys: readonly string[]): unknown {
  for (const key of keys) if (obj[key] !== undefined && obj[key] !== null && obj[key] !== '') return obj[key]
  return undefined
}

/** Decode a JWT payload without verifying it (we only read exp / e-mail). */
export function decodeJwt(token: string): Json | undefined {
  const parts = token.split('.')
  if (parts.length !== 3) return undefined
  try {
    const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as Json
    if (typeof payload.data === 'string') {
      try { payload.data = JSON.parse(payload.data) } catch { /* keep string */ }
    }
    return payload
  } catch {
    return undefined
  }
}

/** Turn an epoch (s or ms) or ISO date into epoch ms. */
export function parseExpiry(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value < 1e12 ? value * 1000 : value
  if (typeof value === 'string' && value.trim()) {
    if (/^\d+$/.test(value.trim())) return parseExpiry(Number(value.trim()))
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function sessionFromToken(token: string, expiryHint?: unknown): TraeSession {
  const claims = decodeJwt(token)
  const data = isObject(claims?.data) ? claims.data : undefined
  const expiresAt = parseExpiry(expiryHint) ?? parseExpiry(claims?.exp) ?? Date.now() + 60 * 60_000
  return { token, expiresAt, ...typeof data?.email === 'string' ? { email: data.email } : {} }
}

/** Find the token object inside whatever envelope the gateway wrapped it in. */
function unwrap(body: unknown): { token?: string; expiry?: unknown; error?: string } {
  if (!isObject(body)) return { error: 'response is not a JSON object' }
  const meta = isObject(body.ResponseMetadata) ? body.ResponseMetadata : undefined
  const metaError = meta && isObject(meta.Error) ? meta.Error : undefined
  for (const candidate of [body.Result, body.Data, body.data, body.result, body]) {
    if (!isObject(candidate)) continue
    const inner = isObject(candidate.OauthToken) ? candidate.OauthToken : isObject(candidate.Token) ? candidate.Token : candidate
    const token = pick(inner, ['Token', 'token', 'AccessToken', 'access_token', 'accessToken'])
    if (typeof token === 'string' && token.length > 20) {
      return { token, expiry: pick(inner, ['TokenExpireAt', 'token_expire_at', 'ExpiredAt', 'expires_at', 'ExpireAt']) }
    }
  }
  const message = pick(metaError ?? body, ['Message', 'message', 'msg', 'error', 'Error'])
  const code = pick(metaError ?? body, ['Code', 'code'])
  return { error: [code, typeof message === 'string' ? message : JSON.stringify(body).slice(0, 300)].filter(Boolean).join(': ') }
}

export interface TraeAuthOptions {
  host: string
  clientId: string
  userAgent: string
  /** Current PAT (or a ready JWT) from the credential store; undefined when not configured. */
  readSecret: () => Promise<string | undefined>
}

export class TraeAuth {
  private session: TraeSession | undefined
  private sessionSecret: string | undefined
  private pending: Promise<TraeSession> | undefined

  constructor(private readonly opts: TraeAuthOptions) {}

  /** Forget the cached JWT (the PAT changed). */
  reset(): void { this.session = undefined; this.sessionSecret = undefined; this.pending = undefined }

  /** Last good session, if any (for status display). */
  get current(): TraeSession | undefined { return this.session }

  /** A valid JWT, exchanging the PAT when there is none or it is about to expire. */
  async get(force = false): Promise<TraeSession> {
    const secret = (await this.opts.readSecret())?.trim()
    if (!secret) {
      throw new LlmError(
        'Trae：还没有填写个人访问令牌（PAT）。请到 设置 → 模型 → Trae 里填写。',
        'MISSING_CREDENTIAL',
      )
    }
    if (secret !== this.sessionSecret) this.reset()
    const fresh = this.session && this.session.expiresAt - REFRESH_SKEW_MS > Date.now()
    if (!force && fresh) return this.session!
    if (!force && this.pending) return this.pending
    const pending = this.obtain(secret).then(
      (session) => {
        if (this.pending === pending) { this.session = session; this.sessionSecret = secret; this.pending = undefined }
        return session
      },
      (error: unknown) => { if (this.pending === pending) this.pending = undefined; throw error },
    )
    this.pending = pending
    return pending
  }

  private async obtain(secret: string): Promise<TraeSession> {
    // Someone pasted the JWT itself (e.g. from traecli's auth.json): use it as is.
    if (/^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(secret)) {
      const session = sessionFromToken(secret)
      if (session.expiresAt <= Date.now()) {
        throw new LlmError('Trae：填写的是一个已过期的 JWT。请改填企业版控制台生成的个人访问令牌（PAT）。', 'AUTH')
      }
      return session
    }
    let res: Response
    try {
      res = await fetch(`${this.opts.host}${EXCHANGE_PATH}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json', 'user-agent': this.opts.userAgent },
        body: JSON.stringify({ RefreshToken: secret, ClientID: this.opts.clientId }),
        signal: AbortSignal.timeout(30_000),
      })
    } catch (error) {
      throw new LlmError(`Trae：无法连接 ${this.opts.host}（${error instanceof Error ? error.message : String(error)}）`, 'PROVIDER_UNAVAILABLE')
    }
    const text = await res.text()
    let body: unknown
    try { body = JSON.parse(text) } catch { body = undefined }
    const found = unwrap(body)
    if (!res.ok || !found.token) {
      const detail = found.error ?? text.slice(0, 300)
      const auth = res.status === 401 || res.status === 403 || /token|auth|expire|invalid|unauthor/i.test(detail)
      throw new LlmError(
        `Trae：个人访问令牌兑换失败（HTTP ${res.status}）${detail ? `：${detail}` : ''}。请确认 PAT 正确且未过期。`,
        auth ? 'AUTH' : 'PROVIDER_HTTP_ERROR',
        { status: res.status },
      )
    }
    return sessionFromToken(found.token, found.expiry)
  }
}
