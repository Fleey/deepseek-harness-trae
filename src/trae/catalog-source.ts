/**
 * Where the model catalog comes from at runtime.
 *
 * `catalog.ts` is a snapshot taken by hand, and a snapshot goes stale the way
 * it did on 2026-10-16: Trae retired four models, the plugin kept offering
 * them, and every turn on one died with `4023 the model is unknown`. traecli
 * does not hard-code anything — `models-manager` asks the backend and caches
 * the answer. This module does the same, in three steps, best first:
 *
 *  1. **upstream** — `POST /api/ide/v1/batch_get_detail_param`, the call
 *     traecli labels "Trae ToB batch model config". Its body is the one
 *     embedded in the traecli binary (the `TRAE_TOB_MODEL_CONFIG_*` env vars
 *     override each field there). The response is the live truth for every
 *     fact the picker needs: which models exist, both backend keys, both
 *     context windows, the output cap, whether Max is real, whether the model
 *     takes images, and the thinking ladder with its default rung.
 *  2. **cache** — `~/.trae/cli/models_cache.json`, what traecli last wrote. No
 *     network, but only as fresh as the last `traecli` run, and its
 *     `input_modalities` is a Codex-fork constant (`["text","image"]` for every
 *     model), so image support for a model the built-in table knows comes from
 *     there instead.
 *  3. **builtin** — `TRAE_MODELS`. Always available, possibly stale.
 *
 * A fallback is only ever a step down: a refresh that fails leaves the previous
 * snapshot in place rather than emptying the picker.
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import {
  indexRoutes,
  TRAE_MODELS,
  toRoutes,
  type TraeEffort,
  type TraeModel,
  type TraeRoute,
} from './catalog.ts'

/** The ToB catalog call: one POST, one function's model list. */
export const CATALOG_PATH = '/api/ide/v1/batch_get_detail_param'

/** The function traecli asks for, and the one the chat request names by default. */
export const CHAT_FUNCTION = 'chat'

/**
 * Functions that can be asked for besides `chat` — **off by default**, and
 * measured to be empty on the enterprise host.
 *
 * The endpoint answers per function, and a model's shelf is per (config,
 * function), so a catalog built from one function can hide whatever is only
 * shelved elsewhere. These four names are the conversational functions seen in
 * Trae's CN client. Probed on 2026-10-27 against `api.enterprise.trae.cn` with
 * a real ToB session (`tools/probe_catalog.py`): all four answer `HTTP 200`
 * with a group of their own name and **0 configs**, while `chat` carries 31
 * (25 visible). So on a ToB seat there is nothing to union in, and asking
 * costs one more POST per refresh — hence `['chat']`, exactly traecli's own
 * question, is the default.
 *
 * The union stays available for a host that does shelf per function: put any
 * of these in `catalogFunctions`. They are asked in a second request whose
 * failure is logged and skipped, and a model only they list is pinned to the
 * function that listed it (`wireFunction`), since the chat request has to name
 * the function upstream shelves it under.
 */
export const EXTRA_CATALOG_FUNCTIONS: readonly string[] = ['solo_work_remote', 'solo_work_lite', 'solo_coder', 'chat_v3']

/**
 * The body traecli sends, with `current_config_name` /
 * `current_config_is_custom_model` folded into the `current_config_info`
 * object its wire struct names. `access_type: 4` is the enterprise seat and
 * `mode_type: 0` the chat surface — the same pair the chat request carries.
 */
export function catalogBody(functions: readonly string[]): Record<string, unknown> {
  return {
    functions: [...functions],
    agent_type: 'chat',
    current_config_info: { config_name: '', is_custom_model: false },
    mode_type: 0,
    access_type: 4,
    ab_force_vids: '',
    ab_autotest_advanced_mode: 0,
    show_custom_model: true,
  }
}

/** The body as traecli itself sends it: the `chat` function alone. */
export const CATALOG_BODY: Record<string, unknown> = catalogBody([CHAT_FUNCTION])

/** Where traecli keeps its own copy. */
export const MODELS_CACHE_FILE = join(homedir(), '.trae', 'cli', 'models_cache.json')

