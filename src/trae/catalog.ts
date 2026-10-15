/**
 * Trae enterprise model catalog, hard-coded.
 *
 * Two sources, merged the way trae2api's `_apply_ide_capabilities` merges them:
 *
 *  - traecli 0.206.1-tob's catalog (`~/.trae/cli/models_cache.json`) gives the
 *    model list, `config_name` and the backend keys (`standard_key` /
 *    `max_key`). `key` is what llm_raw_chat routes on, and its `__dev` /
 *    `__max` suffix is paired with `x-ide-version-code: 20260908`.
 *  - The client's own capability table (`AI.agent.model.model_list_map` in its
 *    globalStorage state DB) is the authority on **context windows, which
 *    models have Max, the thinking-level vocabulary, and which models take
 *    images**.
 *
 * Captured 2026-10-13 from **TRAE SOLO CN** (31 entries) — the table belonging
 * to the TraeWork CN client actually in use. Note that trae2api's
 * `_IDE_STATE_DEFAULTS` does not look there: it finds the stale `Trae CN`
 * table (26 entries), which still lists models the catalog has dropped
 * (glm-5.1, glm-5), misses current ones (DeepSeek-V4.1-Flash), reports 116K /
 * 112K windows this client does not use, and calls `max_mode: false` on models
 * that plainly have the toggle. Read the SOLO CN table when refreshing this.
 *
 * Two ways a model gets Max, both taken from the live clients:
 *  - with a catalog `max_key`: route to that key (what traecli does);
 *  - without one: keep the standard key and let the `max` strategy marker plus
 *    the requested window carry it (what the IDE does). Doubao-Seed-Evolving
 *    and Doubao-Seed-2.1-Pro-0915 are Max-capable only this second way.
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
  max?: { key?: string; contextWindow: number }
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
const LOW_HIGH: readonly TraeEffort[] = ['low', 'high']
const HIGH_XHIGH: readonly TraeEffort[] = ['high', 'xhigh']
const NONE: readonly TraeEffort[] = []
const MAX_1M = 1_000_000

export const TRAE_MODELS: readonly TraeModel[] = [
  // Max without a catalog max_key: strategy marker only.
  { id: 'Doubao-Seed-Evolving', configName: 'Doubao-Seed-Evolving', key: 'Doubao-Seed-Evolving__dev', contextWindow: 184_000, efforts: LIGHT_HIGH, defaultEffort: 'high', max: { contextWindow: MAX_1M }, multimodal: true },
  { id: 'Doubao-Seed-2.1-Pro-0915', configName: 'Doubao-Seed-2.1-pro', key: 'Doubao-Seed-2.1-pro__dev', contextWindow: 184_000, efforts: LIGHT_HIGH, defaultEffort: 'high', max: { contextWindow: MAX_1M }, multimodal: true },
  // The client table reports 256K for this one, above the catalog's 200K.
  { id: 'Doubao-Seed-2.1-Turbo', configName: 'Doubao-Seed-2.1-turbo', key: 'Doubao-Seed-2.1-turbo__dev', contextWindow: 256_000, efforts: LOW_HIGH, defaultEffort: 'high', multimodal: true },
  { id: 'Doubao-Seed-2.0-Code', configName: 'Doubao-Seed-2.0-Code', key: 'Doubao-Seed-2.0-Code__dev', contextWindow: 184_000, efforts: LIGHT_HIGH, defaultEffort: 'high', multimodal: true },
  { id: 'Doubao-Seed-Code', configName: 'Doubao_1_6', key: 'Doubao_1_6__dev', contextWindow: 184_000, efforts: NONE, multimodal: true },
  { id: 'GLM-5.3-FlashX', configName: 'glm-5.3-flashx', key: 'glm-5.3-flashx__dev', contextWindow: 200_000, efforts: LIGHT_HIGH_EXTRA, defaultEffort: 'high', max: { key: 'glm-5.3-flashx__max', contextWindow: MAX_1M }, multimodal: true },
  { id: 'Step-5-Preview', configName: 'step-5-preview', key: 'step-5-preview__dev', contextWindow: 200_000, efforts: LIGHT_HIGH, defaultEffort: 'high', max: { key: 'step-5-preview__max', contextWindow: MAX_1M }, multimodal: true },
  { id: 'GLM-5.3-Flash', configName: 'glm-5.3-flash', key: 'glm-5.3-flash__dev', contextWindow: 200_000, efforts: LIGHT_HIGH_EXTRA, defaultEffort: 'high', max: { key: 'glm-5.3-flash__max', contextWindow: MAX_1M }, multimodal: true },
  { id: 'GLM-5.3', configName: 'glm-5.3', key: 'glm-5.3__dev', contextWindow: 200_000, efforts: LIGHT_HIGH_EXTRA, defaultEffort: 'high', max: { key: 'glm-5.3__max', contextWindow: MAX_1M }, multimodal: false },
  // Catalog ships a max_key, but the client table says this model has no Max.
  { id: 'GLM-5.2', configName: 'glm-5.2', key: 'glm-5.2__dev', contextWindow: 200_000, efforts: HIGH_XHIGH, defaultEffort: 'high', multimodal: false },
  { id: 'GLM-5V-Turbo', configName: 'glm-5v-turbo', key: 'glm-5v-turbo__dev', contextWindow: 200_000, efforts: NONE, multimodal: true },
  { id: 'MiniMax-M3', configName: 'minimax-m3', key: 'minimax-m3__dev', contextWindow: 200_000, efforts: NONE, max: { key: 'minimax-m3__max', contextWindow: MAX_1M }, multimodal: true },
  { id: 'MiniMax-M2.7', configName: 'minimax-m2.7', key: 'minimax-m2.7__dev', contextWindow: 200_000, efforts: NONE, multimodal: false },
  { id: 'Qwen3.8-Max', configName: 'qwen3.8-max', key: 'qwen3.8-max__dev', contextWindow: 200_000, efforts: LIGHT_HIGH_EXTRA, defaultEffort: 'high', max: { key: 'qwen3.8-max__max', contextWindow: MAX_1M }, multimodal: true },
  { id: 'Qwen3.7-Plus', configName: 'qwen-3.7-plus', key: 'qwen-3.7-plus__dev', contextWindow: 200_000, efforts: NONE, max: { key: 'qwen-3.7-plus__max', contextWindow: MAX_1M }, multimodal: true },
  { id: 'Kimi-K2.8-Preview', configName: 'kimi-k2.8-preview', key: 'kimi-k2.8-preview__dev', contextWindow: 200_000, efforts: LIGHT_HIGH_EXTRA, defaultEffort: 'extra_high', max: { key: 'kimi-k2.8-preview__max', contextWindow: MAX_1M }, multimodal: true },
  { id: 'Kimi-K3', configName: 'kimi-k3', key: 'kimi-k3__dev', contextWindow: 200_000, efforts: LIGHT_HIGH_EXTRA, defaultEffort: 'extra_high', max: { key: 'kimi-k3__max', contextWindow: MAX_1M }, multimodal: true },
  { id: 'Kimi-K2.7-Code', configName: 'kimi-k2.7-code', key: 'kimi-k2.7-code__dev', contextWindow: 200_000, efforts: NONE, multimodal: true },
  { id: 'MiMo-V2.6-Pro', configName: 'mimo-v2.6-pro', key: 'mimo-v2.6-pro__dev', contextWindow: 200_000, efforts: NONE, max: { key: 'mimo-v2.6-pro__max', contextWindow: MAX_1M }, multimodal: true },
  { id: 'MiMo-V2.6-Flash', configName: 'mimo-v2.6-flash', key: 'mimo-v2.6-flash__dev', contextWindow: 200_000, efforts: NONE, max: { key: 'mimo-v2.6-flash__max', contextWindow: MAX_1M }, multimodal: true },
  { id: 'DeepSeek-V4.1-Flash', configName: 'DeepSeek-V4.1-Flash', key: 'DeepSeek-V4.1-Flash__dev', contextWindow: 200_000, efforts: LIGHT_HIGH_EXTRA, defaultEffort: 'high', max: { key: 'DeepSeek-V4.1-Flash__max', contextWindow: MAX_1M }, multimodal: true },
  { id: 'DeepSeek-V4-Pro 正式版', configName: 'DeepSeek-V4-Pro-Official', key: 'DeepSeek-V4-Pro-Official__dev', contextWindow: 200_000, efforts: LIGHT_HIGH_EXTRA, defaultEffort: 'high', max: { key: 'DeepSeek-V4-Pro-Official__max', contextWindow: MAX_1M }, multimodal: false },
  // Catalog ships a max_key, but the client table says this model has no Max.
  { id: 'DeepSeek-V4-Pro', configName: 'deepseek-V4-Pro', key: 'deepseek-V4-Pro__dev', contextWindow: 200_000, efforts: HIGH_XHIGH, defaultEffort: 'high', multimodal: false },
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
}

/**
 * One entry per model. A Max-capable model is offered only in its Max form —
 * there is no reason to also list the smaller variant, so the 1M window is
 * simply what that model is. This mirrors trae2api's default
 * `TRAE2API_MAX_CONTEXT=auto`, which turns Max on wherever it exists.
 */
export const TRAE_ROUTES: readonly TraeRoute[] = TRAE_MODELS.map((model) => {
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
  }
})

const byId = new Map<string, TraeRoute>()
for (const route of TRAE_ROUTES) {
  const model = TRAE_MODELS.find(m => m.configName === route.configName)!
  for (const alias of [route.id, route.configName, route.key, model.key]) {
    byId.set(alias, route)
    byId.set(alias.toLowerCase(), route)
  }
}

/** Find a route by picker id, config name or backend key (case-insensitive). */
export function findModel(id: string): TraeRoute | undefined {
  return byId.get(id) ?? byId.get(id.toLowerCase())
}
