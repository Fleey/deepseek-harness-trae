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
import { TraeAdapter } from './adapter.ts'
import { CLI_CLIENT_ID, TRAE_HOST, TraeAuth } from './trae/auth.ts'

export const name = 'dsh-trae2api'
export const inject = ['llm']

const CLIENT_VERSION = '0.206.1-tob'

export interface Config {
  provider: string
  displayName: string
  /** Credential reference holding the Trae PAT (set from the UI). */
  patEnv: Volatile<string>
  host: string
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
  clientId: Schema.string().default(CLI_CLIENT_ID),
  appId: Schema.string().default('7b3f9dc2-8a4e-5c6d-2f1b-9e4a3c5b7df0'),
  ideVersionCode: Schema.string().default('20260908'),
  clientVersion: Schema.string().default(CLIENT_VERSION),
  readTimeoutMs: Schema.natural().default(300_000),
  emptyRetries: Schema.natural().default(1),
  loopGuardChars: Schema.natural().default(600),
}) as unknown as Schema<Config>

type CredentialsService = { resolve(ref: string): Promise<{ value?: string } | undefined> }

export function apply(ctx: Context, config: Config): void {
  const logger = ctx.logger as unknown as { info(...a: unknown[]): void; warn(...a: unknown[]): void }
  const anyCtx = ctx as unknown as {
    get(name: string): unknown
    inject(deps: string[], cb: (child: { effect(fn: () => () => void): void; settings: { configure(p: { auto?: boolean }, owner: unknown): () => void } }) => void): void
    fiber: { entry?: { options?: { id?: string } } }
  }
  const settingsNs = anyCtx.fiber?.entry?.options?.id ?? 'trae2api'

  // Our own card renders the form, so the generic generated page is off.
  try {
    anyCtx.inject(['settings'], (child) => { child.effect(() => child.settings.configure({ auto: false }, anyCtx.fiber)) })
  } catch (error) { logger.warn('dsh-trae2api: settings integration unavailable', error) }

  const host = config.host.replace(/\/+$/, '')
  const userAgent = `codex_exec/${config.clientVersion} (dsh-trae2api) unknown (codex_exec; ${config.clientVersion})`

  const auth = new TraeAuth({
    host,
    clientId: config.clientId,
    userAgent,
    readSecret: async () => {
      const ref = config.patEnv.get()
      const credentials = anyCtx.get('credentials') as CredentialsService | undefined
      let value: string | undefined
      try { value = (await credentials?.resolve(ref))?.value } catch { /* fall through */ }
      return value || process.env[ref] || undefined
    },
  })

  const adapter = new TraeAdapter({
    displayName: config.displayName,
    host,
    identity: {
      appId: config.appId,
      ideFunction: 'chat',
      ideVersion: '99.99.99',
      ideVersionCode: config.ideVersionCode,
      clientVersion: config.clientVersion,
      originator: 'codex_exec',
      userAgent,
    },
    auth,
    readTimeoutMs: config.readTimeoutMs,
    emptyRetries: config.emptyRetries,
    loopGuardChars: config.loopGuardChars,
    logger,
  })

  // A PAT saved from the UI changes no config field; drop the cached JWT.
  ctx.on('credentials/reference-updated' as never, ((ref: string) => {
    if (ref === config.patEnv.get()) auth.reset()
  }) as never)
  ctx.on('loader/volatile-update' as never, (() => { auth.reset() }) as never)

  // Released automatically on unload.
  ctx.llm.registerAdapter([config.provider], adapter)
  // Gives the Models settings page a "Trae" row, with our card inside it.
  ctx.llm.registerConfigurableProviders([
    { provider: config.provider, displayName: config.displayName, settingsNs, settingsPath: [] },
  ])
}