/**
 * Config names that are not models: `summary` is the compaction config and
 * `custom_model_placeholder` is the row the IDE shows for "add your own".
 */
const NOT_MODELS = new Set(['summary', 'custom_model_placeholder'])

/**
 * The rungs a source may name. `medium` and `max` are here because the Trae
 * client knows five and rolls them out per model; upstream offered only the
 * three middle ones when this was measured (2026-10-25), so parsing them
 * changes nothing until upstream states them — and a rung outside this set is
 * still dropped, never rounded (see `effortFor` in adapter.ts).
 */
const EFFORT_NAMES = new Set<string>(['light', 'low', 'medium', 'high', 'extra_high', 'xhigh', 'max'])

function asEffort(value: unknown): TraeEffort | undefined {
  return typeof value === 'string' && EFFORT_NAMES.has(value) ? value as TraeEffort : undefined
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function positive(value: unknown): number | undefined {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

/** Image support for a model the built-in table already describes. */
const BUILTIN_MULTIMODAL = new Map(TRAE_MODELS.map(m => [m.configName.toLowerCase(), m.multimodal ?? false]))

/**
 * Parse `batch_get_detail_param`'s answer into the catalog shape.
 *
 * A config entry is a usable model only when it is switched on, visible, not a
 * custom-model row, and ships a `model_detail_list` — the four models Trae
 * retired are still *present* in the response, flagged
 * `is_invisible_to_user: true` with no detail list at all, which is exactly
 * what makes them unusable upstream.
 *
 * Visibility is per (config, function), so the answer is read as a union with
 * that as the verdict: a model hidden under every function in the response is
 * dropped, and one hidden here but shelved there is kept and pinned to the
 * function that shelves it. `functions` sets the priority order (a model
 * listed under several is described by the first); default is the response's
 * own order. Within one function the response order is preserved, so two
 * refreshes of one account produce the same list.
 */
export function parseDetailParams(payload: unknown, functions?: readonly string[]): TraeModel[] {
  const root = record(payload)
  const groups = array(root?.function_configs)
    .map(record)
    .filter((fc): fc is Record<string, unknown> => !!fc)
  const rank = (name: string): number => {
    const at = functions?.indexOf(name) ?? -1
    return at < 0 ? Number.MAX_SAFE_INTEGER : at
  }
  const ordered = functions
    ? [...groups].sort((a, b) => rank(String(a.function)) - rank(String(b.function)))
    : groups
  const configs = ordered.flatMap((fc) => {
    const fn = typeof fc.function === 'string' ? fc.function : CHAT_FUNCTION
    return array(fc.config_info_list).map(record).map(config => ({ fn, config }))
  })
  const models: TraeModel[] = []
  const seen = new Set<string>()
  for (const { fn, config } of configs) {
    if (!config) continue
    const configName = typeof config.config_name === 'string' ? config.config_name : ''
    if (!configName || NOT_MODELS.has(configName)) continue
    if (config.config_switch === false || config.is_invisible_to_user === true) continue
    // Already described by a higher-priority function; the spelling that
    // function used is the one the picker and `enabledModelIds` keep.
    if (seen.has(configName.toLowerCase())) continue
    const display = record(config.display_config) ?? {}
    if (display.is_custom_model === true) continue

    const details = array(config.model_detail_list).map(record).filter((d): d is Record<string, unknown> => !!d)
    const standard = details.find(d => String(d.model_name).endsWith('__dev')) ?? details[0]
    const standardKey = typeof standard?.model_name === 'string' ? standard.model_name : ''
    if (!standardKey) continue
    const maxDetail = details.find(d => String(d.model_name).endsWith('__max'))
    const windows = record(config.context_window_tokens) ?? {}
    const standardWindow = positive(windows.dev) ?? positive(standard?.prompt_max_tokens) ?? 200_000
    const maxWindow = positive(windows.max)

    const reasoning = record(config.reasoning_effort_config) ?? {}
    const efforts = reasoning.support_thinking === false
      ? []
      : array(reasoning.options).map(option => asEffort(record(option)?.level ?? option)).filter((e): e is TraeEffort => !!e)
    const defaultEffort = asEffort(reasoning.default_level)

    const id = typeof display.display_name === 'string' && display.display_name ? display.display_name : configName
    const model: TraeModel = {
      id,
      configName,
      key: standardKey,
      contextWindow: standardWindow,
      efforts,
      ...defaultEffort && efforts.includes(defaultEffort) ? { defaultEffort } : {},
      multimodal: display.multimodal === true,
      ...positive(standard?.max_tokens) !== undefined ? { outputTokens: positive(standard?.max_tokens)! } : {},
      // `chat` is what the request names anyway, so only a model shelved
      // elsewhere carries a pin.
      ...fn && fn !== CHAT_FUNCTION ? { wireFunction: fn } : {},
    }
    // Max counts only when the backend both flags it and gives it a bigger
    // window; Doubao-Seed-Evolving ships a `__max` key whose window is the
    // same 184K, which is not a Max variant in any useful sense.
    if (display.max_mode === true && maxDetail && maxWindow !== undefined && maxWindow > standardWindow) {
      model.max = {
        key: typeof maxDetail.model_name === 'string' ? maxDetail.model_name : standardKey,
        contextWindow: maxWindow,
        ...positive(maxDetail.max_tokens) !== undefined ? { outputTokens: positive(maxDetail.max_tokens)! } : {},
      }
    }
    models.push(model)
    seen.add(configName.toLowerCase())
  }
  return models
}

/**
 * Parse `~/.trae/cli/models_cache.json`. The entries are traecli's normalized
 * shape: the keys and both windows live under `business_metadata.variants`, and
 * `trae_reasoning_effort_levels` maps the catalog's `low/high/xhigh` spelling
 * onto the `light/high/extra_high` rungs the picker shows.
 */
export function parseModelsCache(payload: unknown): TraeModel[] {
  const root = record(payload)
  const models: TraeModel[] = []
  for (const raw of array(root?.models)) {
    const entry = record(raw)
    if (!entry) continue
    if (entry.visibility !== undefined && entry.visibility !== 'list') continue
    if (entry.supported_in_api === false) continue
    const configName = typeof entry.config_name === 'string' ? entry.config_name : ''
    const business = record(entry.business_metadata) ?? {}
    const variants = record(business.variants) ?? {}
    const standardKey = typeof variants.standard_key === 'string' ? variants.standard_key : ''
    if (!configName || !standardKey) continue

    // traecli spells the ladder low/high/xhigh; this map is the client's own
    // translation to the buttons (轻 / 高 / 极高).
    const spelling = record(business.trae_reasoning_effort_levels) ?? {}
    const rung = (value: unknown): TraeEffort | undefined => {
      const level = typeof value === 'string' ? value : ''
      return asEffort(spelling[level]) ?? asEffort(level)
    }
    const efforts = array(variants.standard_supported_reasoning_levels ?? entry.supported_reasoning_levels)
      .map(option => rung(record(option)?.effort ?? option))
      .filter((e): e is TraeEffort => !!e)
    const defaultEffort = rung(variants.standard_default_reasoning_level ?? entry.default_reasoning_level)

    const standardWindow = positive(variants.standard_context_window) ?? positive(entry.context_window) ?? 200_000
    const maxKey = typeof variants.max_key === 'string' ? variants.max_key : ''
    const maxWindow = positive(variants.max_context_window) ?? positive(entry.max_context_window)

    const model: TraeModel = {
      id: typeof entry.slug === 'string' && entry.slug ? entry.slug : configName,
      configName,
      key: standardKey,
      contextWindow: standardWindow,
      efforts,
      ...defaultEffort && efforts.includes(defaultEffort) ? { defaultEffort } : {},
      // `input_modalities` says ["text","image"] for every model, so it cannot
      // be read as a capability; a model the built-in table knows keeps its
      // flag, and one it does not stays text-only rather than earning images
      // on a guess (an image sent to a text-only model is rejected upstream as
      // `1210`, dressed up as a rate limit).
      multimodal: BUILTIN_MULTIMODAL.get(configName.toLowerCase()) ?? false,
    }
    if (maxKey && maxWindow !== undefined && maxWindow > standardWindow) {
      model.max = { key: maxKey, contextWindow: maxWindow }
    }
    models.push(model)
  }
  return models
}

export type CatalogOrigin = 'upstream' | 'cache' | 'builtin'

export interface CatalogSnapshot {
  routes: readonly TraeRoute[]
  origin: CatalogOrigin
  /** When this snapshot was built (epoch ms); 0 for the built-in table. */
  at: number
  /** Why the better source was not used, when one was skipped. */
  note?: string
  find(id: string): TraeRoute | undefined
}

function snapshot(models: readonly TraeModel[], origin: CatalogOrigin, at: number, note?: string): CatalogSnapshot {
  const routes = toRoutes(models)
  const index = indexRoutes(models, routes)
  return {
    routes,
    origin,
    at,
    ...note ? { note } : {},
    find: (id: string) => index.get(id) ?? index.get(id.toLowerCase()),
  }
}

export const BUILTIN_SNAPSHOT: CatalogSnapshot = snapshot(TRAE_MODELS, 'builtin', 0)

export interface CatalogOptions {
  /**
   * Which sources may be used: `auto` walks upstream → cache → builtin,
   * `upstream` / `cache` pin the catalog to that one source (still falling back
   * to the built-in table if it yields nothing), `builtin` asks for neither.
   */
  mode?: CatalogOrigin | 'auto'
  /** traecli's cache file; empty disables that step. */
  cacheFile?: string
  /**
   * Catalog functions to ask for, `chat` first. Anything beyond `chat` is a
   * second, best-effort request (see `EXTRA_CATALOG_FUNCTIONS`); `['chat']`
   * asks exactly what traecli asks.
   */
  functions?: readonly string[]
  /** The upstream call, injected so tests and the builtin mode stay offline. */
  fetchUpstream?: (signal: AbortSignal, body: Record<string, unknown>) => Promise<unknown>
  /** Overridable for tests. */
  readCacheFile?: (file: string) => Promise<string>
  /**
   * Deadline for one upstream catalog call. Without it the request inherits
   * undici's own (300s headers, and a body timer any trickle of bytes resets),
   * which is far longer than a turn may wait for a model list.
   */
  fetchTimeoutMs?: number
  /** How long `ready()` waits before the caller runs on the snapshot it has. */
  readyWaitMs?: number
  /** After a refresh upstream failed, how long `ready()` keeps the fallback before asking again. */
  retryAfterMs?: number
  /** The same, when upstream was never asked because the PAT could not be read. */
  retryNoCredentialMs?: number
  logger?: { info(...a: unknown[]): void; warn(...a: unknown[]): void }
}

const FETCH_TIMEOUT_MS = 15_000
const READY_WAIT_MS = 15_000
/** A failing upstream is asked again at most this often. */
const RETRY_AFTER_MS = 60_000
/**
 * A PAT that cannot be read sent nothing upstream — at plugin start the host's
 * credential store may simply not be up yet — so it is worth asking again
 * soon; not on every call, though, or a profile with no PAT re-reads the
 * traecli cache file for each one.
 */
const RETRY_NO_CREDENTIAL_MS = 5_000
/** TraeAuth's error code for a PAT that is not there (yet). */
const MISSING_CREDENTIAL = 'MISSING_CREDENTIAL'

/**
 * The catalog the adapter asks. It holds the newest snapshot it managed to
 * build and refreshes once per plugin start — a plugin reload (and a saved PAT,
 * which resets it) is therefore also a catalog refresh. `refresh(true)` is the
 * manual path.
 *
 * Only upstream settles it. A refresh that had to fall back to traecli's cache
 * or the built-in table is served as it is, and asked again once its cooldown
 * is over: those sources cannot say which models take images (the cache claims
 * images for every model, so a model the built-in table does not know is
 * text-only there), and the usual cause — the PAT not being readable while the
 * host is still starting — is gone a few seconds later.
 */
export class TraeCatalog {
  private current: CatalogSnapshot = BUILTIN_SNAPSHOT
  private inflight: Promise<CatalogSnapshot> | undefined
  /**
   * When `ready()` may ask again: undefined before the first refresh (and
   * after a reset), Infinity once upstream has answered or the mode never asks
   * it, otherwise the end of the fallback's cooldown.
   */
  private retryAt: number | undefined

  constructor(private readonly opts: CatalogOptions = {}) {}

  /** The newest snapshot, without waiting for a refresh. */
  get snapshot(): CatalogSnapshot {
    return this.current
  }

  /**
   * Refresh once per plugin start — again after a cooldown while upstream has
   * not answered; concurrent callers share the one attempt.
   *
   * A caller waiting on a turn never waits indefinitely: past `readyWaitMs`
   * this answers with the snapshot it already has (the built-in table on a
   * first run) and leaves the refresh running for the next caller. `signal`
   * is the caller's own — a stop press rejects instead of waiting out the
   * deadline.
   */
  ready(signal?: AbortSignal): Promise<CatalogSnapshot> {
    if (this.retryAt !== undefined && Date.now() < this.retryAt) return Promise.resolve(this.current)
    return this.race(this.refresh(), signal)
  }

  /** The refresh, the wait deadline and the caller's stop, whichever lands first. */
  private race(attempt: Promise<CatalogSnapshot>, signal: AbortSignal | undefined): Promise<CatalogSnapshot> {
    const wait = this.opts.readyWaitMs ?? READY_WAIT_MS
    if (wait <= 0 && !signal) return attempt
    return new Promise<CatalogSnapshot>((resolve, reject) => {
      let settled = false
      const land = (run: () => void): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        run()
      }
      const onAbort = (): void => land(() => reject(signal?.reason ?? new Error('aborted')))
      const timer = wait > 0
        ? setTimeout(() => land(() => {
          this.opts.logger?.warn(`dsh-trae2api: 模型目录 ${Math.round(wait / 1000)} 秒没有回来，本轮先用现有的那份（${this.current.origin}）`)
          resolve(this.current)
        }), wait)
        : undefined
      timer?.unref?.()
      if (signal?.aborted) { onAbort(); return }
      signal?.addEventListener('abort', onAbort, { once: true })
      // A failed refresh keeps serving the previous snapshot, so never reject.
      attempt.then(next => land(() => resolve(next)), () => land(() => resolve(this.current)))
    })
  }

  /** Re-ask the sources now. Never downgrades a good snapshot on failure. */
  refresh(force = false): Promise<CatalogSnapshot> {
    if (this.inflight && !force) return this.inflight
    const attempt = this.load().then(({ next, retryIn }) => {
      if (next) this.current = next
      // Upstream's answer settles it, whether new or kept from an earlier
      // refresh; only a fallback is asked again once its cooldown is over.
      this.retryAt = retryIn === undefined || this.current.origin === 'upstream' ? Infinity : Date.now() + retryIn
      return this.current
    }).finally(() => {
      if (this.inflight === attempt) this.inflight = undefined
    })
    this.inflight = attempt
    return attempt
  }

  /** Next `ready()` asks again (the PAT changed, so the old answer may be wrong). */
  reset(): void {
    this.retryAt = undefined
    this.inflight = undefined
  }

  /**
   * One pass over the sources. `next` is the snapshot to serve (undefined =
   * keep the current one); `retryIn` is how long until upstream is worth
   * asking again, undefined when this answer settles the catalog.
   */
  private async load(): Promise<{ next?: CatalogSnapshot; retryIn?: number }> {
    const mode = this.opts.mode ?? 'auto'
    if (mode === 'builtin') return { next: BUILTIN_SNAPSHOT }
    const notes: string[] = []
    let retryIn: number | undefined

    if ((mode === 'auto' || mode === 'upstream') && this.opts.fetchUpstream) {
      retryIn = this.opts.retryAfterMs ?? RETRY_AFTER_MS
      try {
        const timeout = this.opts.fetchTimeoutMs ?? FETCH_TIMEOUT_MS
        const fetchUpstream = this.opts.fetchUpstream
        const models = parseDetailParams(
          await fetchUpstream(AbortSignal.timeout(timeout), catalogBody([CHAT_FUNCTION])),
          [CHAT_FUNCTION],
        )
        // Extra functions are a second request on purpose: they are unverified
        // on this host, and a 400 on one name must not take the `chat` list —
        // the list that has always worked — down with it.
        const extras = (this.opts.functions ?? [CHAT_FUNCTION]).filter(fn => fn && fn !== CHAT_FUNCTION)
        const added: TraeModel[] = []
        if (extras.length > 0) {
          try {
            const answer = await fetchUpstream(AbortSignal.timeout(timeout), catalogBody(extras))
            const known = new Set(models.map(m => m.configName.toLowerCase()))
            for (const model of parseDetailParams(answer, extras)) {
              if (known.has(model.configName.toLowerCase())) continue
              known.add(model.configName.toLowerCase())
              added.push(model)
            }
            if (added.length > 0) {
              const by = new Map<string, number>()
              for (const model of added) {
                const fn = model.wireFunction ?? CHAT_FUNCTION
                by.set(fn, (by.get(fn) ?? 0) + 1)
              }
              const where = [...by].map(([fn, n]) => `${fn} ${n} 个`).join('、')
              this.opts.logger?.info(`dsh-trae2api: 另有 ${added.length} 个模型只在额外通道上架（${where}），已并入目录`)
            }
          } catch (error) {
            // Losing the extras costs their models, never the catalog.
            this.opts.logger?.warn(
              `dsh-trae2api: 额外模型通道（${extras.join('、')}）没问到，本次只用 chat 通道的目录`
              + `（${error instanceof Error ? error.message : String(error)}）`,
            )
          }
        }
        const merged = [...models, ...added]
        if (merged.length > 0) {
          this.opts.logger?.info(`dsh-trae2api: 模型目录已从上游刷新，共 ${merged.length} 个模型`)
          return { next: snapshot(merged, 'upstream', Date.now()) }
        }
        notes.push('上游目录没有返回可用模型')
      } catch (error) {
        if ((error as { code?: unknown } | undefined)?.code === MISSING_CREDENTIAL) {
          retryIn = this.opts.retryNoCredentialMs ?? RETRY_NO_CREDENTIAL_MS
        }
        notes.push(`上游目录拉取失败（${error instanceof Error ? error.message : String(error)}）`)
      }
    }
    const retry = (next?: CatalogSnapshot) => ({ ...next ? { next } : {}, ...retryIn === undefined ? {} : { retryIn } })

    const cacheFile = this.opts.cacheFile ?? MODELS_CACHE_FILE
    if ((mode === 'auto' || mode === 'cache') && cacheFile) {
      try {
        const read = this.opts.readCacheFile ?? ((file: string) => readFile(file, 'utf8'))
        const models = parseModelsCache(JSON.parse(await read(cacheFile)))
        if (models.length > 0) {
          const note = notes.join('；')
          const again = retryIn === undefined ? '' : `，${Math.round(retryIn / 1000)} 秒后再试上游`
          this.opts.logger?.info(`dsh-trae2api: 模型目录取自 traecli 缓存 ${cacheFile}，共 ${models.length} 个模型${note ? `（${note}${again}）` : ''}`)
          return retry(snapshot(models, 'cache', Date.now(), note || undefined))
        }
        notes.push(`${cacheFile} 里没有可用模型`)
      } catch (error) {
        notes.push(`读取 ${cacheFile} 失败（${error instanceof Error ? error.message : String(error)}）`)
      }
    }

    const note = notes.join('；')
    // A refresh that reaches nothing is not a reason to throw away a list that
    // worked: the previous snapshot stays, and only a first attempt falls all
    // the way back to the built-in table.
    if (this.current.origin !== 'builtin') {
      if (note) this.opts.logger?.warn(`dsh-trae2api: 模型目录刷新失败，继续用上次拿到的那份（${note}）`)
      return retry()
    }
    if (note) this.opts.logger?.warn(`dsh-trae2api: 模型目录沿用插件内置的那份（${note}）`)
    return retry(note ? snapshot(TRAE_MODELS, 'builtin', Date.now(), note) : BUILTIN_SNAPSHOT)
  }
}
