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
import { isCnHost, traeAppName, traeDebugLine, TRAE_APP_VERSION } from './trae/debug.ts'
import { TraeUserInfo } from './trae/user.ts'
import { TraeQuota } from './trae/quota.ts'
import { mirrorAndShare } from './trae/mirror.ts'
import { TranscriptStore, transcriptMessage, transcriptOf, userTurns } from './trae/transcript.ts'
import { conversationTurns, localShareBody, objectId, type ConversationTurn } from './trae/local-share.ts'
import { ArtifactError, artifactKind, packArtifact } from './trae/artifact.ts'
import { stat } from 'node:fs/promises'
import { isAbsolute, normalize } from 'node:path'
import { artifactUrl, latestTurns, SHARE_API_ORIGIN, ShareError, shareOriginFor, shareUrl, TraeShare } from './trae/share.ts'
import { TraeSuggestions } from './trae/suggest.ts'
import { TOB_CONSOLE_HOST, TobConsole } from './trae/tob.ts'

export const name = 'dsh-trae2api'
export const inject = ['llm']

const CLIENT_VERSION = '0.206.1-tob'
/**
 * Default origin the share API is spoken on: `trae-api-cn.mchost.guru`, the
 * write host TRAE SOLO CN's own bootConfig names (`remote.trae.normal`, report
 * v2). Same consumer namespace as work.trae.cn; links are still built on
 * `share.traecontent.cn` (`shareOriginFor`).
 */
const SHARE_HOST = SHARE_API_ORIGIN
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
/**
 * Host route the browser half reads / mints a share link through.
 *
 * `GET  ?id=<share_session_id>`        → that share (no PAT needed: the share API
 *                                        is anonymous for readers, which is why a
 *                                        leaked link is a full disclosure).
 * `POST {chatSessionId, turnIds[]…}`   → mint one; answers the front-end URL.
 * `POST {action:'disable', id}`        → unpublish.
 * `GET  ?sessions=1`                   → the account's real chat sessions, the
 *                                        only source of a `chat_session_id`.
 * `GET  ?transcript=<dsh session id>`  → what "share this session" would send:
 *                                        row and question counts, no text.
 * `POST {session, mode}`               → share the dsh session on screen via the
 *                                        mirror, on the consumer site.
 */
export const SHARE_ROUTE = '/api/dsh-trae2api/share'
/** Environment fallback for `cueUserId`. */
const CUE_USER_ID_ENV = 'TRAE_USER_ID'

