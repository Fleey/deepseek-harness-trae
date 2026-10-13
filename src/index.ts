/**
 * dsh-trae2api — Trae enterprise models inside DeepSeek Harness, in one plugin.
 *
 * Host half: exchanges the Trae Personal Access Token for a Cloud-IDE JWT and
 * calls Trae's llm_raw_chat endpoint directly (the protocol trae2api's direct
 * mode reverse-engineered). No Python, no trae2api process, no traecli.
 *
 * The only thing a user sets is the PAT, from the Models page card or the
 * plugin page (browser half: lib/client.js). It lives in the dsh credential
 * store under `patEnv`, never in config. Everything else — host, identity
 * headers, model catalog, context windows, thinking levels — is built in;
 * the fields below exist only so a future Trae release can be followed from
 * cordis.patch.yml without a new plugin build.
 */

import type { Context, Volatile } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-llm'
import Schema from '@deepseek-ai/schemastery'
import { TraeAdapter, traeHeaders, type TraeIdentity } from './adapter.ts'
import { CLI_CLIENT_ID, TRAE_HOST, TraeAuth } from './trae/auth.ts'
import { TraeQuota } from './trae/quota.ts'
import { TOB_CONSOLE_HOST, TobConsole } from './trae/tob.ts'

export const name = 'dsh-trae2api'
export const inject = ['llm']

const CLIENT_VERSION = '0.206.1-tob'
/** Host route the browser half reads the remaining quota from. */
export const QUOTA_ROUTE = '/api/dsh-trae2api/quota'

export interface Config {
  provider: string
  displayName: string
  /** Credential reference holding the Trae PAT (set from the UI). */
  patEnv: Volatile<string>
  host: string
  /** Host serving the quota (额度) API; empty = ask CheckLogin, fall back to api.trae.cn. */
  payHost: string
  /** Enterprise console origin, where a ToB seat's real figures live. */
  consoleHost: string
  /** Console account e-mail; empty = no enterprise quota lookup. */
  consoleEmail: string
  /** Credential reference holding that e-mail (written by the card). */
  consoleEmailEnv: Volatile<string>
  /** Credential reference holding that account's console password. */
  consolePasswordEnv: Volatile<string>
  clientId: string
  appId: string
  ideVersionCode: string
  clientVersion: string
  readTimeoutMs: number
  emptyRetries: number
  loopGuardChars: number
}

export const Config: Schema<Config> = Schema.object({
  provider: Schema.string().pattern(/^[a-z0-9][a-z0-9-]*$/).default('trae'),
  displayName: Schema.string().default('Trae'),
  patEnv: Schema.string().role('credential-ref').default('TRAE_PAT').volatile()
    .description('Trae 个人访问令牌（PAT）在凭据库里的名字'),
  host: Schema.string().default(TRAE_HOST),
  payHost: Schema.string().default(''),
  consoleHost: Schema.string().default(TOB_CONSOLE_HOST),
  consoleEmail: Schema.string().default(''),
  consoleEmailEnv: Schema.string().role('credential-ref').default('TRAE_CONSOLE_EMAIL').volatile()
    .description('企业控制台邮箱在凭据库里的名字'),
  consolePasswordEnv: Schema.string().role('credential-ref').default('TRAE_CONSOLE_PASSWORD').volatile()
    .description('企业控制台密码在凭据库里的名字'),
  clientId: Schema.string().default(CLI_CLIENT_ID),
  appId: Schema.string().default('7b3f9dc2-8a4e-5c6d-2f1b-9e4a3c5b7df0'),
  ideVersionCode: Schema.string().default('20260908'),
  clientVersion: Schema.string().default(CLIENT_VERSION),
  readTimeoutMs: Schema.natural().default(300_000),
  emptyRetries: Schema.natural().default(1),
  loopGuardChars: Schema.natural().default(600),
}) as unknown as Schema<Config>

type CredentialsService = { resolve(ref: string): Promise<{ value?: string } | undefined> }
/** The slice of dsh's Host Connection service used here: exact, login-gated `/api/*` routes. */
type ConnectionService = {
  fetch: {
    register(route: { path: string; methods: string[]; requestBody: 'buffered'; fetch(request: Request): Promise<Response> }): unknown
  }
}

