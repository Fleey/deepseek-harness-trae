/**
 * The IDE login's view of the account — `GetUserInfo`, the call the IDE makes
 * on sign-in. It is where the client's `User` (and so `User.idOrDefault`, the
 * `env_metadata.user_id` of every business report) comes from; the JWT does
 * not carry the user id.
 *
 *   POST {consoleHost}/cloudide/api/v3/trae/GetUserInfo
 *   x-cloudide-token: <JWT>      (not `Authorization: Cloud-IDE-JWT`)
 *   {}
 *
 * → `Data.UserInfo.UserID` (a numeric string) and `Data.PrivacyMode`, the
 * gate the client checks before reporting anything.
 */

import type { TraeAuth } from './auth.ts'

export const USER_INFO_PATH = '/cloudide/api/v3/trae/GetUserInfo'

export interface TraeUser {
  userId: string
  /** Privacy mode is on: the IDE reports nothing for this account. */
  privacyMode: boolean
}

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)

function at(obj: Json | undefined, ...keys: string[]): unknown {
  if (!obj) return undefined
  for (const key of keys) if (obj[key] !== undefined && obj[key] !== null) return obj[key]
  return undefined
}

const truthy = (value: unknown): boolean =>
  value === true || value === 1 || (typeof value === 'string' && /^(?:1|true|on|yes)$/i.test(value.trim()))

/** A GetUserInfo answer -> the two fields used here; throws when it is a refusal or has no user id. */
export function parseUserInfo(body: unknown): TraeUser {
  if (!isObject(body)) throw new Error('GetUserInfo: response is not a JSON object')
  const code = at(body, 'code', 'Code')
  if (code !== undefined && Number(code) !== 0) {
    throw new Error(`GetUserInfo: ${String(code)} ${String(at(body, 'message', 'Message') ?? '')}`.trim())
  }
  const data = at(body, 'Data', 'data', 'Result')
  const info = isObject(data) ? at(data, 'UserInfo', 'userInfo', 'user_info') : undefined
  const id = isObject(info) ? at(info, 'UserID', 'UserId', 'userId', 'user_id') : undefined
  if ((typeof id !== 'string' || !id.trim()) && typeof id !== 'number') throw new Error('GetUserInfo: no UserInfo.UserID in the answer')
  return {
    userId: String(id).trim(),
    privacyMode: truthy(isObject(data) ? at(data, 'PrivacyMode', 'privacyMode', 'privacy_mode') : undefined),
  }
}

export interface TraeUserInfoOptions {
  /** Origin serving GetUserInfo (the enterprise console host). */
  host: string
  auth: TraeAuth
  userAgent: string
}

export class TraeUserInfo {
  private cached: { token: string; user: TraeUser } | undefined
  private pending: { token: string; promise: Promise<TraeUser> } | undefined

  constructor(private readonly opts: TraeUserInfoOptions) {}

  reset(): void { this.cached = undefined; this.pending = undefined }

  /** The signed-in account, asked once per JWT (a new PAT means a new JWT). */
  async get(): Promise<TraeUser> {
    const { token } = await this.opts.auth.get()
    if (this.cached?.token === token) return this.cached.user
    if (this.pending?.token === token) return this.pending.promise
    const promise = this.fetch(token).then(
      (user) => { if (this.pending?.promise === promise) { this.cached = { token, user }; this.pending = undefined } return user },
      (error: unknown) => { if (this.pending?.promise === promise) this.pending = undefined; throw error },
    )
    this.pending = { token, promise }
    return promise
  }

  private async fetch(token: string): Promise<TraeUser> {
    const res = await fetch(`${this.opts.host.replace(/\/+$/, '')}${USER_INFO_PATH}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'user-agent': this.opts.userAgent,
        'x-cloudide-token': token,
      },
      body: '{}',
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) throw new Error(`GetUserInfo HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
    return parseUserInfo(await res.json())
  }
}
