/**
 * Trae enterprise model catalog — the shape every source is parsed into, plus
 * the baked-in table used when no source can be reached.
 *
 * At runtime the list is asked for rather than shipped: see
 * `catalog-source.ts`, which reads Trae's own `batch_get_detail_param` first
 * and traecli's `~/.trae/cli/models_cache.json` second. This table is the
 * floor under both, so a plugin with no network and no traecli still offers a
 * picker. It is a snapshot, and a snapshot is wrong eventually — on 2026-10-16
 * Trae retired Qwen3.7-Plus, GLM-5V-Turbo, Kimi-K2.7-Code and DeepSeek-V4-Pro
 * (the `正式版` one stayed), and every turn on one of them died with `4023 the
 * model is unknown`.
 *
 * Synced 2026-10-16 with the live `batch_get_detail_param` response, which is
 * the authority on all of it: the model list, both backend keys (`key`'s
 * `__dev` / `__max` suffix is paired with `x-ide-version-code: 20260908`),
 * both context windows, the per-variant output cap, whether Max is real, the
 * thinking ladder, and image support. It overruled the client capability table
 * (`AI.agent.model.model_list_map`, captured 2026-10-13 from TRAE SOLO CN)
 * this file used to follow on four points: the Doubao family has no Max at all
 * and Doubao-Seed-2.1-Turbo is a 200K window, not 256K, while GLM-5.2 does
 * have Max.
 *
 * Max comes two ways, and both are still honoured because a `models_cache.json`
 * fallback can describe either:
 *  - with a catalog `max_key`: route to that key (what traecli does, and what
 *    every current model uses);
 *  - without one: keep the standard key and let the `max` strategy marker plus
 *    the requested window carry it (what the IDE does).
 *
 * A Max-capable model is listed once, already at 1M; the smaller variant is
 * not offered separately.
 */

/**
 * Thinking levels. The client table spells them `light`/`high`/`extra_high`
 * (the 轻/高/极高 buttons); a few models are described only by the catalog,
 * which spells the same ladder `low`/`high`/`xhigh`. Each model advertises the
 * vocabulary its own source used, which is what gets sent upstream.
 */
export type TraeEffort = 'light' | 'low' | 'high' | 'extra_high' | 'xhigh'

export interface TraeModel {
  /** Display id shown in the picker (traecli's slug). */
  id: string
  /** `config_name` the backend keys configuration off. */
  configName: string
  /** `model_name` the backend routes on, standard variant. */
  key: string
  /** Context window of the standard variant, in tokens. */
  contextWindow: number
  /** Selectable thinking levels, least to most; empty = no level control. */
  efforts: readonly TraeEffort[]
  /** Level Trae uses when none is chosen. */
  defaultEffort?: TraeEffort
  /**
   * The long-context "Max" variant, for every model the client table marks
   * `max_mode: true`. `key` is the catalog's `max_key` when it ships one;
   * absent means Max rides on the strategy marker with the standard key.
   */
  max?: { key?: string; contextWindow: number; outputTokens?: number }
  /** Output cap on the standard variant, when the source states one. */
  outputTokens?: number
  /**
   * Whether the model accepts images, from the client capability table's
   * `multimodal` flag — the only source that says *false* for a text-only
   * model (traecli's `debug models` reports `input_modalities:
   * ["text","image"]` for every model; it is a constant inherited from the
   * Codex fork, not a per-model capability). Sending an image to a text-only
   * model fails upstream with `1210:messages.content.type 参数非法` wrapped
   * in a misleading "rate limited" envelope (see trae2api/direct.py).
   */
  multimodal?: boolean
}

const LIGHT_HIGH: readonly TraeEffort[] = ['light', 'high']
const LIGHT_HIGH_EXTRA: readonly TraeEffort[] = ['light', 'high', 'extra_high']
const HIGH_EXTRA: readonly TraeEffort[] = ['high', 'extra_high']
const NONE: readonly TraeEffort[] = []
const MAX_1M = 1_000_000

