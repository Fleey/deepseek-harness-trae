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
import {
  CATALOG_PATH, CHAT_FUNCTION, EXTRA_CATALOG_FUNCTIONS, MODELS_CACHE_FILE, TraeCatalog, type CatalogOrigin,
} from './trae/catalog-source.ts'
import { TraeCueReporter } from './trae/cue.ts'
import { traeDebugLine } from './trae/debug.ts'
import { TraeUserInfo } from './trae/user.ts'
import { TraeQuota } from './trae/quota.ts'
import { TraeSuggestions } from './trae/suggest.ts'
import { TOB_CONSOLE_HOST, TobConsole } from './trae/tob.ts'

export const name = 'dsh-trae2api'
export const inject = ['llm']

const CLIENT_VERSION = '0.206.1-tob'
/** Host route the browser half reads the remaining quota from. */
export const QUOTA_ROUTE = '/api/dsh-trae2api/quota'
/** Host route serving the model catalog and its origin; `?refresh` re-asks upstream. */
export const CATALOG_ROUTE = '/api/dsh-trae2api/catalog'
/** Host route the browser half reads a session's own id — and its upstream one — from. */
export const SESSION_ROUTE = '/api/dsh-trae2api/session'
/** Host route the browser half reads a session's next-step choices from. */
export const SUGGESTION_ROUTE = '/api/dsh-trae2api/suggestion'
/** Longest a suggestion request may wait for one still being generated. */
const SUGGESTION_MAX_WAIT_MS = 30_000
/** Host route the browser half reports choices being shown / one being accepted to. */
export const SUGGESTION_EVENT_ROUTE = '/api/dsh-trae2api/suggestion/event'
/** Environment fallback for `cueUserId`. */
const CUE_USER_ID_ENV = 'TRAE_USER_ID'

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
  /**
   * Where the model list comes from: `auto` asks Trae, then traecli's cache
   * file, then the built-in table; the other values pin it to one source.
   */
  catalogSource: CatalogOrigin | 'auto'
  /**
   * Catalog functions to ask upstream for. `chat` is what traecli asks and is
   * always the first request; the rest are asked in a second, best-effort one,
   * so a name this host rejects costs only its own models. `['chat']` keeps the
   * catalog to exactly traecli's question.
   */
  catalogFunctions: string[]
  /** traecli's model cache; empty = `~/.trae/cli/models_cache.json`. */
  modelsCacheFile: string
  /**
   * Local cap on the context window reported to the harness; 0 = each model's
   * own window. Only moves when compaction happens — upstream serves the same
   * window either way.
   */
  contextBudgetTokens: number
  readTimeoutMs: number
  emptyRetries: number
  loopGuardChars: number
  /**
   * Turn a tool call the model wrote as `<invoke>` prose into a real one. Only
   * outside code fences, only at the end of an answer with no native tool
   * call; false leaves every such block in the answer as text.
   */
  recoverTextToolCalls: boolean
  /** Offer next-step choices above the composer after each answer (yes sends one). */
  suggestions: boolean
  /** Model asked for suggestions; empty = the model that answered. */
  suggestModel: string
  suggestTimeoutMs: number
  /**
   * A pressed card hands its task to a subagent instead of this session: the
   * composer sends the reply wrapped in that instruction and says so on the
   * cards. Needs a delegation tool in the harness (`@deepseek-ai/dsh-subagent`
   * plus `dsh-tool-subagent`); without one the model just does it itself.
   */
  suggestSubagent: boolean
  /** Report shown / accepted suggestions to Trae's Cue statistics (report/clients). */
  reportCue: boolean
  /** Trae account user id for those reports; empty = GetUserInfo ($TRAE_USER_ID wins if set). */
  cueUserId: string
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
  catalogSource: Schema.union(['auto', 'upstream', 'cache', 'builtin'] as const).default('auto')
    .description('模型目录来源：auto = 上游 → traecli 缓存 → 内置'),
  catalogFunctions: Schema.array(Schema.string()).default([CHAT_FUNCTION])
    .description(`问上游要目录的通道（function）；chat 之外的那些单独发一次请求，问不到就只用 chat 的那份。企业版实测只有 chat 上架模型，想试别的填 ${EXTRA_CATALOG_FUNCTIONS.join(' / ')}`),
  modelsCacheFile: Schema.string().default('')
    .description('traecli 模型缓存路径；空 = ~/.trae/cli/models_cache.json'),
  contextBudgetTokens: Schema.natural().default(0)
    .description('本地上下文预算上限（token）；0 = 用模型自己的窗口。只改压缩时机，不改上游服务的窗口（Max 模型想要半步就填 500000）'),
  readTimeoutMs: Schema.natural().default(300_000),
  emptyRetries: Schema.natural().default(1),
  loopGuardChars: Schema.natural().default(600),
  recoverTextToolCalls: Schema.boolean().default(true)
    .description('把模型写成 <invoke> 文本的工具调用恢复成真实调用（代码块里的、正文中间的一律不算）'),
  suggestions: Schema.boolean().default(true),
  suggestModel: Schema.string().default(''),
  suggestTimeoutMs: Schema.natural().default(20_000),
  suggestSubagent: Schema.boolean().default(true)
    .description('点下一步卡片时交给子会话（subagent 工具）去做，而不是在当前会话里直接动手；卡片上会写明'),
  reportCue: Schema.boolean().default(true),
  cueUserId: Schema.string().default(''),
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

  /**
   * The live model catalog. Trae retires models without warning — one that is
   * gone upstream answers every turn with `4023 the model is unknown` — so the
   * list is asked for rather than shipped: `batch_get_detail_param` first (the
   * call traecli makes), then traecli's own cache file, then the built-in
   * table. Refreshed once per plugin start, again whenever the PAT changes,
   * and on demand through the catalog route's `?refresh`; until upstream has
   * answered, a fallback is asked again after a cooldown (see TraeCatalog).
   */
  const catalog = new TraeCatalog({
    mode: config.catalogSource,
    cacheFile: config.modelsCacheFile || MODELS_CACHE_FILE,
    functions: config.catalogFunctions.length > 0 ? config.catalogFunctions : [CHAT_FUNCTION],
    ...config.catalogSource === 'builtin' ? {} : {
      fetchUpstream: async (signal, payload) => {
        const body = JSON.stringify(payload)
        let session = await auth.get()
        for (let attempt = 0; ; attempt++) {
          const res = await fetch(`${host}${CATALOG_PATH}`, {
            method: 'POST',
            headers: traeHeaders(identity, session.token, 'application/json'),
            body,
            signal,
          })
          if ((res.status === 401 || res.status === 403) && attempt === 0) {
            await res.body?.cancel()
            session = await auth.get(true)
            continue
          }
          if (!res.ok) throw new Error(`HTTP ${res.status}：${(await res.text()).slice(0, 200)}`)
          return await res.json()
        }
      },
    },
    logger,
  })

  // The account as the IDE login sees it: user id for reports, privacy gate.
  const userInfo = new TraeUserInfo({ host: config.consoleHost, auth, userAgent })
  // On by default, like the IDE's own reporting. The user id comes from
  // GetUserInfo (the JWT does not carry it); a configured one only overrides
  // the id, never the account's privacy mode.
  const cueUserId = (config.cueUserId || process.env[CUE_USER_ID_ENV] || '').trim()
  const cue = config.suggestions && config.reportCue
    ? new TraeCueReporter({
      host, auth, appId: identity.appId, ideVersion: identity.ideVersion,
      ideVersionCode: identity.ideVersionCode, userAgent,
      user: async () => {
        const user = await userInfo.get()
        return cueUserId ? { ...user, userId: cueUserId } : user
      },
    })
    : undefined

  // Next-input suggestions ride on the adapter: it reports finished turns and
  // runs the side completion. `adapter` is assigned right below.
  const suggestions = config.suggestions
    ? new TraeSuggestions({
      complete: (model, system, user, signal) => adapter.complete(model, system, user, signal),
      model: config.suggestModel,
      timeoutMs: config.suggestTimeoutMs,
      subagent: config.suggestSubagent,
      ...cue ? { report: (events) => cue.report(events) } : {},
      logger,
    })
    : undefined

  const adapter: TraeAdapter = new TraeAdapter({
    displayName: config.displayName,
    host,
    identity,
    auth,
    catalog,
    readTimeoutMs: config.readTimeoutMs,
    emptyRetries: config.emptyRetries,
    loopGuardChars: config.loopGuardChars,
    contextBudgetTokens: config.contextBudgetTokens,
    recoverTextToolCalls: config.recoverTextToolCalls,
    // The attachment store that turns durable image references into request
    // bytes; `ctx.get` throws when absent, so guard with optional chaining on
    // the injected context (Desktop and Web both mount it; CLI-only setups
    // degrade images to placeholder text instead).
    resolveAttachments: () => {
      try { return anyCtx.get('attachments') as import('./adapter.ts').AttachmentStoreLike | undefined } catch { return undefined }
    },
    ...suggestions
      ? {
        onTurnStart: (sessionId: string) => { suggestions.turnStarted(sessionId) },
        onTurnEnd: turn => { suggestions.turnEnded(turn) },
      }
      : {},
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
    if (ref === config.patEnv.get()) { auth.reset(); quota.reset(); userInfo.reset(); catalog.reset() }
    // The console password is its own credential; a new one invalidates the
    // cached console session, not the JWT.
    if (ref === config.consolePasswordEnv.get() || ref === config.consoleEmailEnv.get()) { tob.reset(); quota.reset() }
  }) as never)
  ctx.on('loader/volatile-update' as never, (() => { auth.reset(); quota.reset(); userInfo.reset(); catalog.reset() }) as never)

  // One catalog refresh per plugin start, without waiting for the first turn:
  // reloading the plugin is how a user asks for a fresh model list. A failure
  // is already logged by the store, which keeps serving the previous answer
  // and asks upstream again later — this early, the host's credential store
  // may not be up yet, and the PAT then reads as missing.
  void catalog.ready().catch(() => { /* logged in the store */ })

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
    // The model list as this plugin currently sees it, with where it came from
    // and when. `?refresh` re-asks Trae instead of answering from the snapshot
    // taken at startup — the manual half of "reload the plugin to reload the
    // models".
    try {
      child.connection.fetch.register({
        path: CATALOG_ROUTE,
        methods: ['GET'],
        requestBody: 'buffered',
        fetch: async (request) => {
          const force = new URL(request.url).searchParams.has('refresh')
          try {
            const snapshot = force ? await catalog.refresh(true) : await catalog.ready()
            return Response.json({
              ok: true,
              value: {
                origin: snapshot.origin,
                at: snapshot.at,
                ...snapshot.note ? { note: snapshot.note } : {},
                models: snapshot.routes.map(r => ({
                  id: r.id, key: r.key, contextWindow: r.contextWindow,
                  maxMode: r.maxMode, multimodal: r.multimodal, efforts: r.efforts,
                })),
              },
            })
          } catch (error) {
            return Response.json({ ok: false, error: error instanceof Error ? error.message : String(error) })
          }
        },
      })
    } catch (error) { logger.warn('dsh-trae2api: catalog route unavailable', error) }
    // `?session=<id>`: that harness session's id as the plugin sees it, plus
    // the upstream conversation its last Trae turn ran in and the variant it
    // ran on. For the composer's session-id chip and for bug reports — an
    // upstream complaint is answerable only with the conversation id, which is
    // derived per model variant and level rather than equal to the harness id
    // (wire.ts `conversationUuid`). `conversation: null` = no turn yet.
    //
    // `debug` is the same facts as the one line Trae's own client copies for
    // support (src/trae/debug.ts), so a ticket can be opened in the format
    // that side already reads.
    try {
      child.connection.fetch.register({
        path: SESSION_ROUTE,
        methods: ['GET'],
        requestBody: 'buffered',
        fetch: async (request) => {
          const sessionId = new URL(request.url).searchParams.get('session') ?? ''
          if (!sessionId) return Response.json({ ok: false, error: 'expected ?session=<id>' }, { status: 400 })
          const turn = adapter.sessionInfo(sessionId)
          // The account id only matters for the diagnostic line, and reading it
          // must never cost the answer: GetUserInfo is asked once per JWT and
          // its failure leaves the line's `no_uid` in place.
          let userId = ''
          if (turn) {
            try { userId = (await userInfo.get()).userId } catch { /* no_uid */ }
          }
          return Response.json({
            ok: true,
            value: {
              session: sessionId,
              conversation: turn?.conversation ?? null,
              model: turn?.model ?? null,
              effort: turn?.effort ?? null,
              trace: turn?.trace ?? null,
              at: turn?.at ?? null,
              // One line in Trae's own support format (see src/trae/debug.ts),
              // for pasting into a Trae ticket. Only once a turn has run:
              // before that there is no conversation, no trace and no time.
              debug: turn
                ? traeDebugLine({
                  userId,
                  ...turn.trace ? { traceId: turn.trace } : {},
                  sessionId: turn.conversation,
                  appName: identity.originator,
                  appVersion: identity.clientVersion,
                  at: turn.at,
                })
                : null,
            },
          })
        },
      })
    } catch (error) { logger.warn('dsh-trae2api: session route unavailable', error) }
    // `?session=<id>&wait=<ms>`: the session's next-step choices, waiting for
    // ones still in flight. `{ ok: true, value: null }` = nothing to suggest.
    try {
      child.connection.fetch.register({
        path: SUGGESTION_ROUTE,
        methods: ['GET'],
        requestBody: 'buffered',
        fetch: async (request) => {
          const params = new URL(request.url).searchParams
          const sessionId = params.get('session') ?? ''
          const wait = Math.min(SUGGESTION_MAX_WAIT_MS, Math.max(0, Number(params.get('wait')) || 0))
          const value = suggestions && sessionId ? await suggestions.get(sessionId, wait) : null
          return Response.json({ ok: true, value })
        },
      })
    } catch (error) { logger.warn('dsh-trae2api: suggestion route unavailable', error) }
    // `{ session, id, action: 'shown' | 'accept', card?, choice? }`: the
    // composer showed a suggestion's cards, or the user pressed button
    // `choice` on card `card` (both required for accept). The store decides
    // whether it counts (once each, current suggestion only) and whether it is
    // reported at all.
    try {
      child.connection.fetch.register({
        path: SUGGESTION_EVENT_ROUTE,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request) => {
          let input: { session?: unknown; id?: unknown; action?: unknown; card?: unknown; choice?: unknown }
          try { input = await request.json() as typeof input } catch { return Response.json({ ok: false, error: 'invalid JSON' }, { status: 400 }) }
          const { session, id, action, card, choice } = input
          const index = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0
          if (
            typeof session !== 'string' || typeof id !== 'string' || (action !== 'shown' && action !== 'accept')
            || (action === 'accept' && !(index(card) && index(choice)))
          ) {
            return Response.json({ ok: false, error: 'expected { session, id, action: "shown" | "accept", card, choice }' }, { status: 400 })
          }
          const pick = index(card) && index(choice) ? { card, choice } : undefined
          const reported = suggestions ? await suggestions.record(session, id, action, pick) : false
          return Response.json({ ok: true, reported })
        },
      })
    } catch (error) { logger.warn('dsh-trae2api: suggestion event route unavailable', error) }
  })

  // Released automatically on unload.
  ctx.llm.registerAdapter([config.provider], adapter)
  // Gives the Models settings page a "Trae" row, with our card inside it.
  ctx.llm.registerConfigurableProviders([
    { provider: config.provider, displayName: config.displayName, settingsNs, settingsPath: [] },
  ])
}