export interface Config {
  provider: string
  displayName: string
  /** Credential reference holding the Trae PAT (set from the UI). */
  patEnv: Volatile<string>
  host: string
  /**
   * Origin the share API is spoken on. Empty = `work.trae.cn`, the origin the
   * Trae front end falls back to (`resolveCnOrigin()`); `share.traecontent.cn`
   * serves the same routes. The link itself is always built on
   * `share.traecontent.cn`.
   *
   * This is not just a deployment detail — it picks what the link *is*. The two
   * deployments keep **separate share namespaces**, measured both ways:
   *
   *   minted on work.trae.cn          → share.traecontent.cn 200, enterprise 404 992700
   *   minted on api.enterprise.trae.cn → enterprise 200,       share.traecontent.cn 404 992700
   *
   * and only the consumer site's page opens without a login: the enterprise
   * console renders a sign-in form for `/share/<id>` even though its data API
   * answers anonymously. So a link meant for someone outside the tenant has to
   * be minted here.
   *
   * An enterprise PAT writes a consumer session without complaint (measured:
   * createSession + sendMessage + createShare all 200 on work.trae.cn). Which
   * seat pays for those turns is not something this API states, so minting
   * across deployments is the user's call, not a silent default.
   */
  shareHost: string
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
  /**
   * Offer next-step choices above the composer after each answer (yes sends
   * one). Volatile: the settings card switches it, and the next turn follows
   * without a restart. Off = no side completion runs at all, so a turn costs
   * nothing extra and the composer gets nothing to show.
   */
  suggestions: Volatile<boolean>
  /** Model asked for suggestions; empty = the model that answered. */
  suggestModel: string
  suggestTimeoutMs: number
  /**
   * A pressed card hands its task to a subagent instead of this session: the
   * composer sends the reply wrapped in that instruction and says so on the
   * cards. Needs a delegation tool in the harness (`@deepseek-ai/dsh-subagent`
   * plus `dsh-tool-subagent`); without one the model just does it itself.
   * Volatile: the settings card switches it, and the next round of cards
   * follows without a restart.
   */
  suggestSubagent: Volatile<boolean>
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
  shareHost: Schema.string().default(SHARE_HOST)
    .description('分享接口所在的站点；空 = trae-api-cn.mchost.guru（TRAE SOLO CN 客户端的写接口，链接拼在 share.traecontent.cn 上）。企业版与消费版是两个独立的分享命名空间，互不可见'),
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
  suggestions: Schema.boolean().default(true).volatile()
    .description('每轮回答后在输入框上方给出下一步卡片；关掉就一张也不生成，也不会多花那次侧边请求'),
  suggestModel: Schema.string().default(''),
  suggestTimeoutMs: Schema.natural().default(20_000),
  suggestSubagent: Schema.boolean().default(true).volatile()
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
  // Only suggestions produce Cue events, so the reporter follows `reportCue`
  // alone: with the cards switched off nothing is ever recorded to report.
  const cue = config.reportCue
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
  // runs the side completion. `adapter` is assigned right below. Built either
  // way and gated by `enabled`, so the switch works without a restart.
  const transcripts = new TranscriptStore()
  /** Files shared as pages in this run: `${session}\u0000${path}` -> the link. */
  const artifactShares = new Map<string, { url: string; shareSessionId: string; at: number }>()
  /**
   * Markdown / HTML files a session's tools wrote or presented, newest
   * mention last: `write` / `edit` carry `file_path`, `present` a `files[]`
   * list of `{ path }`. Only absolute paths count — that is how dsh's tools
   * name files — and only the kinds `packArtifact` can share.
   */
  const producedFiles = (turns: readonly ConversationTurn[]): string[] => {
    const found: string[] = []
    const consider = (value: unknown): void => {
      if (typeof value !== 'string' || !isAbsolute(value) || !artifactKind(value)) return
      const path = normalize(value)
      const at = found.indexOf(path)
      if (at >= 0) found.splice(at, 1)
      found.push(path)
    }
    for (const turn of turns) {
      for (const step of turn.steps) {
        const args = step.tool?.args
        if (!args) continue
        for (const key of ['file_path', 'path', 'filePath', 'target_file']) consider(args[key])
        if (Array.isArray(args.files)) {
          for (const file of args.files) consider(typeof file === 'string' ? file : (file as { path?: unknown })?.path)
        }
      }
    }
    return found
  }
  const suggestions = new TraeSuggestions({
    complete: (model, system, user, signal) => adapter.complete(model, system, user, signal),
    model: config.suggestModel,
    timeoutMs: config.suggestTimeoutMs,
    enabled: () => config.suggestions.get(),
    subagent: () => config.suggestSubagent.get(),
    ...cue ? { report: (events) => cue.report(events) } : {},
    logger,
  })

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
    onTurnStart: (sessionId: string) => { suggestions.turnStarted(sessionId) },
    onTurnEnd: (turn) => {
      // What "share this session" mirrors: the plugin cannot read the
      // harness's own transcript, so it keeps the one each finished turn
      // shows it.
      try {
        transcripts.set(
          turn.sessionId,
          transcriptOf(turn.options.messages as never, turn.answer),
          conversationTurns(turn.options.messages as never, turn.answer, {
            ...turn.reasoning ? { reasoning: turn.reasoning } : {},
            model: turn.model,
          }),
        )
      } catch { /* never fail a turn */ }
      suggestions.turnEnded(turn)
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

  /**
   * Share links. Reads run against `shareHost` and need no PAT at all; minting
   * needs the same JWT the turns use, but is aimed at the same origin, because
   * a share id only exists inside the deployment that minted it (see
   * `shareHost` on Config).
   */
  const share = new TraeShare({
    host: (config.shareHost.trim() || SHARE_HOST).replace(/\/+$/, ''),
    auth,
    userAgent,
    logger,
  })
  /**
   * The same API on the model host (the enterprise deployment). The PAT's JWT
   * belongs to an enterprise seat, whose chat sessions may well live there and
   * not on the consumer site; the session list asks both, the consumer one
   * first, and a mint goes to whichever host the picked session came from.
   */
  const shareClients = new Map<string, TraeShare>([[share.host, share]])
  if (!shareClients.has(host)) {
    shareClients.set(host, new TraeShare({ host, auth, userAgent, logger }))
  }

  /**
   * The share byline. The client sends `currentUser.username.trim()` (report
   * v2 shows a real name there); this plugin has no `currentUser`, so it asks
   * GetUserInfo and the JWT's claims, in that order. Best effort: a missing
   * name leaves the byline blank and never costs the link. When neither has
   * one, the key names (not values) both offered are logged once, so the
   * right field can be pinned down.
   */
  let bylineMissLogged = false
  const creatorNameFor = async (input: { creatorName?: unknown; anonymous?: unknown }): Promise<string> => {
    if (typeof input.creatorName === 'string' && input.creatorName.trim()) return input.creatorName.trim()
    if (input.anonymous === true) return ''
    let user: Awaited<ReturnType<typeof userInfo.get>> | undefined
    try { user = await userInfo.get() } catch { /* fall through to the JWT */ }
    if (user?.username) return user.username
    let session: Awaited<ReturnType<typeof auth.get>> | undefined
    try { session = await auth.get() } catch { /* blank byline */ }
    if (session?.name) return session.name
    if (!bylineMissLogged) {
      bylineMissLogged = true
      logger.info(`dsh-trae2api: share byline has no name; GetUserInfo UserInfo keys [${(user?.infoKeys ?? []).join(', ')}], JWT data keys [${(session?.claimKeys ?? []).join(', ')}]`)
    }
    return ''
  }

  // A PAT saved from the UI changes no config field; drop the cached JWT.
  ctx.on('credentials/reference-updated' as never, ((ref: string) => {
    if (ref === config.patEnv.get()) { auth.reset(); quota.reset(); userInfo.reset(); catalog.reset(); for (const c of shareClients.values()) c.reset() }
    // The console password is its own credential; a new one invalidates the
    // cached console session, not the JWT.
    if (ref === config.consolePasswordEnv.get() || ref === config.consoleEmailEnv.get()) { tob.reset(); quota.reset() }
  }) as never)
  ctx.on('loader/volatile-update' as never, (() => { auth.reset(); quota.reset(); userInfo.reset(); catalog.reset(); for (const c of shareClients.values()) c.reset() }) as never)

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
                  // The client's own naming rule and the TRAE SOLO version the
                  // format was read from, so support reads a line in the shape
                  // it knows; `traceId` is what ties it to the real request.
                  appName: traeAppName(isCnHost(host)),
                  appVersion: TRAE_APP_VERSION,
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
          // `null` as well while the cards are switched off (see `enabled`).
          const value = sessionId ? await suggestions.get(sessionId, wait) : null
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
          const reported = await suggestions.record(session, id, action, pick)
          return Response.json({ ok: true, reported })
        },
      })
    } catch (error) { logger.warn('dsh-trae2api: suggestion event route unavailable', error) }
    // Share links: read one (anonymous), mint one (PAT), unpublish one (PAT),
    // or list the account's real chat sessions so the card can offer the ids
    // `createShare` actually takes.
    try {
      child.connection.fetch.register({
        path: SHARE_ROUTE,
        methods: ['GET', 'POST'],
        requestBody: 'buffered',
        fetch: async (request) => {
          const url = new URL(request.url)
          try {
            if (request.method === 'GET') {
              // `?sessions=1`: the account's own sessions, with the ids a mint
              // needs. Anything else: one share by id, read anonymously.
              if (url.searchParams.has('sessions')) {
                const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get('page_size')) || 20))
                // Ask each host in turn and stop at the first with sessions.
                // What every host answered goes back too (and to the log), so
                // an empty list says where it looked and what came back
                // instead of a bare "no sessions".
                const probes: { host: string; count?: number; keys?: string[]; error?: string; code?: number }[] = []
                const found: { host: string; session: Record<string, unknown> }[] = []
                for (const client of shareClients.values()) {
                  try {
                    const answer = await client.sessions(pageSize)
                    probes.push({ host: answer.host, count: answer.items.length, keys: answer.keys })
                    for (const session of answer.items) found.push({ host: answer.host, session })
                    if (answer.items.length) break
                  } catch (error) {
                    probes.push({
                      host: client.host,
                      error: error instanceof Error ? error.message : String(error),
                      ...error instanceof ShareError ? { code: error.code } : {},
                    })
                  }
                }
                for (const { host: from, session } of found.slice(0, 10)) {
                  logger.info(`dsh-trae2api: share session on ${from}: ${JSON.stringify(Object.fromEntries(
                    Object.entries(session).filter(([, v]) => typeof v !== 'object' || v === null).map(([k, v]) => [k, typeof v === 'string' ? v.slice(0, 60) : v]),
                  ))}`)
                }
                logger.info(`dsh-trae2api: share sessions ${probes.map(p => p.error
                  ? `${p.host} error ${p.code ?? ''} ${p.error}`
                  : `${p.host} ${p.count} item(s), data keys [${(p.keys ?? []).join(', ')}]`).join('; ')}`)
                if (found.length === 0 && probes.every(p => p.error)) {
                  return Response.json({ ok: false, error: probes.map(p => `${p.host}: ${p.error}`).join('；'), probes }, { status: 502 })
                }
                const str = (s: Record<string, unknown>, ...keys: string[]): string | undefined => {
                  for (const key of keys) if (typeof s[key] === 'string' && s[key]) return s[key] as string
                  return undefined
                }
                return Response.json({
                  ok: true,
                  value: found.map(({ host: from, session: s }) => ({
                    chatSessionId: str(s, 'chat_session_id', 'chatSessionId', 'session_id', 'sessionId', 'id') ?? '',
                    name: str(s, 'name', 'title', 'session_name', 'sessionName'),
                    status: str(s, 'status'),
                    mode: str(s, 'mode'),
                    updatedAt: s.updated_at ?? s.updatedAt ?? undefined,
                    host: from,
                  })).filter(s => s.chatSessionId),
                  probes,
                })
              }
              // `?mine=1`: the shares this account minted, on every host this
              // plugin speaks to, with the link each one opens at.
              if (url.searchParams.has('mine')) {
                const probes: { host: string; count?: number; keys?: string[]; error?: string }[] = []
                const items: Record<string, unknown>[] = []
                for (const client of shareClients.values()) {
                  try {
                    const answer = await client.list()
                    probes.push({ host: answer.host, count: answer.items.length, keys: answer.keys })
                    for (const item of answer.items) {
                      items.push({
                        shareSessionId: item.shareSessionId,
                        // A page share opens at /artifact/<id>; a conversation at /share/<id>.
                        url: item.shareType === 'artifact'
                          ? artifactUrl(item.shareSessionId, shareOriginFor(answer.host))
                          : shareUrl(item.shareSessionId, shareOriginFor(answer.host)),
                        title: item.title,
                        status: item.status,
                        shareType: item.shareType,
                        createdAt: item.createdAt,
                        expiresAt: item.expiresAt,
                        host: answer.host,
                      })
                    }
                  } catch (error) {
                    probes.push({ host: client.host, error: error instanceof Error ? error.message : String(error) })
                  }
                }
                logger.info(`dsh-trae2api: my shares ${probes.map(p => p.error ? `${p.host} error ${p.error}` : `${p.host} ${p.count} item(s), data keys [${(p.keys ?? []).join(', ')}]`).join('; ')}`)
                if (items.length === 0 && probes.every(p => p.error)) {
                  return Response.json({ ok: false, error: probes.map(p => `${p.host}: ${p.error}`).join('；'), probes }, { status: 502 })
                }
                return Response.json({ ok: true, value: items, probes })
              }
              // `?files=<session>`: Markdown / HTML files that session produced,
              // still on disk, newest first — what "share a file" offers.
              if (url.searchParams.has('files')) {
                const session = url.searchParams.get('files') ?? ''
                const kept = transcripts.get(session)
                const paths = kept ? producedFiles(kept.turns) : []
                const files: Record<string, unknown>[] = []
                for (const path of paths) {
                  try {
                    const info = await stat(path)
                    if (!info.isFile()) continue
                    const shared = artifactShares.get(`${session}\u0000${path}`)
                    files.push({
                      path,
                      kind: artifactKind(path),
                      size: info.size,
                      modifiedAt: info.mtimeMs,
                      ...shared ? { shared } : {},
                    })
                  } catch { /* gone since */ }
                }
                files.sort((a, b) => Number(b.modifiedAt) - Number(a.modifiedAt))
                return Response.json({ ok: true, value: files.slice(0, 30) })
              }
              // `?transcript=<session>`: the size of what sharing this session
              // would send, so the card can state the cost before the click.
              if (url.searchParams.has('transcript')) {
                const kept = transcripts.get(url.searchParams.get('transcript') ?? '')
                return Response.json({
                  ok: true,
                  value: kept
                    ? {
                      rows: kept.rows.length,
                      questions: userTurns(kept.rows),
                      turns: kept.turns.length,
                      steps: kept.turns.reduce((n, turn) => n + turn.steps.length, 0),
                      at: kept.at,
                    }
                    : null,
                })
              }
              const id = url.searchParams.get('id') ?? ''
              if (!id) return Response.json({ ok: false, error: 'expected ?id=<share_session_id> or ?sessions=1' }, { status: 400 })
              const session = await share.get(id, { force: url.searchParams.has('refresh') })
              // The page URL follows BOTH the type and the namespace: a
              // conversation lives at /share/, an HTML artifact at /artifact/,
              // and the origin is whichever front end serves the API host that
              // answered — an enterprise id opens on the console site, not on
              // the consumer one (shareOriginFor).
              const pageOrigin = shareOriginFor(session.host ?? share.host)
              const pageUrl = session.shareType === 'artifact' && session.artifactPath
                ? artifactUrl(id, pageOrigin)
                : shareUrl(id, pageOrigin)
              return Response.json({
                ok: true,
                value: {
                  shareSessionId: session.shareSessionId,
                  url: pageUrl,
                  title: session.title,
                  status: session.status,
                  shareType: session.shareType,
                  artifactPath: session.artifactPath,
                  creatorName: session.creatorName,
                  anonymous: session.anonymous,
                  createdAt: session.createdAt,
                  expiresAt: session.expiresAt,
                  // Pre-signed TOS links. The CDN refuses them without
                  // `Referer: https://share.traecontent.cn/`, so the card must
                  // not hand them to a plain <a download>.
                  entries: session.entries,
                },
              })
            }
            let input: {
              action?: unknown; id?: unknown; host?: unknown; session?: unknown; path?: unknown
              chatSessionId?: unknown; turnIds?: unknown
              anonymous?: unknown; creatorName?: unknown; skipAudit?: unknown
              turns?: unknown; maxTurns?: unknown; mode?: unknown
            }
            try { input = await request.json() as typeof input } catch {
              return Response.json({ ok: false, error: 'invalid JSON' }, { status: 400 })
            }
            let action = typeof input.action === 'string' ? input.action : 'create'
            // The host the picked session was listed on; only a host this
            // plugin already speaks to is accepted, never one from the body.
            let writer = (typeof input.host === 'string' && shareClients.get(input.host.replace(/\/+$/, ''))) || share
            // `{ action: 'artifact', path, session? }`: a Markdown / HTML file as a
            // page link (artifact.ts). Keyed by the session and the file, so
            // sharing the same file again updates the page behind the same link.
            if (action === 'artifact') {
              if (typeof input.path !== 'string' || !input.path.trim()) {
                return Response.json({ ok: false, error: 'expected { action:"artifact", path }' }, { status: 400 })
              }
              const session = typeof input.session === 'string' && input.session ? input.session : 'files'
              let pack
              try { pack = await packArtifact(input.path.trim()) } catch (error) {
                if (error instanceof ArtifactError) return Response.json({ ok: false, error: error.message }, { status: 400 })
                throw error
              }
              const link = await share.shareArtifact({
                localSessionId: objectId(`dsh:${session}`),
                artifactPath: pack.artifactPath,
                zip: pack.zip,
                contentHash: pack.contentHash,
              })
              artifactShares.set(`${session}\u0000${pack.source}`, { url: link.url, shareSessionId: link.shareSessionId, at: Date.now() })
              logger.info(`dsh-trae2api: shared ${pack.kind} ${pack.source} as ${link.shareSessionId} (${pack.files.length} file(s), ${pack.zip.byteLength} bytes)`)
              return Response.json({
                ok: true,
                value: {
                  url: link.url,
                  link,
                  title: link.title,
                  kind: pack.kind,
                  source: pack.source,
                  artifactPath: pack.artifactPath,
                  files: pack.files.length,
                  bytes: pack.zip.byteLength,
                  host: share.host,
                },
              })
            }
            // Lifecycle (report v2 §3.2): `disable` closes a link (anonymous
            // reads become 403 992701), `enable` reopens it, `delete` revokes it
            // for good (410 992702). Only the account that minted it may.
            if (action === 'disable' || action === 'enable' || action === 'delete') {
              if (typeof input.id !== 'string' || !input.id) {
                return Response.json({ ok: false, error: `expected { action:"${action}", id }` }, { status: 400 })
              }
              const value = action === 'delete'
                ? await writer.remove(input.id)
                : await writer.setStatus(input.id, action === 'enable' ? 'active' : 'disabled')
              logger.info(`dsh-trae2api: share ${input.id} on ${writer.host}: ${action}`)
              return Response.json({ ok: true, value })
            }
            // `{ action: 'mirror', turns: [{role, text}], maxTurns }`: replay a
            // conversation into the chat service and mint a link from it.
            //
            // This is the only route that makes the link the user actually
            // wants: llm_raw_chat leaves no chat-service ids behind, so sharing
            // a dsh session means building an equivalent one upstream first.
            //
            // It costs a model call per user turn and says so rather than
            // hiding it: `maxTurns` has no default, so the caller must decide
            // how much to spend before a single turn is sent.
            // `{ session: <dsh session id>, mode }`: share the session on screen.
            //
            // Measured: the chat service has never heard of a dsh session —
            // its upstream conversation id answers 991200 "chat session not
            // found", because llm_raw_chat leaves nothing behind. So the
            // session is always shared through the mirror, on the consumer
            // site (work.trae.cn -> share.traecontent.cn, no login wall), from
            // the transcript the plugin kept of its last finished Trae turn:
            //
            //  - `mode: 'transcript'` (default): the whole transcript as one
            //    message. One model call, and the page shows what was really
            //    said, answers included.
            //  - `mode: 'replay'`: each question sent again, one model call
            //    each; the answers on the page are Trae's new ones, not the
            //    session's own. `maxTurns` is required, as for any mirror.
            //
            // `turns` in the body still overrides the kept transcript.
            if (typeof input.session === 'string' && input.session && input.chatSessionId === undefined) {
              const kept = transcripts.get(input.session)
              const rows = Array.isArray(input.turns) && input.turns.length > 0
                ? input.turns as { role: 'user' | 'assistant'; text: string }[]
                : kept?.rows
              if (!rows || rows.length === 0) {
                return Response.json({
                  ok: false,
                  code: 'NO_TRANSCRIPT',
                  error: '插件还没看到这条会话的对话内容：要在插件启动后用 Trae 模型跑完一轮，才能分享。发一轮再点。',
                }, { status: 400 })
              }
              // Default: the session as a Trae local conversation — every turn
              // its own bubbles, each answer with its steps, no model call
              // (local-share.ts). `transcript` / `replay` go through the mirror.
              // Turns in the body are a conversation to replay (the mirror box);
              // without them the kept session is shared as it happened.
              const mode = input.mode === 'replay' || input.mode === 'transcript' || input.mode === 'local'
                ? input.mode
                : Array.isArray(input.turns) && input.turns.length > 0 ? 'replay' : 'local'
              if (mode === 'local') {
                if (!kept || kept.turns.length === 0) {
                  return Response.json({ ok: false, code: 'NO_TRANSCRIPT', error: '插件还没看到这条会话的对话内容：要在插件启动后用 Trae 模型跑完一轮，才能分享。发一轮再点。' }, { status: 400 })
                }
                const creatorName = await creatorNameFor(input)
                const built = localShareBody(kept.turns, {
                  sessionId: input.session,
                  creatorName,
                  anonymous: input.anonymous === true,
                  turnTimes: kept.times,
                  updatedAt: kept.at,
                })
                const bytes = Buffer.byteLength(JSON.stringify(built.body))
                try {
                  const link = await share.createLocal(built.body)
                  logger.info(`dsh-trae2api: share current session ${input.session} as local conversation on ${share.host} (${bytes} bytes): ${built.turns} turn(s)${built.dropped ? `, ${built.dropped} older dropped` : ''} -> ${link.shareSessionId} (${link.status ?? '?'})`)
                  return Response.json({
                    ok: true,
                    value: {
                      url: link.url, link, title: link.title,
                      turns: built.turns, dropped: built.dropped, modelCalls: 0, host: share.host,
                    },
                  })
                } catch (error) {
                  logger.info(`dsh-trae2api: share current session ${input.session} as local conversation refused (${bytes} bytes): ${error instanceof Error ? error.message : String(error)}`)
                  throw error
                }
              }
              if (mode === 'transcript') {
                const message = transcriptMessage(rows)
                input.turns = [{ role: 'user', text: message.text }]
                input.maxTurns = 1
              } else {
                input.turns = rows
              }
              // The consumer site, whatever the body says: it is the one whose
              // share page opens without a login.
              input.host = share.host
              action = 'mirror'
              logger.info(`dsh-trae2api: share current session ${input.session} via mirror (${mode}, ${rows.length} row(s), ${userTurns(rows)} question(s))`)
            }
            if (action === 'mirror') {
              if (!Array.isArray(input.turns)) {
                return Response.json({ ok: false, error: 'expected { action:"mirror", turns: [{ role, text }], maxTurns }' }, { status: 400 })
              }
              const turns: { role: 'user' | 'assistant'; text: string }[] = []
              for (const entry of input.turns) {
                if (typeof entry !== 'object' || entry === null) continue
                const row = entry as Record<string, unknown>
                const role = row.role
                const text = row.text
                if ((role !== 'user' && role !== 'assistant') || typeof text !== 'string' || !text) continue
                turns.push({ role, text })
              }
              if (turns.filter(t => t.role === 'user').length === 0) {
                return Response.json({ ok: false, error: 'turns 里没有 user 回合可镜像' }, { status: 400 })
              }
              // No default on purpose: each user turn is one real model call.
              const maxTurns = Number(input.maxTurns)
              if (!Number.isInteger(maxTurns) || maxTurns <= 0) {
                return Response.json({
                  ok: false,
                  error: 'expected maxTurns: a positive integer (each user turn is one model call)',
                  userTurns: turns.filter(t => t.role === 'user').length,
                }, { status: 400 })
              }
              // Mirrored conversations are only worth minting on the site the
              // link can actually be opened from — the consumer one, whose
              // /share/ page has no login wall. An explicit `host` from the
              // body is still honoured when this plugin already speaks it.
              const mirrorHost = (typeof input.host === 'string' && shareClients.get(input.host.replace(/\/+$/, ''))?.host)
                || share.host
              try {
                const byline = await creatorNameFor(input)
                const mirrored = await mirrorAndShare(turns, {
                  auth,
                  host: mirrorHost,
                  userAgent,
                  maxTurns,
                  ...byline ? { creatorName: byline } : {},
                  ...input.anonymous === true ? { anonymous: true } : {},
                  logger,
                })
                logger.info(
                  `dsh-trae2api: mirrored ${mirrored.modelCalls} turn(s) into ${mirrored.chatSessionId}`
                  + ` on ${mirrorHost} -> ${mirrored.link.shareSessionId}${mirrored.partial ? ' (partial)' : ''}`,
                )
                return Response.json({
                  ok: true,
                  value: {
                    chatSessionId: mirrored.chatSessionId,
                    // Prefer the URL the mirror built (it already resolves the
                    // origin from the host that minted it); `link` carries the
                    // rest of what a share is.
                    url: mirrored.url,
                    link: mirrored.link,
                    answers: mirrored.answers,
                    // True when a turn did not settle: the link still exists and
                    // covers the turns that did, which is why this is a value
                    // and not an error.
                    partial: mirrored.partial,
                    modelCalls: mirrored.modelCalls,
                    host: mirrorHost,
                  },
                })
              } catch (error) {
                const code = error instanceof ShareError ? error.code : undefined
                return Response.json({
                  ok: false,
                  error: error instanceof Error ? error.message : String(error),
                  ...code !== undefined ? { code } : {},
                }, { status: error instanceof ShareError && error.status ? error.status : 502 })
              }
            }
            if (action !== 'create') {
              return Response.json({ ok: false, error: 'expected action: "create" | "disable" | "mirror"' }, { status: 400 })
            }
            if (typeof input.chatSessionId !== 'string' || !input.chatSessionId) {
              return Response.json({ ok: false, error: 'expected { chatSessionId } or { session } — see ?sessions=1 for the ids' }, { status: 400 })
            }
            const chatSessionId = input.chatSessionId
            const tag = `chat session ${chatSessionId}`
            // `turnIds` omitted = "select all": every turn the session has, cut
            // to the most recent 50 the front end allows in one share.
            let allTurns: string[] | undefined
            if (!Array.isArray(input.turnIds)) {
              try { allTurns = await writer.turnsOf(chatSessionId) } catch (error) {
                logger.info(`dsh-trae2api: share ${tag} on ${writer.host}: reading turns failed: ${error instanceof Error ? error.message : String(error)}`)
                // Measured 2026-11-06: the chat service answers an
                // llm_raw_chat conversation id with 991200 "chat session not
                // found" — it never saw this conversation, so there is
                // nothing it could share.
                throw error
              }
            }
            const turnIds = Array.isArray(input.turnIds)
              ? input.turnIds.filter((t): t is string => typeof t === 'string' && t !== '')
              : latestTurns(allTurns!)
            // The front end sends `currentUser.username.trim()`; an empty name
            // leaves the share page's byline blank. Best effort: a failed
            // GetUserInfo must not cost the link.
            const creatorName = await creatorNameFor(input)
            if (turnIds.length === 0) {
              logger.info(`dsh-trae2api: share ${tag} on ${writer.host}: no turns`)
              return Response.json({
                ok: false,
                error: '这条会话里没有可分享的轮次（没有带 turn_id 的回答）',
              }, { status: 400 })
            }
            let link
            try {
              link = await writer.create({
                chatSessionId,
                turnIds,
                anonymous: input.anonymous === true,
                creatorName,
                skipAudit: input.skipAudit === true,
              })
            } catch (error) {
              logger.info(`dsh-trae2api: share ${tag} on ${writer.host}: create failed: ${error instanceof Error ? error.message : String(error)}`)
              throw error
            }
            // Read the new link back the way a recipient would (anonymously,
            // on the consumer site). A share minted in the enterprise
            // namespace is not visible there, and saying so beats handing
            // out a link that opens to "not found".
            let reachable: boolean | undefined
            let readableOnWriter: boolean | undefined
            if (link.status === 'passed') {
              try { await share.get(link.shareSessionId, { force: true }); reachable = true } catch (error) {
                if (error instanceof ShareError && error.code === 992700) reachable = false
              }
              // Not on the consumer site: is it at least readable where it was
              // minted? That tells a namespace split from a share that is not
              // there at all.
              if (reachable === false && writer !== share) {
                try { await writer.get(link.shareSessionId, { force: true }); readableOnWriter = true } catch { readableOnWriter = false }
              }
            }
            logger.info(`dsh-trae2api: share ${tag} on ${writer.host}: minted ${link.shareSessionId} status ${link.status ?? '?'} turns ${turnIds.length} reachable ${reachable ?? '?'} readable-on-writer ${readableOnWriter ?? '?'}`)
            return Response.json({
              ok: true,
              value: {
                ...link,
                host: writer.host,
                turnCount: turnIds.length,
                ...allTurns ? { totalTurns: allTurns.length } : {},
                ...reachable !== undefined ? { reachable } : {},
                ...readableOnWriter !== undefined ? { readableOnWriter } : {},
              },
            })
          } catch (error) {
            const code = error instanceof ShareError ? error.code : undefined
            const status = error instanceof ShareError && error.status ? error.status : 502
            return Response.json({
              ok: false,
              error: error instanceof Error ? error.message : String(error),
              ...code !== undefined ? { code } : {},
            }, { status })
          }
        },
      })
    } catch (error) { logger.warn('dsh-trae2api: share route unavailable', error) }
  })

  // Released automatically on unload.
  ctx.llm.registerAdapter([config.provider], adapter)
  // Gives the Models settings page a "Trae" row, with our card inside it.
  ctx.llm.registerConfigurableProviders([
    { provider: config.provider, displayName: config.displayName, settingsNs, settingsPath: [] },
  ])
}
