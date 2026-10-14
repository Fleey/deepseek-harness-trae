/**
 * Business event reporting to Trae's `report/clients` endpoint — the one the
 * IDE's completion (Cue) client posts its `code_gen_*` events to, so an
 * accepted composer suggestion shows up in the account's Cue statistics.
 *
 * Same auth as llm_raw_chat (Cloud-IDE JWT + app id); the body is multipart
 * with one `body` field holding a JSON string, and each event's `payload` is
 * itself a JSON *string* (the client does `payload: JSON.stringify(r)`).
 * `resp_id` ties a `shown` to its `accept`; one event = one count.
 *
 * `env_metadata.user_id` is the IDE login's user id (`User.idOrDefault` in the
 * client), which the JWT does not carry: it comes from GetUserInfo (see
 * user.ts), the same answer whose `PrivacyMode` makes the client report
 * nothing — and makes this reporter skip too.
 */

import type { TraeAuth } from './auth.ts'
import type { TraeUser } from './user.ts'

export const REPORT_PATH = '/api/ide/v1/report/clients'

/** Event names from the client's `ReportEventApi` used here. */
export type CueEventName = 'code_gen_shown' | 'code_gen_accept'

export interface CueEvent {
  event: CueEventName
  /** Stringified into the event's `payload`. */
  payload: Record<string, unknown>
}

export interface CueReporterOptions {
  host: string
  auth: TraeAuth
  appId: string
  ideVersion: string
  ideVersionCode: string
  userAgent: string
  /** The signed-in account, as the IDE login reports it. */
  user: () => Promise<TraeUser>
}

export class TraeCueReporter {
  constructor(private readonly opts: CueReporterOptions) {}

  private body(userId: string, events: readonly CueEvent[], now: number): string {
    return JSON.stringify({
      env_metadata: {
        ide_version: this.opts.ideVersion,
        environment: '',
        extension_version: '',
        version_code: Number(this.opts.ideVersionCode) || 0,
        region: 'cn',
        channel: 'unknown',
        app_id: this.opts.appId,
        user_id: userId,
        ab_version: '',
      },
      events: events.map(e => ({ event: e.event, timestamp: now, payload: JSON.stringify(e.payload) })),
    })
  }

  /**
   * Post events; retries once with a fresh JWT on 401/403, throws on any other
   * failure. Resolves to false, sending nothing, for a privacy-mode account.
   */
  async report(events: readonly CueEvent[]): Promise<boolean> {
    if (events.length === 0) return false
    const user = await this.opts.user()
    if (user.privacyMode) return false
    let session = await this.opts.auth.get()
    for (let attempt = 0; ; attempt++) {
      const form = new FormData()
      form.append('body', this.body(user.userId, events, Date.now()))
      const res = await fetch(`${this.opts.host}${REPORT_PATH}`, {
        method: 'POST',
        headers: {
          authorization: `Cloud-IDE-JWT ${session.token}`,
          'x-app-id': this.opts.appId,
          'user-agent': this.opts.userAgent,
        },
        body: form,
        signal: AbortSignal.timeout(10_000),
      })
      if ((res.status === 401 || res.status === 403) && attempt === 0) {
        await res.body?.cancel()
        session = await this.opts.auth.get(true)
        continue
      }
      if (!res.ok) throw new Error(`report/clients HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
      await res.body?.cancel()
      return true
    }
  }
}
