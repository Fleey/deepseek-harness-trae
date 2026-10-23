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

/** The ToB catalog call: one POST, the whole `chat` function's model list. */
export const CATALOG_PATH = '/api/ide/v1/batch_get_detail_param'

/**
 * The body traecli sends, with `current_config_name` /
 * `current_config_is_custom_model` folded into the `current_config_info`
 * object its wire struct names. `access_type: 4` is the enterprise seat and
 * `mode_type: 0` the chat surface — the same pair the chat request carries.
 */
export const CATALOG_BODY: Record<string, unknown> = {
  functions: ['chat'],
  agent_type: 'chat',
  current_config_info: { config_name: '', is_custom_model: false },
  mode_type: 0,
  access_type: 4,
  ab_force_vids: '',
  ab_autotest_advanced_mode: 0,
  show_custom_model: true,
}

/** Where traecli keeps its own copy. */
export const MODELS_CACHE_FILE = join(homedir(), '.trae', 'cli', 'models_cache.json')

/**
 * Config names that are not models: `summary` is the compaction config and
 * `custom_model_placeholder` is the row the IDE shows for "add your own".
 */
const NOT_MODELS = new Set(['summary', 'custom_model_placeholder'])

const EFFORT_NAMES = new Set<string>(['light', 'low', 'high', 'extra_high', 'xhigh'])

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
 */
export function parseDetailParams(payload: unknown): TraeModel[] {
  const root = record(payload)
  const configs = array(root?.function_configs)
    .map(record)
    .filter((fc): fc is Record<string, unknown> => fc?.function === 'chat')
    .flatMap(fc => array(fc.config_info_list).map(record))
  const models: TraeModel[] = []
  for (const config of configs) {
    if (!config) continue
    const configName = typeof config.config_name === 'string' ? config.config_name : ''
    if (!configName || NOT_MODELS.has(configName)) continue
    if (config.config_switch === false || config.is_invisible_to_user === true) continue
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
  /** The upstream call, injected so tests and the builtin mode stay offline. */
  fetchUpstream?: (signal: AbortSignal) => Promise<unknown>
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
        const models = parseDetailParams(await this.opts.fetchUpstream(AbortSignal.timeout(timeout)))
        if (models.length > 0) {
          this.opts.logger?.info(`dsh-trae2api: 模型目录已从上游刷新，共 ${models.length} 个模型`)
          return { next: snapshot(models, 'upstream', Date.now()) }
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