export const TRAE_MODELS: readonly TraeModel[] = [
  // The Doubao family has no Max: each ships a `__max` key whose window is the
  // same as the standard one, and the live catalog flags `max_mode: false`.
  // Their output cap is 16K rather than the 32K every other standard route gets.
  { id: 'Doubao-Seed-Evolving', configName: 'Doubao-Seed-Evolving', key: 'Doubao-Seed-Evolving__dev', contextWindow: 184_000, efforts: LIGHT_HIGH, defaultEffort: 'high', outputTokens: 16_000, multimodal: true },
  { id: 'Doubao-Seed-2.1-Pro-0915', configName: 'Doubao-Seed-2.1-pro', key: 'Doubao-Seed-2.1-pro__dev', contextWindow: 200_000, efforts: LIGHT_HIGH, defaultEffort: 'high', multimodal: true },
  { id: 'Doubao-Seed-2.1-Turbo', configName: 'Doubao-Seed-2.1-turbo', key: 'Doubao-Seed-2.1-turbo__dev', contextWindow: 200_000, efforts: LIGHT_HIGH, defaultEffort: 'high', multimodal: true },
  { id: 'Doubao-Seed-2.0-Code', configName: 'Doubao-Seed-2.0-Code', key: 'Doubao-Seed-2.0-Code__dev', contextWindow: 184_000, efforts: LIGHT_HIGH, defaultEffort: 'high', outputTokens: 16_000, multimodal: true },
  { id: 'Doubao-Seed-Code', configName: 'Doubao_1_6', key: 'Doubao_1_6__dev', contextWindow: 184_000, efforts: NONE, outputTokens: 16_000, multimodal: true },
  { id: 'GLM-5.3-FlashX', configName: 'glm-5.3-flashx', key: 'glm-5.3-flashx__dev', contextWindow: 200_000, efforts: LIGHT_HIGH_EXTRA, defaultEffort: 'high', max: { key: 'glm-5.3-flashx__max', contextWindow: MAX_1M }, multimodal: true },
  { id: 'Step-5-Preview', configName: 'step-5-preview', key: 'step-5-preview__dev', contextWindow: 200_000, efforts: LIGHT_HIGH, defaultEffort: 'high', max: { key: 'step-5-preview__max', contextWindow: MAX_1M }, multimodal: true },
  { id: 'GLM-5.3-Flash', configName: 'glm-5.3-flash', key: 'glm-5.3-flash__dev', contextWindow: 200_000, efforts: LIGHT_HIGH_EXTRA, defaultEffort: 'high', max: { key: 'glm-5.3-flash__max', contextWindow: MAX_1M }, multimodal: true },
  { id: 'GLM-5.3', configName: 'glm-5.3', key: 'glm-5.3__dev', contextWindow: 200_000, efforts: LIGHT_HIGH_EXTRA, defaultEffort: 'high', max: { key: 'glm-5.3__max', contextWindow: MAX_1M }, multimodal: false },
  { id: 'GLM-5.2', configName: 'glm-5.2', key: 'glm-5.2__dev', contextWindow: 200_000, efforts: HIGH_EXTRA, defaultEffort: 'high', max: { key: 'glm-5.2__max', contextWindow: MAX_1M }, multimodal: false },
  { id: 'MiniMax-M3', configName: 'minimax-m3', key: 'minimax-m3__dev', contextWindow: 200_000, efforts: NONE, max: { key: 'minimax-m3__max', contextWindow: MAX_1M }, multimodal: true },
  { id: 'MiniMax-M2.7', configName: 'minimax-m2.7', key: 'minimax-m2.7__dev', contextWindow: 200_000, efforts: NONE, multimodal: false },
  { id: 'Qwen3.8-Max', configName: 'qwen3.8-max', key: 'qwen3.8-max__dev', contextWindow: 200_000, efforts: LIGHT_HIGH_EXTRA, defaultEffort: 'high', max: { key: 'qwen3.8-max__max', contextWindow: MAX_1M }, multimodal: true },
  { id: 'Kimi-K2.8-Preview', configName: 'kimi-k2.8-preview', key: 'kimi-k2.8-preview__dev', contextWindow: 200_000, efforts: LIGHT_HIGH_EXTRA, defaultEffort: 'extra_high', max: { key: 'kimi-k2.8-preview__max', contextWindow: MAX_1M }, multimodal: true },
  { id: 'Kimi-K3', configName: 'kimi-k3', key: 'kimi-k3__dev', contextWindow: 200_000, efforts: LIGHT_HIGH_EXTRA, defaultEffort: 'extra_high', max: { key: 'kimi-k3__max', contextWindow: MAX_1M }, multimodal: true },
  { id: 'MiMo-V2.6-Pro', configName: 'mimo-v2.6-pro', key: 'mimo-v2.6-pro__dev', contextWindow: 200_000, efforts: NONE, max: { key: 'mimo-v2.6-pro__max', contextWindow: MAX_1M }, multimodal: true },
  { id: 'MiMo-V2.6-Flash', configName: 'mimo-v2.6-flash', key: 'mimo-v2.6-flash__dev', contextWindow: 200_000, efforts: NONE, max: { key: 'mimo-v2.6-flash__max', contextWindow: MAX_1M }, multimodal: true },
  { id: 'DeepSeek-V4.1-Flash', configName: 'DeepSeek-V4.1-Flash', key: 'DeepSeek-V4.1-Flash__dev', contextWindow: 200_000, efforts: LIGHT_HIGH_EXTRA, defaultEffort: 'high', max: { key: 'DeepSeek-V4.1-Flash__max', contextWindow: MAX_1M }, multimodal: true },
  { id: 'DeepSeek-V4-Pro 正式版', configName: 'DeepSeek-V4-Pro-Official', key: 'DeepSeek-V4-Pro-Official__dev', contextWindow: 200_000, efforts: LIGHT_HIGH_EXTRA, defaultEffort: 'high', max: { key: 'DeepSeek-V4-Pro-Official__max', contextWindow: MAX_1M }, multimodal: false },
  { id: 'DeepSeek-V4-Flash 正式版', configName: 'DeepSeek-V4-Flash-Official', key: 'deepseek_v4_flash_official__dev', contextWindow: 200_000, efforts: LIGHT_HIGH_EXTRA, defaultEffort: 'high', max: { key: 'deepseek_v4_flash_official__max', contextWindow: MAX_1M }, multimodal: false },
]