export function apply(ctx: Context, config: Config): void {
  const logger = ctx.logger as unknown as { info(...a: unknown[]): void; warn(...a: unknown[]): void }
  const anyCtx = ctx as unknown as {
    get(name: string): unknown
    inject<T>(deps: string[], cb: (child: T) => void): void
    fiber: { entry?: { options?: { id?: string } } }
  }
  const settingsNs = anyCtx.fiber?.entry?.options?.id ?? 'trae2api'

  // Our own card renders the form, so the generic generated page is off.
  try {
    anyCtx.inject<{ effect(fn: () => () => void): void; settings: { configure(p: { auto?: boolean }, owner: unknown): () => void } }>(
      ['settings'], (child) => { child.effect(() => child.settings.configure({ auto: false }, anyCtx.fiber)) },
    )
  } catch (error) { logger.warn('dsh-trae2api: settings integration unavailable', error) }

  const host = config.host.replace(/\/+$/, '')
  const userAgent = `codex_exec/${config.clientVersion} (dsh-trae2api) unknown (codex_exec; ${config.clientVersion})`

  /** A secret from dsh's credential store, falling back to the environment. */
  const readSecret = async (ref: string): Promise<string | undefined> => {
    const credentials = anyCtx.get('credentials') as CredentialsService | undefined
    let value: string | undefined
    try { value = (await credentials?.resolve(ref))?.value } catch { /* fall through */ }
    return value || process.env[ref] || undefined
  }

  const auth = new TraeAuth({
    host,
    clientId: config.clientId,
    userAgent,
    readSecret: () => readSecret(config.patEnv.get()),
  })

  // Enterprise seats only: their figures are not on the IDE-facing API at all
  // (see src/trae/tob.ts). Without a console account this stays inert.
  const tob = new TobConsole({
    host: config.consoleHost,
    userAgent,
    // The card writes the e-mail to the credential store like the password, so
    // saving the pair never has to touch config; `consoleEmail` stays as a
    // config-file escape hatch.
    readEmail: async () => (await readSecret(config.consoleEmailEnv.get())) || config.consoleEmail,
    readPassword: () => readSecret(config.consolePasswordEnv.get()),
  })

  const identity: TraeIdentity = {
    appId: config.appId,
    ideFunction: 'chat',
    ideVersion: '99.99.99',
    ideVersionCode: config.ideVersionCode,
    clientVersion: config.clientVersion,
    originator: 'codex_exec',
    userAgent,
  }

  const adapter = new TraeAdapter({
    displayName: config.displayName,
    host,
    identity,
    auth,
    readTimeoutMs: config.readTimeoutMs,
    emptyRetries: config.emptyRetries,
    loopGuardChars: config.loopGuardChars,
    // The attachment store that turns durable image references into request
    // bytes; `ctx.get` throws when absent, so guard with optional chaining on
    // the injected context (Desktop and Web both mount it; CLI-only setups
    // degrade images to placeholder text instead).
    resolveAttachments: () => {
      try { return anyCtx.get('attachments') as import('./adapter.ts').AttachmentStoreLike | undefined } catch { return undefined }
    },
    logger,
  })

  const quota = new TraeQuota({
    host,
    payHost: config.payHost,
    auth,
    userAgent,
    headers: token => traeHeaders(identity, token, 'application/json'),
    tob,
  })

  // A PAT saved from the UI changes no config field; drop the cached JWT.
  ctx.on('credentials/reference-updated' as never, ((ref: string) => {
    if (ref === config.patEnv.get()) { auth.reset(); quota.reset() }
    // The console password is its own credential; a new one invalidates the
    // cached console session, not the JWT.
    if (ref === config.consolePasswordEnv.get() || ref === config.consoleEmailEnv.get()) { tob.reset(); quota.reset() }
  }) as never)
  ctx.on('loader/volatile-update' as never, (() => { auth.reset(); quota.reset() }) as never)

  // Remaining quota for the card and the composer chip. A Connection route
  // rather than a bare webServer one: it sits behind the same Host/Origin
  // fence and browser login as the rest of `/api`, on Web and Desktop alike.
  // `?refresh` skips the one-minute cache.
  anyCtx.inject<{ connection: ConnectionService }>(['connection'], (child) => {
    try {
      child.connection.fetch.register({
        path: QUOTA_ROUTE,
        methods: ['GET'],
        requestBody: 'buffered',
        fetch: async (request) => {
          const force = new URL(request.url).searchParams.has('refresh')
          try {
            return Response.json({ ok: true, value: await quota.get(force) })
          } catch (error) {
            return Response.json({ ok: false, error: error instanceof Error ? error.message : String(error) })
          }
        },
      })
    } catch (error) { logger.warn('dsh-trae2api: quota route unavailable', error) }
  })

  // Released automatically on unload.
  ctx.llm.registerAdapter([config.provider], adapter)
  // Gives the Models settings page a "Trae" row, with our card inside it.
  ctx.llm.registerConfigurableProviders([
    { provider: config.provider, displayName: config.displayName, settingsNs, settingsPath: [] },
  ])
}