/** Display names for the picker's thinking-level menu (the 轻/高/极高 buttons). */
export const EFFORT_NAMES: Record<TraeEffort, string> = {
  light: 'Light 轻',
  low: 'Low 轻',
  high: 'High 高',
  extra_high: 'Extra High 极高',
  xhigh: 'Extra High 极高',
}

/** One selectable entry: one model, already in its largest available variant. */
export interface TraeRoute {
  /** Id as the picker shows it. */
  id: string
  configName: string
  /** Backend `model_name` for this variant. */
  key: string
  contextWindow: number
  efforts: readonly TraeEffort[]
  defaultEffort?: TraeEffort
  /** True when this is the Max variant, however Max is expressed for it. */
  maxMode: boolean
  /**
   * True when Max rides the `max` strategy marker because the catalog ships no
   * `max_key` for this model. With a `max_key` the `__max` key in `key` says it
   * all — traecli sends no marker there, so neither do we.
   */
  maxMarker: boolean
  /** True when this model accepts images on user messages (upstream `image_url`). */
  multimodal: boolean
  /**
   * Output cap the backend grants a turn on this variant, when the catalog
   * states it (`model_detail_list[].max_tokens`). Absent = fall back to the
   * adapter's by-Max-ness default.
   */
  outputTokens?: number
}

/**
 * One entry per model. A Max-capable model is offered only in its Max form —
 * there is no reason to also list the smaller variant, so the 1M window is
 * simply what that model is. This mirrors trae2api's default
 * `TRAE2API_MAX_CONTEXT=auto`, which turns Max on wherever it exists.
 */
export function toRoutes(models: readonly TraeModel[]): readonly TraeRoute[] {
  return models.map((model) => {
    const max = model.max
    return {
      id: model.id,
      configName: model.configName,
      // Without a `max_key`, Max keeps the standard key and rides the marker.
      key: max?.key ?? model.key,
      contextWindow: max?.contextWindow ?? model.contextWindow,
      efforts: model.efforts,
      ...model.defaultEffort ? { defaultEffort: model.defaultEffort } : {},
      maxMode: max !== undefined,
      maxMarker: max !== undefined && max.key === undefined,
      multimodal: model.multimodal ?? false,
      ...(max ? max.outputTokens : model.outputTokens) !== undefined
        ? { outputTokens: (max ? max.outputTokens : model.outputTokens)! }
        : {},
    }
  })
}

export const TRAE_ROUTES: readonly TraeRoute[] = toRoutes(TRAE_MODELS)

/**
 * Lookup index for one set of routes. Every name a request might arrive under
 * resolves to the same route: the picker id, the `config_name`, and either
 * backend key — the standard `__dev` one included, so a session pinned to a
 * model before it gained Max still lands on it.
 */
export function indexRoutes(models: readonly TraeModel[], routes: readonly TraeRoute[]): Map<string, TraeRoute> {
  const byId = new Map<string, TraeRoute>()
  for (const route of routes) {
    const model = models.find(m => m.configName === route.configName)
    for (const alias of [route.id, route.configName, route.key, model?.key]) {
      if (!alias) continue
      byId.set(alias, route)
      byId.set(alias.toLowerCase(), route)
    }
  }
  return byId
}

const builtinIndex = indexRoutes(TRAE_MODELS, TRAE_ROUTES)

/** Find a built-in route by picker id, config name or backend key (case-insensitive). */
export function findModel(id: string): TraeRoute | undefined {
  return builtinIndex.get(id) ?? builtinIndex.get(id.toLowerCase())
}
