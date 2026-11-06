// src/index.ts
import Schema from "@deepseek-ai/schemastery";

// src/adapter.ts
import { randomUUID as randomUUID2 } from "node:crypto";
import {
  LlmAdapter,
  LlmError
} from "@deepseek-ai/dsh-llm";

// src/trae/debug.ts
function traeAppName(cn, ide = false) {
  return cn ? ide ? "TraeCode CN" : "TraeWork CN" : ide ? "TraeCode" : "TraeWork";
}
var TRAE_APP_VERSION = "0.1.61";
function isCnHost(host) {
  try {
    return /\.cn$/i.test(new URL(host).hostname);
  } catch {
    return /\.cn(?:[/:]|$)/i.test(host);
  }
}
var DEBUG_MISSING = {
  user: "no_uid",
  trace: "no_trace",
  message: "no_mid",
  sid: "no_sid",
  ppe: "no_ppe"
};
var TRACE_HEADERS = ["x-tt-logid", "x-tt-trace-id", "x-trace-id", "x-request-id"];
function traeDebugTime(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function traeDebugLine(parts2) {
  const region = parts2.region ? `${parts2.region}.` : "";
  const user = parts2.userId || DEBUG_MISSING.user;
  const trace = parts2.traceId || DEBUG_MISSING.trace;
  const message = parts2.messageId || DEBUG_MISSING.message;
  const reply = parts2.replyId || DEBUG_MISSING.message;
  const app = `${parts2.appName}.${parts2.appVersion}.${parts2.slardarSid || DEBUG_MISSING.sid}.${parts2.ppe || DEBUG_MISSING.ppe}`;
  const time = parts2.at === void 0 ? "" : `.T(${traeDebugTime(parts2.at)})`;
  return `${region}${user}:${trace}_${parts2.sessionId}.${message}.${reply}:${app}${time}`;
}
function traceOf(headers, sent) {
  for (const name2 of TRACE_HEADERS) {
    const value = headers.get(name2);
    if (value) return value;
  }
  return sent;
}

// src/trae/catalog.ts
var LIGHT_HIGH = ["light", "high"];
var LIGHT_HIGH_EXTRA = ["light", "high", "extra_high"];
var HIGH_EXTRA = ["high", "extra_high"];
var NONE = [];
var MAX_1M = 1e6;
var TRAE_MODELS = [
  // The Doubao family has no Max: each ships a `__max` key whose window is the
  // same as the standard one, and the live catalog flags `max_mode: false`.
  // Their output cap is 16K rather than the 32K every other standard route gets.
  { id: "Doubao-Seed-Evolving", configName: "Doubao-Seed-Evolving", key: "Doubao-Seed-Evolving__dev", contextWindow: 184e3, efforts: LIGHT_HIGH, defaultEffort: "high", outputTokens: 16e3, multimodal: true },
  { id: "Doubao-Seed-2.1-Pro-0915", configName: "Doubao-Seed-2.1-pro", key: "Doubao-Seed-2.1-pro__dev", contextWindow: 2e5, efforts: LIGHT_HIGH, defaultEffort: "high", multimodal: true },
  { id: "Doubao-Seed-2.1-Turbo", configName: "Doubao-Seed-2.1-turbo", key: "Doubao-Seed-2.1-turbo__dev", contextWindow: 2e5, efforts: LIGHT_HIGH, defaultEffort: "high", multimodal: true },
  { id: "Doubao-Seed-2.0-Code", configName: "Doubao-Seed-2.0-Code", key: "Doubao-Seed-2.0-Code__dev", contextWindow: 184e3, efforts: LIGHT_HIGH, defaultEffort: "high", outputTokens: 16e3, multimodal: true },
  { id: "Doubao-Seed-Code", configName: "Doubao_1_6", key: "Doubao_1_6__dev", contextWindow: 184e3, efforts: NONE, outputTokens: 16e3, multimodal: true },
  { id: "GLM-5.3-FlashX", configName: "glm-5.3-flashx", key: "glm-5.3-flashx__dev", contextWindow: 2e5, efforts: LIGHT_HIGH_EXTRA, defaultEffort: "high", max: { key: "glm-5.3-flashx__max", contextWindow: MAX_1M }, multimodal: true },
  { id: "Step-5-Preview", configName: "step-5-preview", key: "step-5-preview__dev", contextWindow: 2e5, efforts: LIGHT_HIGH, defaultEffort: "high", max: { key: "step-5-preview__max", contextWindow: MAX_1M }, multimodal: true },
  { id: "GLM-5.3-Flash", configName: "glm-5.3-flash", key: "glm-5.3-flash__dev", contextWindow: 2e5, efforts: LIGHT_HIGH_EXTRA, defaultEffort: "high", max: { key: "glm-5.3-flash__max", contextWindow: MAX_1M }, multimodal: true },
  { id: "GLM-5.3", configName: "glm-5.3", key: "glm-5.3__dev", contextWindow: 2e5, efforts: LIGHT_HIGH_EXTRA, defaultEffort: "high", max: { key: "glm-5.3__max", contextWindow: MAX_1M }, multimodal: false },
  { id: "GLM-5.2", configName: "glm-5.2", key: "glm-5.2__dev", contextWindow: 2e5, efforts: HIGH_EXTRA, defaultEffort: "high", max: { key: "glm-5.2__max", contextWindow: MAX_1M }, multimodal: false },
  { id: "MiniMax-M3", configName: "minimax-m3", key: "minimax-m3__dev", contextWindow: 2e5, efforts: NONE, max: { key: "minimax-m3__max", contextWindow: MAX_1M }, multimodal: true },
  { id: "MiniMax-M2.7", configName: "minimax-m2.7", key: "minimax-m2.7__dev", contextWindow: 2e5, efforts: NONE, multimodal: false },
  { id: "Qwen3.8-Max", configName: "qwen3.8-max", key: "qwen3.8-max__dev", contextWindow: 2e5, efforts: LIGHT_HIGH_EXTRA, defaultEffort: "high", max: { key: "qwen3.8-max__max", contextWindow: MAX_1M }, multimodal: true },
  { id: "Kimi-K2.8-Preview", configName: "kimi-k2.8-preview", key: "kimi-k2.8-preview__dev", contextWindow: 2e5, efforts: LIGHT_HIGH_EXTRA, defaultEffort: "extra_high", max: { key: "kimi-k2.8-preview__max", contextWindow: MAX_1M }, multimodal: true },
  { id: "Kimi-K3", configName: "kimi-k3", key: "kimi-k3__dev", contextWindow: 2e5, efforts: LIGHT_HIGH_EXTRA, defaultEffort: "extra_high", max: { key: "kimi-k3__max", contextWindow: MAX_1M }, multimodal: true },
  { id: "MiMo-V2.6-Pro", configName: "mimo-v2.6-pro", key: "mimo-v2.6-pro__dev", contextWindow: 2e5, efforts: NONE, max: { key: "mimo-v2.6-pro__max", contextWindow: MAX_1M }, multimodal: true },
  { id: "MiMo-V2.6-Flash", configName: "mimo-v2.6-flash", key: "mimo-v2.6-flash__dev", contextWindow: 2e5, efforts: NONE, max: { key: "mimo-v2.6-flash__max", contextWindow: MAX_1M }, multimodal: true },
  { id: "DeepSeek-V4.1-Flash", configName: "DeepSeek-V4.1-Flash", key: "DeepSeek-V4.1-Flash__dev", contextWindow: 2e5, efforts: LIGHT_HIGH_EXTRA, defaultEffort: "high", max: { key: "DeepSeek-V4.1-Flash__max", contextWindow: MAX_1M }, multimodal: true },
  { id: "DeepSeek-V4-Pro \u6B63\u5F0F\u7248", configName: "DeepSeek-V4-Pro-Official", key: "DeepSeek-V4-Pro-Official__dev", contextWindow: 2e5, efforts: LIGHT_HIGH_EXTRA, defaultEffort: "high", max: { key: "DeepSeek-V4-Pro-Official__max", contextWindow: MAX_1M }, multimodal: false },
  { id: "DeepSeek-V4-Flash \u6B63\u5F0F\u7248", configName: "DeepSeek-V4-Flash-Official", key: "deepseek_v4_flash_official__dev", contextWindow: 2e5, efforts: LIGHT_HIGH_EXTRA, defaultEffort: "high", max: { key: "deepseek_v4_flash_official__max", contextWindow: MAX_1M }, multimodal: false }
];
var EFFORT_NAMES = {
  light: "Light \u8F7B",
  low: "Low \u8F7B",
  medium: "Medium \u4E2D",
  high: "High \u9AD8",
  extra_high: "Extra High \u6781\u9AD8",
  xhigh: "Extra High \u6781\u9AD8",
  max: "Max \u6700\u9AD8"
};
function toRoutes(models) {
  return models.map((model) => {
    const max = model.max;
    return {
      id: model.id,
      configName: model.configName,
      // Without a `max_key`, Max keeps the standard key and rides the marker.
      key: max?.key ?? model.key,
      contextWindow: max?.contextWindow ?? model.contextWindow,
      efforts: model.efforts,
      ...model.defaultEffort ? { defaultEffort: model.defaultEffort } : {},
      maxMode: max !== void 0,
      maxMarker: max !== void 0 && max.key === void 0,
      multimodal: model.multimodal ?? false,
      ...model.wireFunction ? { wireFunction: model.wireFunction } : {},
      ...(max ? max.outputTokens : model.outputTokens) !== void 0 ? { outputTokens: max ? max.outputTokens : model.outputTokens } : {}
    };
  });
}
var TRAE_ROUTES = toRoutes(TRAE_MODELS);
function indexRoutes(models, routes) {
  const byId = /* @__PURE__ */ new Map();
  for (const route of routes) {
    const model = models.find((m) => m.configName === route.configName);
    for (const alias of [route.id, route.configName, route.key, model?.key]) {
      if (!alias) continue;
      byId.set(alias, route);
      byId.set(alias.toLowerCase(), route);
    }
  }
  return byId;
}
var builtinIndex = indexRoutes(TRAE_MODELS, TRAE_ROUTES);

// src/trae/catalog-source.ts
import { homedir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
var CATALOG_PATH = "/api/ide/v1/batch_get_detail_param";
var CHAT_FUNCTION = "chat";
var EXTRA_CATALOG_FUNCTIONS = ["solo_work_remote", "solo_work_lite", "solo_coder", "chat_v3"];
function catalogBody(functions) {
  return {
    functions: [...functions],
    agent_type: "chat",
    current_config_info: { config_name: "", is_custom_model: false },
    mode_type: 0,
    access_type: 4,
    ab_force_vids: "",
    ab_autotest_advanced_mode: 0,
    show_custom_model: true
  };
}
var CATALOG_BODY = catalogBody([CHAT_FUNCTION]);
var MODELS_CACHE_FILE = join(homedir(), ".trae", "cli", "models_cache.json");
var NOT_MODELS = /* @__PURE__ */ new Set(["summary", "custom_model_placeholder"]);
var EFFORT_NAMES2 = /* @__PURE__ */ new Set(["light", "low", "medium", "high", "extra_high", "xhigh", "max"]);
function asEffort(value) {
  return typeof value === "string" && EFFORT_NAMES2.has(value) ? value : void 0;
}
function record(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function array(value) {
  return Array.isArray(value) ? value : [];
}
function positive(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : void 0;
}
var BUILTIN_MULTIMODAL = new Map(TRAE_MODELS.map((m) => [m.configName.toLowerCase(), m.multimodal ?? false]));
function parseDetailParams(payload2, functions) {
  const root = record(payload2);
  const groups = array(root?.function_configs).map(record).filter((fc) => !!fc);
  const rank = (name2) => {
    const at2 = functions?.indexOf(name2) ?? -1;
    return at2 < 0 ? Number.MAX_SAFE_INTEGER : at2;
  };
  const ordered = functions ? [...groups].sort((a, b) => rank(String(a.function)) - rank(String(b.function))) : groups;
  const configs = ordered.flatMap((fc) => {
    const fn = typeof fc.function === "string" ? fc.function : CHAT_FUNCTION;
    return array(fc.config_info_list).map(record).map((config) => ({ fn, config }));
  });
  const models = [];
  const seen = /* @__PURE__ */ new Set();
  for (const { fn, config } of configs) {
    if (!config) continue;
    const configName = typeof config.config_name === "string" ? config.config_name : "";
    if (!configName || NOT_MODELS.has(configName)) continue;
    if (config.config_switch === false || config.is_invisible_to_user === true) continue;
    if (seen.has(configName.toLowerCase())) continue;
    const display = record(config.display_config) ?? {};
    if (display.is_custom_model === true) continue;
    const details = array(config.model_detail_list).map(record).filter((d) => !!d);
    const standard = details.find((d) => String(d.model_name).endsWith("__dev")) ?? details[0];
    const standardKey = typeof standard?.model_name === "string" ? standard.model_name : "";
    if (!standardKey) continue;
    const maxDetail = details.find((d) => String(d.model_name).endsWith("__max"));
    const windows = record(config.context_window_tokens) ?? {};
    const standardWindow = positive(windows.dev) ?? positive(standard?.prompt_max_tokens) ?? 2e5;
    const maxWindow = positive(windows.max);
    const reasoning = record(config.reasoning_effort_config) ?? {};
    const efforts = reasoning.support_thinking === false ? [] : array(reasoning.options).map((option) => asEffort(record(option)?.level ?? option)).filter((e) => !!e);
    const defaultEffort = asEffort(reasoning.default_level);
    const id = typeof display.display_name === "string" && display.display_name ? display.display_name : configName;
    const model = {
      id,
      configName,
      key: standardKey,
      contextWindow: standardWindow,
      efforts,
      ...defaultEffort && efforts.includes(defaultEffort) ? { defaultEffort } : {},
      multimodal: display.multimodal === true,
      ...positive(standard?.max_tokens) !== void 0 ? { outputTokens: positive(standard?.max_tokens) } : {},
      // `chat` is what the request names anyway, so only a model shelved
      // elsewhere carries a pin.
      ...fn && fn !== CHAT_FUNCTION ? { wireFunction: fn } : {}
    };
    if (display.max_mode === true && maxDetail && maxWindow !== void 0 && maxWindow > standardWindow) {
      model.max = {
        key: typeof maxDetail.model_name === "string" ? maxDetail.model_name : standardKey,
        contextWindow: maxWindow,
        ...positive(maxDetail.max_tokens) !== void 0 ? { outputTokens: positive(maxDetail.max_tokens) } : {}
      };
    }
    models.push(model);
    seen.add(configName.toLowerCase());
  }
  return models;
}
function parseModelsCache(payload2) {
  const root = record(payload2);
  const models = [];
  for (const raw of array(root?.models)) {
    const entry = record(raw);
    if (!entry) continue;
    if (entry.visibility !== void 0 && entry.visibility !== "list") continue;
    if (entry.supported_in_api === false) continue;
    const configName = typeof entry.config_name === "string" ? entry.config_name : "";
    const business = record(entry.business_metadata) ?? {};
    const variants = record(business.variants) ?? {};
    const standardKey = typeof variants.standard_key === "string" ? variants.standard_key : "";
    if (!configName || !standardKey) continue;
    const spelling = record(business.trae_reasoning_effort_levels) ?? {};
    const rung = (value) => {
      const level = typeof value === "string" ? value : "";
      return asEffort(spelling[level]) ?? asEffort(level);
    };
    const efforts = array(variants.standard_supported_reasoning_levels ?? entry.supported_reasoning_levels).map((option) => rung(record(option)?.effort ?? option)).filter((e) => !!e);
    const defaultEffort = rung(variants.standard_default_reasoning_level ?? entry.default_reasoning_level);
    const standardWindow = positive(variants.standard_context_window) ?? positive(entry.context_window) ?? 2e5;
    const maxKey = typeof variants.max_key === "string" ? variants.max_key : "";
    const maxWindow = positive(variants.max_context_window) ?? positive(entry.max_context_window);
    const model = {
      id: typeof entry.slug === "string" && entry.slug ? entry.slug : configName,
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
      multimodal: BUILTIN_MULTIMODAL.get(configName.toLowerCase()) ?? false
    };
    if (maxKey && maxWindow !== void 0 && maxWindow > standardWindow) {
      model.max = { key: maxKey, contextWindow: maxWindow };
    }
    models.push(model);
  }
  return models;
}
function snapshot(models, origin, at2, note) {
  const routes = toRoutes(models);
  const index = indexRoutes(models, routes);
  return {
    routes,
    origin,
    at: at2,
    ...note ? { note } : {},
    find: (id) => index.get(id) ?? index.get(id.toLowerCase())
  };
}
var BUILTIN_SNAPSHOT = snapshot(TRAE_MODELS, "builtin", 0);
var FETCH_TIMEOUT_MS = 15e3;
var READY_WAIT_MS = 15e3;
var RETRY_AFTER_MS = 6e4;
var RETRY_NO_CREDENTIAL_MS = 5e3;
var MISSING_CREDENTIAL = "MISSING_CREDENTIAL";
var TraeCatalog = class {
  constructor(opts = {}) {
    this.opts = opts;
  }
  current = BUILTIN_SNAPSHOT;
  inflight;
  /**
   * When `ready()` may ask again: undefined before the first refresh (and
   * after a reset), Infinity once upstream has answered or the mode never asks
   * it, otherwise the end of the fallback's cooldown.
   */
  retryAt;
  /** The newest snapshot, without waiting for a refresh. */
  get snapshot() {
    return this.current;
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
  ready(signal) {
    if (this.retryAt !== void 0 && Date.now() < this.retryAt) return Promise.resolve(this.current);
    return this.race(this.refresh(), signal);
  }
  /** The refresh, the wait deadline and the caller's stop, whichever lands first. */
  race(attempt, signal) {
    const wait = this.opts.readyWaitMs ?? READY_WAIT_MS;
    if (wait <= 0 && !signal) return attempt;
    return new Promise((resolve, reject) => {
      let settled = false;
      const land = (run) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        run();
      };
      const onAbort = () => land(() => reject(signal?.reason ?? new Error("aborted")));
      const timer = wait > 0 ? setTimeout(() => land(() => {
        this.opts.logger?.warn(`dsh-trae2api: \u6A21\u578B\u76EE\u5F55 ${Math.round(wait / 1e3)} \u79D2\u6CA1\u6709\u56DE\u6765\uFF0C\u672C\u8F6E\u5148\u7528\u73B0\u6709\u7684\u90A3\u4EFD\uFF08${this.current.origin}\uFF09`);
        resolve(this.current);
      }), wait) : void 0;
      timer?.unref?.();
      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener("abort", onAbort, { once: true });
      attempt.then((next) => land(() => resolve(next)), () => land(() => resolve(this.current)));
    });
  }
  /** Re-ask the sources now. Never downgrades a good snapshot on failure. */
  refresh(force = false) {
    if (this.inflight && !force) return this.inflight;
    const attempt = this.load().then(({ next, retryIn }) => {
      if (next) this.current = next;
      this.retryAt = retryIn === void 0 || this.current.origin === "upstream" ? Infinity : Date.now() + retryIn;
      return this.current;
    }).finally(() => {
      if (this.inflight === attempt) this.inflight = void 0;
    });
    this.inflight = attempt;
    return attempt;
  }
  /** Next `ready()` asks again (the PAT changed, so the old answer may be wrong). */
  reset() {
    this.retryAt = void 0;
    this.inflight = void 0;
  }
  /**
   * One pass over the sources. `next` is the snapshot to serve (undefined =
   * keep the current one); `retryIn` is how long until upstream is worth
   * asking again, undefined when this answer settles the catalog.
   */
  async load() {
    const mode = this.opts.mode ?? "auto";
    if (mode === "builtin") return { next: BUILTIN_SNAPSHOT };
    const notes = [];
    let retryIn;
    if ((mode === "auto" || mode === "upstream") && this.opts.fetchUpstream) {
      retryIn = this.opts.retryAfterMs ?? RETRY_AFTER_MS;
      try {
        const timeout = this.opts.fetchTimeoutMs ?? FETCH_TIMEOUT_MS;
        const fetchUpstream = this.opts.fetchUpstream;
        const models = parseDetailParams(
          await fetchUpstream(AbortSignal.timeout(timeout), catalogBody([CHAT_FUNCTION])),
          [CHAT_FUNCTION]
        );
        const extras = (this.opts.functions ?? [CHAT_FUNCTION]).filter((fn) => fn && fn !== CHAT_FUNCTION);
        const added = [];
        if (extras.length > 0) {
          try {
            const answer = await fetchUpstream(AbortSignal.timeout(timeout), catalogBody(extras));
            const known = new Set(models.map((m) => m.configName.toLowerCase()));
            for (const model of parseDetailParams(answer, extras)) {
              if (known.has(model.configName.toLowerCase())) continue;
              known.add(model.configName.toLowerCase());
              added.push(model);
            }
            if (added.length > 0) {
              const by = /* @__PURE__ */ new Map();
              for (const model of added) {
                const fn = model.wireFunction ?? CHAT_FUNCTION;
                by.set(fn, (by.get(fn) ?? 0) + 1);
              }
              const where = [...by].map(([fn, n]) => `${fn} ${n} \u4E2A`).join("\u3001");
              this.opts.logger?.info(`dsh-trae2api: \u53E6\u6709 ${added.length} \u4E2A\u6A21\u578B\u53EA\u5728\u989D\u5916\u901A\u9053\u4E0A\u67B6\uFF08${where}\uFF09\uFF0C\u5DF2\u5E76\u5165\u76EE\u5F55`);
            }
          } catch (error) {
            this.opts.logger?.warn(
              `dsh-trae2api: \u989D\u5916\u6A21\u578B\u901A\u9053\uFF08${extras.join("\u3001")}\uFF09\u6CA1\u95EE\u5230\uFF0C\u672C\u6B21\u53EA\u7528 chat \u901A\u9053\u7684\u76EE\u5F55\uFF08${error instanceof Error ? error.message : String(error)}\uFF09`
            );
          }
        }
        const merged = [...models, ...added];
        if (merged.length > 0) {
          this.opts.logger?.info(`dsh-trae2api: \u6A21\u578B\u76EE\u5F55\u5DF2\u4ECE\u4E0A\u6E38\u5237\u65B0\uFF0C\u5171 ${merged.length} \u4E2A\u6A21\u578B`);
          return { next: snapshot(merged, "upstream", Date.now()) };
        }
        notes.push("\u4E0A\u6E38\u76EE\u5F55\u6CA1\u6709\u8FD4\u56DE\u53EF\u7528\u6A21\u578B");
      } catch (error) {
        if (error?.code === MISSING_CREDENTIAL) {
          retryIn = this.opts.retryNoCredentialMs ?? RETRY_NO_CREDENTIAL_MS;
        }
        notes.push(`\u4E0A\u6E38\u76EE\u5F55\u62C9\u53D6\u5931\u8D25\uFF08${error instanceof Error ? error.message : String(error)}\uFF09`);
      }
    }
    const retry = (next) => ({ ...next ? { next } : {}, ...retryIn === void 0 ? {} : { retryIn } });
    const cacheFile = this.opts.cacheFile ?? MODELS_CACHE_FILE;
    if ((mode === "auto" || mode === "cache") && cacheFile) {
      try {
        const read = this.opts.readCacheFile ?? ((file) => readFile(file, "utf8"));
        const models = parseModelsCache(JSON.parse(await read(cacheFile)));
        if (models.length > 0) {
          const note2 = notes.join("\uFF1B");
          const again = retryIn === void 0 ? "" : `\uFF0C${Math.round(retryIn / 1e3)} \u79D2\u540E\u518D\u8BD5\u4E0A\u6E38`;
          this.opts.logger?.info(`dsh-trae2api: \u6A21\u578B\u76EE\u5F55\u53D6\u81EA traecli \u7F13\u5B58 ${cacheFile}\uFF0C\u5171 ${models.length} \u4E2A\u6A21\u578B${note2 ? `\uFF08${note2}${again}\uFF09` : ""}`);
          return retry(snapshot(models, "cache", Date.now(), note2 || void 0));
        }
        notes.push(`${cacheFile} \u91CC\u6CA1\u6709\u53EF\u7528\u6A21\u578B`);
      } catch (error) {
        notes.push(`\u8BFB\u53D6 ${cacheFile} \u5931\u8D25\uFF08${error instanceof Error ? error.message : String(error)}\uFF09`);
      }
    }
    const note = notes.join("\uFF1B");
    if (this.current.origin !== "builtin") {
      if (note) this.opts.logger?.warn(`dsh-trae2api: \u6A21\u578B\u76EE\u5F55\u5237\u65B0\u5931\u8D25\uFF0C\u7EE7\u7EED\u7528\u4E0A\u6B21\u62FF\u5230\u7684\u90A3\u4EFD\uFF08${note}\uFF09`);
      return retry();
    }
    if (note) this.opts.logger?.warn(`dsh-trae2api: \u6A21\u578B\u76EE\u5F55\u6CBF\u7528\u63D2\u4EF6\u5185\u7F6E\u7684\u90A3\u4EFD\uFF08${note}\uFF09`);
    return retry(note ? snapshot(TRAE_MODELS, "builtin", Date.now(), note) : BUILTIN_SNAPSHOT);
  }
};

// src/trae/wire.ts
import { createHash, randomUUID } from "node:crypto";
import {
  CONTEXT_WINDOW_EXCEEDED_CODE,
  QUOTA_EXCEEDED_CODE,
  isContextWindowExceededError,
  isQuotaExceededError
} from "@deepseek-ai/dsh-llm";
function wireContent(message) {
  return message.images?.length ? [...message.content, ...message.images] : message.content;
}
function textOf(content, imageNote) {
  const parts2 = [];
  for (const block of content) {
    if (block.type === "text") parts2.push(block.text);
    else if (block.type === "image" && imageNote) parts2.push("[image omitted]");
  }
  return parts2.join("\n\n");
}
function imagePartsOf(content, images) {
  if (!images || images.size === 0) return [];
  const out = [];
  for (const block of content) {
    if (block.type !== "image") continue;
    const url = images.get(block.attachment.attachmentId);
    if (url) out.push({ type: "image_url", image_url: { url } });
  }
  return out;
}
var parts = (text) => [{ type: "text", text }];
function rawMessages(options, images) {
  const out = [];
  if (options.system) out.push({ role: "system", content: parts(options.system) });
  for (const message of options.messages) {
    switch (message.role) {
      case "system":
      case "developer": {
        const text = textOf(message.content, false);
        if (text) out.push({ role: "system", content: parts(text) });
        break;
      }
      case "user": {
        const imageParts = imagePartsOf(message.content, images);
        out.push({
          role: "user",
          content: parts(textOf(message.content, imageParts.length === 0)),
          ...imageParts.length ? { images: imageParts } : {}
        });
        break;
      }
      case "assistant": {
        const text = textOf(message.content, false);
        const calls = message.content.filter((b) => b.type === "tool-call").map((b, index) => ({
          id: String(b.id),
          index,
          type: "function",
          function_call: { name: b.name, arguments: b.arguments || "{}" }
        }));
        if (!text && calls.length === 0) break;
        out.push({ role: "assistant", content: text ? parts(text) : [], ...calls.length ? { tool_calls: calls } : {} });
        break;
      }
      case "tool":
        out.push({
          role: "tool",
          tool_call_id: String(message.toolCallId),
          // Upstream takes images on user turns only, never on a tool result.
          content: parts(textOf(message.content, true) || (message.isError ? "error" : ""))
        });
        break;
      default:
        break;
    }
  }
  return out;
}
var plain = (m) => m.content.map((p) => p.text).join("\n");
function demote(result) {
  const text = plain(result);
  return { role: "user", content: parts(text ? `[result of an earlier tool call]
${text}` : "[an earlier tool call returned nothing]") };
}
function repairToolHistory(messages) {
  const out = [];
  let i = 0;
  while (i < messages.length) {
    const msg = messages[i];
    if (msg.role === "tool") {
      out.push(demote(msg));
      i++;
      continue;
    }
    if (msg.role !== "assistant" || !msg.tool_calls?.length) {
      out.push(msg);
      i++;
      continue;
    }
    let end = i + 1;
    while (end < messages.length && messages[end].role === "tool") end++;
    const unused = msg.tool_calls.map((c) => c.id).filter(Boolean);
    const answered = /* @__PURE__ */ new Set();
    const results = [];
    const demoted = [];
    for (let result of messages.slice(i + 1, end)) {
      let id = result.tool_call_id ?? "";
      if (!id && unused.length) {
        id = unused[0];
        result = { ...result, tool_call_id: id };
      }
      const at2 = unused.indexOf(id);
      if (at2 >= 0) {
        unused.splice(at2, 1);
        answered.add(id);
        results.push(result);
      } else demoted.push(demote(result));
    }
    const kept = msg.tool_calls.filter((c) => answered.has(c.id)).map((c, index) => ({ ...c, index }));
    const dropped = msg.tool_calls.filter((c) => !answered.has(c.id));
    if (dropped.length) {
      const note = dropped.map((c) => `[called tool ${c.function_call.name} with ${c.function_call.arguments}]`).join("\n");
      const text = plain(msg);
      out.push({ role: "assistant", content: parts(text ? `${text}
${note}` : note), ...kept.length ? { tool_calls: kept } : {} });
    } else {
      out.push(msg);
    }
    out.push(...results, ...demoted);
    i = end;
  }
  return out.map((m) => m.content.length === 0 && !m.tool_calls?.length ? { ...m, content: parts("") } : m);
}
function toTraeMessages(options, images = void 0) {
  return repairToolHistory(rawMessages(options, images));
}
var SCHEMA_CHILDREN = ["items", "additionalProperties", "not", "if", "then", "else", "contains", "propertyNames"];
var SCHEMA_LISTS = ["anyOf", "oneOf", "allOf", "prefixItems"];
var SCHEMA_MAPS = ["properties", "patternProperties", "$defs", "definitions"];
function isSchemaObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function normalizeToolSchema(schema) {
  if (Array.isArray(schema)) return schema.map(normalizeToolSchema);
  if (!isSchemaObject(schema)) return schema;
  const out = { ...schema };
  const promoted = [];
  for (const key of SCHEMA_MAPS) {
    const map = out[key];
    if (!isSchemaObject(map)) continue;
    const next = {};
    for (const [name2, child] of Object.entries(map)) {
      if (isSchemaObject(child) && "required" in child && typeof child.required === "boolean") {
        const { required, ...rest } = child;
        if (required && key === "properties") promoted.push(name2);
        next[name2] = normalizeToolSchema(rest);
        continue;
      }
      next[name2] = normalizeToolSchema(child);
    }
    out[key] = next;
  }
  for (const key of SCHEMA_CHILDREN) {
    if (key in out) out[key] = normalizeToolSchema(out[key]);
  }
  for (const key of SCHEMA_LISTS) {
    if (Array.isArray(out[key])) out[key] = out[key].map(normalizeToolSchema);
  }
  if (promoted.length > 0) {
    const existing = Array.isArray(out.required) ? out.required.filter((n) => typeof n === "string") : [];
    out.required = [.../* @__PURE__ */ new Set([...existing, ...promoted])];
  } else if (typeof out.required === "boolean") {
    delete out.required;
  }
  return out;
}
function normalizeToolSchemas(tools) {
  return (tools ?? []).map((t) => ({ ...t, parameters: normalizeToolSchema(t.parameters ?? {}) }));
}
function toTraeTools(tools) {
  return normalizeToolSchemas(tools).map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: JSON.stringify(t.parameters ?? {}) }
  }));
}
var SESSION_NAMESPACE = "1b9a4f0e-6c2d-5e73-9a41-0d8b3f7c2a56";
function sessionUuid(sessionId) {
  if (!sessionId) return randomUUID();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId)) return sessionId.toLowerCase();
  const hex = createHash("sha1").update(SESSION_NAMESPACE).update(sessionId).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = (parseInt(hex[16], 16) & 3 | 8).toString(16);
  const h = hex.join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
function conversationUuid(sessionId, modelKey, effort) {
  if (!sessionId) return randomUUID();
  return sessionUuid(`${sessionId}\0${modelKey}\0${effort ?? ""}`);
}
async function* traeEvents(body) {
  const decoder = new TextDecoder();
  const reader = body.getReader();
  let buffer = "";
  let event;
  const take = (line) => {
    line = line.replace(/\r$/, "");
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
      return void 0;
    }
    if (!line.startsWith("data:")) return void 0;
    const payload2 = line.slice(5).trim();
    if (!payload2 || payload2 === "[DONE]") return void 0;
    try {
      const parsed = JSON.parse(payload2);
      const data = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : { value: parsed };
      return { event: event ?? "message", data };
    } catch {
      return void 0;
    }
  };
  try {
    for (; ; ) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const ev = take(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
        if (ev) yield ev;
      }
    }
    buffer += decoder.decode();
    if (buffer) {
      const ev = take(buffer);
      if (ev) yield ev;
    }
  } finally {
    reader.releaseLock();
  }
}
var RATE_LIMIT = ["rate limit", "rate-limit", "rate limited", "too many requests"];
var OVERLOADED = ["unavailable", "all models failed", "try again"];
var TIMED_OUT = ["timeout", "timed out", "deadline exceeded"];
var PROVIDER_STATUS = /status[ _]?code[:=]\s*(\d{3})/;
function httpCode(status, detail) {
  if (status === 401 || status === 403) return "AUTH";
  const reason = `${status} ${detail}`;
  if (isContextWindowExceededError(reason)) return CONTEXT_WINDOW_EXCEEDED_CODE;
  if (isQuotaExceededError(reason)) return QUOTA_EXCEEDED_CODE;
  if (status === 429) return "RATE_LIMIT";
  if (status === 408 || status === 504) return "TIMEOUT";
  if (status >= 500) return "SERVER";
  return "PROVIDER_HTTP_ERROR";
}
function upstreamMessage(data) {
  let detail = "";
  for (const key of ["message", "error"]) {
    const v = data[key];
    if (typeof v === "string" && v.trim()) {
      detail = v.trim();
      break;
    }
  }
  if (!detail) detail = JSON.stringify(data);
  const chain = data.model_call_chain;
  if (Array.isArray(chain)) {
    const first = chain.find((l) => l && typeof l === "object" && l.error);
    if (first) detail = `${detail}: ${String(first.error).trim()}`;
  }
  if (Number(data.code) === 4023) detail += "\uFF08\u4E0A\u6E38\u4E0D\u8BA4\u8BC6\u8FD9\u4E2A\u6A21\u578B\u540D\uFF1A\u8BE5\u6A21\u578B\u591A\u534A\u5DF2\u7ECF\u4E0B\u7EBF\uFF0C\u6216\u8005\u63D2\u4EF6\u7684\u6A21\u578B\u76EE\u5F55\u548C x-ide-version-code \u4E0D\u540C\u4EE3\u3002\u5BF9\u7167 ~/.trae/cli/models_cache.json \u91CC\u73B0\u5728\u8FD8\u5728\u7684\u6A21\u578B\uFF09";
  return detail.replace(/\n/g, " ").slice(0, 400);
}
function classify(data) {
  const detail = upstreamMessage(data);
  const reason = detail.toLowerCase();
  const code = Number(data.code) || 0;
  const joined = `${code || ""} ${String(data.type ?? "")} ${detail}`;
  if (isContextWindowExceededError(joined)) return { code: CONTEXT_WINDOW_EXCEEDED_CODE, retryable: false };
  if (isQuotaExceededError(joined)) return { code: QUOTA_EXCEEDED_CODE, retryable: false };
  const m = PROVIDER_STATUS.exec(reason);
  const status = m ? Number(m[1]) : void 0;
  if (status !== void 0 && status >= 400 && status <= 599) {
    if (status === 429) return { code: "RATE_LIMIT", retryable: true };
    if (status === 408 || status === 504) return { code: "TIMEOUT", retryable: true };
    if (status < 500) return { code: "INVALID_REQUEST", retryable: false };
    return { code: "SERVER", retryable: true };
  }
  if (RATE_LIMIT.some((x) => reason.includes(x))) return { code: "RATE_LIMIT", retryable: true };
  if (TIMED_OUT.some((x) => reason.includes(x))) return { code: "TIMEOUT", retryable: true };
  if (code === 3003 || OVERLOADED.some((x) => reason.includes(x))) return { code: "SERVER", retryable: true };
  if (code === 4023) return { code: "MODEL_NOT_FOUND", retryable: false };
  if (code === 4001) return { code: "INVALID_REQUEST", retryable: false };
  return { code: "PROVIDER_ERROR", retryable: false };
}
var WIDE_CHAR_START = 11904;
function approxTokens(text) {
  let wide = 0;
  for (const ch of text) if (ch.codePointAt(0) >= WIDE_CHAR_START) wide++;
  return wide + Math.ceil((text.length - wide) / 4);
}
var LoopDetector = class {
  constructor(span = 600, maxUnit = 32, minRepeats = 10) {
    this.span = span;
    this.maxUnit = maxUnit;
    this.minRepeats = minRepeats;
  }
  tail = "";
  since = 0;
  add(text) {
    if (!this.span || !text) return false;
    this.tail = (this.tail + text).slice(-Math.max(this.span * 2, 256));
    this.since += text.length;
    if (this.since < 64) return false;
    this.since = 0;
    const tail = this.tail;
    for (let unit = 1; unit <= this.maxUnit && unit * this.minRepeats <= tail.length; unit++) {
      const piece = tail.slice(-unit);
      let repeats = 1;
      while ((repeats + 1) * unit <= tail.length && tail.slice(-(repeats + 1) * unit, -repeats * unit) === piece) repeats++;
      if (repeats >= this.minRepeats && repeats * unit >= this.span) return true;
    }
    return false;
  }
};
var INVOKE_OPEN = /<invoke\s+name=["']([^"']+)["']\s*>/i;
var PARAMETER = /<parameter\s+name=["']([^"']+)["']\s*>([\s\S]*?)<\/parameter>/gi;
var INVOKE_CLOSE = "</invoke>";
var WRAPPERS = ["<tool_calls>", "</tool_calls>"];
var STARTS = [...WRAPPERS, "<invoke"];
var LONGEST = Math.max(...STARTS.map((s) => s.length));
var BACKTICK_HOLD = 16;
function unescapeHtml(s) {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
}
function coerce(raw, schema) {
  const text = unescapeHtml(raw).replace(/^\n/, "").replace(/\n$/, "");
  const kind = schema?.type;
  if (kind === "integer" || kind === "number") {
    const n = kind === "integer" ? Number.parseInt(text, 10) : Number.parseFloat(text);
    return Number.isFinite(n) && String(n) !== "NaN" && /^-?\d/.test(text.trim()) ? n : text;
  }
  if (kind === "boolean") {
    const l = text.trim().toLowerCase();
    return l === "true" ? true : l === "false" ? false : text;
  }
  if (kind === "array" || kind === "object") {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}
var CodeScanner = class {
  /** Backticks that opened the fence currently open; 0 = none. */
  fence = 0;
  /** Backticks that opened the inline span currently open; 0 = none. */
  span = 0;
  /** Nothing but whitespace since the last newline. */
  blank = true;
  /** Whether the next character sits inside a fence or an inline span. */
  get inCode() {
    return this.fence > 0 || this.span > 0;
  }
  /** Track `text`. It must not split a backtick run (see `BACKTICK_HOLD`). */
  push(text) {
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === "\n") {
        this.blank = true;
        this.span = 0;
        continue;
      }
      if (ch !== "`") {
        if (ch !== " " && ch !== "	" && ch !== "\r") this.blank = false;
        continue;
      }
      let run = 1;
      while (i + run < text.length && text[i + run] === "`") run++;
      i += run - 1;
      const atLineStart = this.blank;
      this.blank = false;
      if (this.fence > 0) {
        if (run >= this.fence && atLineStart) this.fence = 0;
      } else if (this.span > 0) {
        if (run === this.span) this.span = 0;
      } else if (run >= 3 && atLineStart) {
        this.fence = run;
      } else {
        this.span = run;
      }
    }
  }
};
var TextToolCallSniffer = class {
  constructor(schemas, enabled = true) {
    this.schemas = schemas;
    this.enabled = enabled;
  }
  buffer = "";
  capturing = false;
  /** Set once a candidate is seen: everything after it waits for `flush`. */
  deferred;
  code = new CodeScanner();
  get off() {
    return !this.enabled || this.schemas.size === 0;
  }
  /** Visible text for this delta. Calls are only ever decided by `flush`. */
  feed(text) {
    if (this.off || !text) return text;
    this.buffer += text;
    const visible = [];
    while (this.step(visible)) {
    }
    return visible.join("");
  }
  /**
   * End of the answer. `allowRecovery` is the caller's veto: pass false when
   * the turn already produced native tool calls.
   */
  flush(allowRecovery = true) {
    if (this.off) {
      const rest2 = this.buffer;
      this.buffer = "";
      return { visible: rest2, calls: [] };
    }
    const visible = [];
    while (this.step(visible)) {
    }
    const rest = this.buffer;
    this.buffer = "";
    this.capturing = false;
    this.emit(rest, visible);
    const pieces = this.deferred ?? [];
    this.deferred = void 0;
    const calls = pieces.flatMap((p) => p.call ? [p.call] : []);
    const recover = allowRecovery && calls.length > 0 && pieces.every((p) => p.call !== void 0 || p.visible.trim() === "");
    for (const piece of pieces) visible.push(recover ? piece.visible : piece.raw);
    return { visible: visible.join(""), calls: recover ? calls : [] };
  }
  step(visible) {
    if (this.capturing) {
      const end = this.buffer.indexOf(INVOKE_CLOSE);
      if (end < 0) return false;
      const block = this.buffer.slice(0, end + INVOKE_CLOSE.length);
      this.buffer = this.buffer.slice(end + INVOKE_CLOSE.length);
      this.capturing = false;
      this.code.push(block);
      const call = this.parse(block);
      this.record(call ? { raw: block, visible: "", call } : { raw: block, visible: block });
      return true;
    }
    let index = -1;
    let marker = "";
    for (const m of STARTS) {
      const found = this.buffer.indexOf(m);
      if (found >= 0 && (index < 0 || found < index)) {
        index = found;
        marker = m;
      }
    }
    if (index < 0) {
      const hold = this.hold();
      const release = this.buffer.slice(0, this.buffer.length - hold);
      this.buffer = this.buffer.slice(this.buffer.length - hold);
      this.emit(release, visible);
      return false;
    }
    this.emit(this.buffer.slice(0, index), visible);
    this.buffer = this.buffer.slice(index);
    if (this.code.inCode) {
      this.buffer = this.buffer.slice(marker.length);
      this.emit(marker, visible);
      return true;
    }
    if (WRAPPERS.includes(marker)) {
      this.buffer = this.buffer.slice(marker.length);
      this.record({ raw: marker, visible: "" });
      return true;
    }
    this.capturing = true;
    return true;
  }
  /** Characters held back so the next delta cannot split a marker or a run. */
  hold() {
    let ticks = 0;
    while (ticks < this.buffer.length && ticks < BACKTICK_HOLD && this.buffer.at(-1 - ticks) === "`") ticks++;
    if (ticks > 0) return ticks < BACKTICK_HOLD ? ticks : 0;
    for (let size = Math.min(this.buffer.length, LONGEST - 1); size > 0; size--) {
      if (STARTS.some((m) => m.startsWith(this.buffer.slice(-size)))) return size;
    }
    return 0;
  }
  /** Route text to the answer, or to the tail once a candidate is pending. */
  emit(text, visible) {
    if (!text) return;
    this.code.push(text);
    if (this.deferred) this.record({ raw: text, visible: text });
    else visible.push(text);
  }
  record(piece) {
    (this.deferred ??= []).push(piece);
  }
  parse(block) {
    const opened = INVOKE_OPEN.exec(block);
    if (!opened) return void 0;
    const name2 = opened[1];
    const schema = this.schemas.get(name2);
    if (!schema) return void 0;
    const properties = schema.properties ?? {};
    const args = {};
    const rest = block.slice(opened.index + opened[0].length);
    for (const m of rest.matchAll(PARAMETER)) args[m[1]] = coerce(m[2], properties[m[1]]);
    return { id: `call_${randomUUID().replace(/-/g, "").slice(0, 24)}`, name: name2, arguments: JSON.stringify(args) };
  }
};

// src/adapter.ts
var CHAT_PATH = "/api/ide/v2/llm_raw_chat";
var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function* imageRefs(options) {
  for (const message of options.messages) {
    const content = message.content ?? [];
    for (const block of content) if (block.type === "image") yield block.attachment;
  }
}
var REQUEST_IMAGE_LONG_EDGE = 1024;
var REQUEST_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
var OUTPUT_TOKENS = 32e3;
var MAX_OUTPUT_TOKENS = 64e3;
var TRACKED_SESSIONS = 64;
function traeHeaders(id, token, accept) {
  return {
    "content-type": "application/json",
    accept,
    originator: id.originator,
    "user-agent": id.userAgent,
    "x-request-id": randomUUID2(),
    authorization: `Cloud-IDE-JWT ${token}`,
    "x-app-id": id.appId,
    "x-ide-function": id.ideFunction,
    "x-ide-version": id.ideVersion,
    "x-ide-version-code": id.ideVersionCode,
    version: id.clientVersion
  };
}
var EFFORT_LADDER = [
  ["light", "low"],
  ["medium"],
  ["high"],
  ["extra_high", "xhigh"],
  ["max"]
];
var EFFORT_RUNGS = {
  none: 0,
  minimal: 0,
  light: 0,
  low: 0,
  medium: 1,
  high: 2,
  extra_high: 3,
  xhigh: 3,
  max: 4,
  ultra: 4
};
function effortFor(route, requested) {
  if (!requested || route.efforts.length === 0) return void 0;
  const lower = requested.toLowerCase();
  if (route.efforts.includes(lower)) return lower;
  const rung = EFFORT_RUNGS[lower];
  if (rung === void 0) return void 0;
  return EFFORT_LADDER[rung].find((name2) => route.efforts.includes(name2));
}
function usageOf(data) {
  const n = (k) => Number(data[k]) || 0;
  const prompt = n("prompt_tokens");
  const read = n("cache_read_input_tokens");
  const write = n("cache_creation_input_tokens");
  const out = {
    inputTokens: Math.max(0, prompt - read - write),
    outputTokens: n("completion_tokens")
  };
  if (n("total_tokens")) out.totalTokens = n("total_tokens");
  if (read) out.cacheReadTokens = read;
  if (write) out.cacheWriteTokens = write;
  if (n("reasoning_tokens")) out.reasoningTokens = n("reasoning_tokens");
  return out;
}
var TraeAdapter = class extends LlmAdapter {
  constructor(opts) {
    super();
    this.opts = opts;
  }
  /** Last variant each session ran a main-loop turn on, with that turn's upstream ids. */
  variants = /* @__PURE__ */ new Map();
  providerInfo(provider) {
    return { id: provider, name: this.opts.displayName };
  }
  /**
   * The catalog as of this plugin start, refreshed on first use. `signal` is
   * the turn's own: waiting for a model list must not outlive the stop button,
   * and `ready` itself gives up on the snapshot it has rather than hang.
   */
  catalog(signal) {
    return this.opts.catalog?.ready(signal) ?? Promise.resolve(BUILTIN_SNAPSHOT);
  }
  /**
   * The window a turn is planned against: the model's own, unless a local
   * budget caps it.
   *
   * The budget is **local**. The request body carries no window field (the Max
   * marker's `context_window_size` aside, which asks for the shelf Max opens,
   * not a budget), so lowering it cannot make upstream serve less or charge
   * less per token — it only makes the harness compact earlier, which is the
   * point: the jump from a 200K default window to Max's 1M is five times the
   * prompt, and a session that does not need 1M should not pay a full 1M
   * prompt before the first compaction. 500_000 is the half-step worth having.
   */
  budget(window) {
    const cap = this.opts.contextBudgetTokens ?? 0;
    return cap > 0 ? Math.min(window, cap) : window;
  }
  /** The picker's one-line description: the shelf, plus the budget when it bites. */
  describe(route) {
    const window = route.maxMode ? "1M \u4E0A\u4E0B\u6587\uFF08Max\uFF09" : `${Math.round(route.contextWindow / 1e3)}K \u4E0A\u4E0B\u6587`;
    const budget = this.budget(route.contextWindow);
    return budget < route.contextWindow ? `${window} \xB7 \u672C\u5730\u9884\u7B97 ${Math.round(budget / 1e3)}K` : window;
  }
  /**
   * Listing also proves the PAT works: an unconfigured or rejected PAT makes
   * the model picker show the reason instead of a silently missing group.
   */
  async listModels(provider) {
    await this.opts.auth.get();
    const { routes } = await this.catalog();
    return routes.map((r) => ({
      provider,
      id: r.id,
      name: r.id,
      description: this.describe(r),
      inputModalities: r.multimodal ? ["text", "image"] : ["text"]
    }));
  }
  async resolveModel(provider, model) {
    const known = (await this.catalog()).find(model);
    const info = {
      provider,
      id: model,
      name: known?.id ?? model,
      inputModalities: known?.multimodal ? ["text", "image"] : ["text"],
      // Per model from the catalog, so the loop plans compaction against the
      // window the backend actually enforces — or against the local budget,
      // when one caps it (see `budget`).
      context: { contextWindow: this.budget(known?.contextWindow ?? 2e5) },
      // The output half of that window: switching a route to its `__max` key
      // doubles what the backend lets the model write. llm_raw_chat itself
      // ignores `max_tokens`, so this is also the only cap `stream` can hold
      // the turn to — without it the loop sends no budget and nothing cuts a
      // runaway answer. The live catalog states the real cap per variant
      // (`model_detail_list[].max_tokens`, 16K on the Doubao family); the two
      // constants are the by-Max-ness default for a source that does not.
      defaultMaxTokens: known?.outputTokens ?? (known?.maxMode ? MAX_OUTPUT_TOKENS : OUTPUT_TOKENS)
    };
    if (known && known.efforts.length > 0) {
      info.reasoning = {
        efforts: known.efforts.map((e) => ({ id: e, name: EFFORT_NAMES[e] })),
        ...known.defaultEffort ? { defaultEffort: known.defaultEffort } : {}
      };
    }
    return info;
  }
  headers(token) {
    return traeHeaders(this.opts.identity, token, "text/event-stream");
  }
  /**
   * Remember the variant a session is running on, and say so once when it
   * changes: that turn is the first one in a new upstream conversation, so it
   * carries no server-side state from the previous model or level and pays
   * full prompt price before the cache builds up again.
   */
  noteVariant(sessionId, route, effort, conversation) {
    const current = {
      key: `${route.key}\0${effort ?? ""}`,
      label: effort ? `${route.id}\uFF08${EFFORT_NAMES[effort]}\uFF09` : route.id,
      conversation,
      model: route.id,
      ...effort ? { effort } : {},
      at: Date.now()
    };
    const previous = this.variants.get(sessionId);
    this.variants.delete(sessionId);
    this.variants.set(sessionId, current);
    while (this.variants.size > TRACKED_SESSIONS) this.variants.delete(this.variants.keys().next().value);
    if (!previous || previous.key === current.key) return;
    this.opts.logger.info(
      `dsh-trae2api: \u8FD9\u6761\u4F1A\u8BDD\u6362\u4E86\u6A21\u578B\u6216\u601D\u8003\u6863\u4F4D\uFF08${previous.label} \u2192 ${current.label}\uFF09\uFF0C\u672C\u8F6E\u8D77\u5F00\u65B0\u7684\u4E0A\u6E38\u4F1A\u8BDD\uFF1A\u4E0A\u6E38\u6309\u4F1A\u8BDD\u7ED1\u5B9A\u6A21\u578B\uFF0C\u65E7\u4F1A\u8BDD\u7684\u670D\u52A1\u7AEF\u72B6\u6001\u548C prompt \u7F13\u5B58\u90FD\u4E0D\u518D\u6CBF\u7528\u3002`
    );
  }
  /**
   * How upstream named the turn that is running, once it has answered. Kept
   * against the conversation it belongs to, so a trace arriving late for a
   * session that has since switched models is dropped rather than filed under
   * the new conversation.
   */
  noteTrace(sessionId, conversation, trace) {
    const current = this.variants.get(sessionId);
    if (current?.conversation === conversation) current.trace = trace;
  }
  /**
   * Which upstream conversation a harness session's last agent-loop turn ran
   * in, and on what. Only those turns are remembered — a title or compaction
   * request runs under its own id and would say nothing about the chat — and
   * only the most recent `TRACKED_SESSIONS` of them; everything else, and a
   * session that has not answered yet, reads as nothing.
   */
  sessionInfo(sessionId) {
    const current = this.variants.get(sessionId);
    if (!current) return void 0;
    return {
      conversation: current.conversation,
      model: current.model,
      ...current.effort ? { effort: current.effort } : {},
      ...current.trace ? { trace: current.trace } : {},
      at: current.at
    };
  }
  /**
   * One POST; yields decoded events. Retries once with a fresh JWT on 401/403.
   * `onTrace` is told how upstream names the request as soon as it answers,
   * refused turns included — that name is what a bug report is answerable by.
   */
  async *once(body, signal, onTrace) {
    let session = await this.opts.auth.get();
    for (let attempt = 0; ; attempt++) {
      let res;
      const headers = this.headers(session.token);
      try {
        res = await fetch(`${this.opts.host}${CHAT_PATH}`, { method: "POST", headers, body, signal });
      } catch (error) {
        if (signal.aborted) throw error;
        throw new LlmError(`Trae\uFF1A\u65E0\u6CD5\u8FDE\u63A5 ${this.opts.host}\uFF08${error instanceof Error ? error.message : String(error)}\uFF09`, "TRANSPORT", { cause: error });
      }
      if ((res.status === 401 || res.status === 403) && attempt === 0) {
        await res.body?.cancel();
        session = await this.opts.auth.get(true);
        continue;
      }
      if (onTrace) {
        const trace = traceOf(res.headers, headers["x-request-id"]);
        if (trace) onTrace(trace);
      }
      if (!res.ok) {
        const detail = (await res.text()).slice(0, 400);
        throw new LlmError(`Trae llm_raw_chat HTTP ${res.status}${detail ? `\uFF1A${detail}` : ""}`, httpCode(res.status, detail), { status: res.status });
      }
      if (!res.body) throw new LlmError("Trae \u8FD4\u56DE\u4E86\u7A7A\u54CD\u5E94\u4F53", "PROVIDER_PROTOCOL_ERROR");
      yield* traeEvents(res.body);
      return;
    }
  }
  /**
   * Resolve request bytes for every image occurrence on a multimodal route.
   * Failure to read one image degrades that image to its `[image omitted]`
   * note rather than failing the whole turn: a screenshot the model cannot
   * see is still more useful than a refused request.
   */
  async prepareImages(options, signal) {
    const attachments = this.opts.resolveAttachments?.();
    const map = /* @__PURE__ */ new Map();
    if (!attachments) return map;
    for (const ref of imageRefs(options)) {
      if (map.has(ref.attachmentId)) continue;
      try {
        const target = { width: REQUEST_IMAGE_LONG_EDGE, height: REQUEST_IMAGE_LONG_EDGE, maxBytes: REQUEST_IMAGE_MAX_BYTES };
        const version = await attachments.readImageRequest(ref, target, signal);
        map.set(ref.attachmentId, `data:${version.mediaType};base64,${Buffer.from(version.data).toString("base64")}`);
      } catch (error) {
        if (signal?.aborted) throw error;
        this.opts.logger.warn(`dsh-trae2api: \u8BFB\u53D6\u56FE\u7247\u5931\u8D25\uFF0C\u672C\u8F6E\u8BE5\u56FE\u4EE5\u5360\u4F4D\u6587\u672C\u53D1\u9001\uFF08${error instanceof Error ? error.message : String(error)}\uFF09`);
      }
    }
    return map;
  }
  /** The llm_raw_chat request body: one route, one thinking level, one upstream session. */
  requestBody(route, effort, session, messages, tools) {
    const body = {
      // The function upstream shelves this model under: `chat` for everything
      // traecli's own catalog call returns, the pinned one for a model only an
      // extra function listed (catalog-source.ts).
      function: route.wireFunction ?? "chat",
      config_name: route.configName,
      model_name: route.key,
      user_input: "",
      messages,
      session_id: session,
      conversation_id: session,
      // `use_prompt_cache_pool` is what buys the shared prefix cache; traecli
      // sends it on every turn, and without it each turn pays full prompt price.
      metadata: { agent_type: "chat", use_prompt_cache_pool: true },
      tools,
      mode_type: 0,
      access_type: 4
    };
    if (route.maxMarker) {
      body.model_auto_selection = { strategy: "max" };
      body.context_window_size = route.contextWindow;
    }
    if (effort) {
      body.custom_model = {
        config_name: route.configName,
        model_name: route.key,
        is_preset: true,
        use_remote_service: true,
        reasoning_effort: effort
      };
      body.reasoning_effort_level = effort;
    }
    return body;
  }
  /**
   * One tool-less completion, collected rather than streamed — for side
   * requests such as next-step choices. Runs on the route's lowest
   * thinking level under a throwaway upstream session, so it never touches
   * the conversation's own server-side state.
   */
  async complete(model, system, user, signal) {
    const route = (await this.catalog(signal)).find(model);
    if (!route) throw new LlmError(`Trae\uFF1A\u672A\u77E5\u6A21\u578B\u300C${model}\u300D`, "MODEL_NOT_FOUND");
    const messages = [
      { role: "system", content: [{ type: "text", text: system }] },
      { role: "user", content: [{ type: "text", text: user }] }
    ];
    const payload2 = JSON.stringify(this.requestBody(route, route.efforts[0], randomUUID2(), messages, []));
    let text = "";
    let error;
    for await (const ev of this.once(payload2, signal)) {
      if (ev.event === "output" && typeof ev.data.response === "string") text += ev.data.response;
      else if (ev.event === "error" || ev.event === "biz_error") error ??= ev.data;
    }
    if (!text && error) throw new LlmError(`Trae\uFF1A${upstreamMessage(error)}`, classify(error).code);
    return text;
  }
  async *stream(options) {
    const catalog = await this.catalog(options.signal);
    const route = catalog.find(options.model);
    if (!route) {
      throw new LlmError(`Trae\uFF1A\u672A\u77E5\u6A21\u578B\u300C${options.model}\u300D\u3002\u53EF\u7528\uFF1A${catalog.routes.map((r) => r.id).join("\u3001")}`, "MODEL_NOT_FOUND");
    }
    const effort = effortFor(route, options.reasoningEffort ? String(options.reasoningEffort) : void 0);
    const session = conversationUuid(options.sessionId ? String(options.sessionId) : void 0, route.key, effort);
    const mainLoop = options.sessionId !== void 0 && options.purpose === void 0 && (options.tools?.length ?? 0) > 0;
    if (mainLoop) {
      this.opts.onTurnStart?.(String(options.sessionId));
      this.noteVariant(String(options.sessionId), route, effort, session);
    }
    const images = route.multimodal ? await this.prepareImages(options, options.signal) : void 0;
    const messages = toTraeMessages(options, images).map((m) => ({
      role: m.role,
      content: wireContent(m),
      ...m.tool_calls?.length ? { tool_calls: m.tool_calls } : {},
      ...m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}
    }));
    const payload2 = JSON.stringify(this.requestBody(route, effort, session, messages, toTraeTools(options.tools)));
    const schemas = new Map((options.tools ?? []).map((t) => [t.name, t.parameters ?? {}]));
    const controller = new AbortController();
    const onAbort = () => controller.abort(options.signal?.reason);
    if (options.signal?.aborted) onAbort();
    options.signal?.addEventListener("abort", onAbort, { once: true });
    let next = 0;
    let reasoningIdx;
    let reasoningText = "";
    let textIdx;
    let text = "";
    const tools = /* @__PURE__ */ new Map();
    const recovered = [];
    const ends = [];
    let usage;
    let upstreamFinish = "stop";
    let stopped;
    let produced = false;
    let outputTokens = 0;
    const budget = options.maxTokens;
    const contentLoop = new LoopDetector(this.opts.loopGuardChars);
    const reasoningLoop = new LoopDetector(this.opts.loopGuardChars);
    const sniffer = new TextToolCallSniffer(schemas, this.opts.recoverTextToolCalls ?? true);
    function* emitText(piece) {
      if (!piece) return;
      if (textIdx === void 0) {
        const idx = textIdx = next++;
        yield { type: "block-start", index: idx, blockType: "text" };
        ends.push(() => ({ type: "block-end", index: idx, block: { type: "text", text } }));
      }
      text += piece;
      yield { type: "text-delta", index: textIdx, text: piece };
    }
    function* emitRecovered(calls) {
      for (const c of calls) {
        const state = { index: next++, id: c.id, name: c.name, args: c.arguments };
        recovered.push(state);
        yield { type: "block-start", index: state.index, blockType: "tool-call" };
        yield { type: "tool-call-delta", index: state.index, id: state.id, name: state.name, argumentsDelta: state.args };
        ends.push(() => ({ type: "block-end", index: state.index, block: { type: "tool-call", id: state.id, name: state.name, arguments: state.args } }));
      }
    }
    try {
      const attempts = this.opts.emptyRetries + 1;
      for (let attempt = 0; attempt < attempts; attempt++) {
        let error;
        let idle;
        const arm = () => {
          clearTimeout(idle);
          if (this.opts.readTimeoutMs > 0) idle = setTimeout(() => controller.abort(new Error("idle")), this.opts.readTimeoutMs);
        };
        arm();
        try {
          for await (const ev of this.once(payload2, controller.signal, mainLoop ? (trace) => this.noteTrace(String(options.sessionId), session, trace) : void 0)) {
            arm();
            const data = ev.data;
            if (ev.event === "output") {
              const reasoning = typeof data.reasoning_content === "string" ? data.reasoning_content : "";
              if (reasoning) {
                produced = true;
                if (reasoningIdx === void 0) {
                  const idx = reasoningIdx = next++;
                  yield { type: "block-start", index: idx, blockType: "reasoning" };
                  ends.push(() => ({ type: "block-end", index: idx, block: { type: "reasoning", text: reasoningText } }));
                }
                reasoningText += reasoning;
                yield { type: "reasoning-delta", index: reasoningIdx, text: reasoning };
              }
              const response = typeof data.response === "string" ? data.response : "";
              if (response) {
                produced = true;
                yield* emitText(sniffer.feed(response));
              }
              const calls = Array.isArray(data.tool_calls) ? data.tool_calls : [];
              for (const call of calls) {
                produced = true;
                const key = Number(call.index) || 0;
                const fc = call.function_call ?? call.function ?? {};
                let state = tools.get(key);
                if (!state) {
                  state = { index: next++, id: typeof call.id === "string" && call.id ? call.id : `call_${randomUUID2().slice(0, 8)}`, name: "", args: "" };
                  tools.set(key, state);
                  const s = state;
                  yield { type: "block-start", index: s.index, blockType: "tool-call" };
                  ends.push(() => ({ type: "block-end", index: s.index, block: { type: "tool-call", id: s.id, name: s.name, arguments: s.args || "{}" } }));
                } else if (typeof call.id === "string" && call.id && state.args === "" && !state.name) {
                  state.id = call.id;
                }
                if (typeof fc.name === "string" && fc.name) state.name = fc.name;
                const fragment = typeof fc.arguments === "string" ? fc.arguments : fc.arguments !== void 0 ? JSON.stringify(fc.arguments) : "";
                state.args += fragment;
                yield { type: "tool-call-delta", index: state.index, id: state.id, ...state.name ? { name: state.name } : {}, argumentsDelta: fragment };
              }
              outputTokens += approxTokens(response) + approxTokens(reasoning);
              if (contentLoop.add(response) || reasoningLoop.add(reasoning)) {
                this.opts.logger.warn(`dsh-trae2api: repetition collapse on ${route.id}; cutting the turn`);
                stopped = "max-tokens";
              } else if (budget !== void 0 && budget > 0 && outputTokens >= budget) {
                stopped = "max-tokens";
              }
              if (stopped) {
                controller.abort(new Error("guard"));
                break;
              }
            } else if (ev.event === "token_usage") {
              usage = usageOf(data);
            } else if (ev.event === "done") {
              if (typeof data.finish_reason === "string" && data.finish_reason) upstreamFinish = data.finish_reason;
            } else if (ev.event === "error" || ev.event === "biz_error") {
              error ??= data;
            }
          }
        } catch (err) {
          if (!stopped) {
            if (options.signal?.aborted) throw err;
            if (controller.signal.aborted) {
              throw new LlmError(`Trae\uFF1A\u4E0A\u6E38 ${Math.round(this.opts.readTimeoutMs / 1e3)} \u79D2\u6CA1\u6709\u6570\u636E\uFF0C\u5DF2\u653E\u5F03\u672C\u8F6E`, "TIMEOUT");
            }
            if (err instanceof LlmError) throw err;
            throw new LlmError(`Trae\uFF1A\u8BFB\u53D6\u4E0A\u6E38\u6D41\u5931\u8D25\uFF08${err instanceof Error ? err.message : String(err)}\uFF09`, "TRANSPORT", { cause: err });
          }
        } finally {
          clearTimeout(idle);
        }
        if (produced || stopped) {
          if (error && !stopped) this.opts.logger.warn(`dsh-trae2api: upstream error after output: ${upstreamMessage(error)}`);
          break;
        }
        const verdict = error ? classify(error) : { code: "EMPTY_RESPONSE", retryable: true };
        if (!verdict.retryable || attempt === attempts - 1) {
          throw new LlmError(
            error ? `Trae\uFF1A${upstreamMessage(error)}` : "Trae\uFF1A\u4E0A\u6E38\u8FD9\u4E00\u8F6E\u6CA1\u6709\u8FD4\u56DE\u4EFB\u4F55\u5185\u5BB9\uFF08\u4E0D\u662F\u62D2\u7EDD\uFF0C\u5C5E\u4E0A\u6E38\u6545\u969C\uFF09\uFF0C\u8BF7\u91CD\u8BD5\u3002",
            verdict.code
          );
        }
        this.opts.logger.warn(`dsh-trae2api: empty/transient turn on ${route.id}; retrying`);
        await sleep(1e3 * (attempt + 1));
      }
      const tail = sniffer.flush(tools.size === 0);
      yield* emitText(tail.visible);
      yield* emitRecovered(tail.calls);
      for (const end of ends) yield end();
      if (!usage && stopped) usage = { inputTokens: 0, outputTokens };
      if (usage) yield { type: "usage", usage };
      let reason;
      if (stopped) reason = { kind: "max-tokens" };
      else if (tools.size > 0 || recovered.length > 0) reason = { kind: "tool-calls" };
      else if (upstreamFinish === "length") reason = { kind: "max-tokens" };
      else reason = { kind: "stop" };
      if (mainLoop && reason.kind === "stop" && text.trim()) {
        try {
          this.opts.onTurnEnd?.({
            sessionId: String(options.sessionId),
            conversation: session,
            model: route.id,
            options,
            answer: text,
            ...reasoningText.trim() ? { reasoning: reasoningText } : {}
          });
        } catch {
        }
      }
      yield { type: "finish", reason };
    } finally {
      options.signal?.removeEventListener("abort", onAbort);
    }
  }
};

// src/trae/auth.ts
import { LlmError as LlmError2 } from "@deepseek-ai/dsh-llm";
var TRAE_HOST = "https://api.enterprise.trae.cn";
var EXCHANGE_PATH = "/cloudide/api/v3/trae/oauth/ExchangeToken";
var CLI_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
var REFRESH_SKEW_MS = 5 * 6e4;
function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function pick(obj, keys) {
  for (const key of keys) if (obj[key] !== void 0 && obj[key] !== null && obj[key] !== "") return obj[key];
  return void 0;
}
function decodeJwt(token) {
  const parts2 = token.split(".");
  if (parts2.length !== 3) return void 0;
  try {
    const payload2 = JSON.parse(Buffer.from(parts2[1], "base64url").toString("utf8"));
    if (typeof payload2.data === "string") {
      try {
        payload2.data = JSON.parse(payload2.data);
      } catch {
      }
    }
    return payload2;
  } catch {
    return void 0;
  }
}
function parseExpiry(value) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value < 1e12 ? value * 1e3 : value;
  if (typeof value === "string" && value.trim()) {
    if (/^\d+$/.test(value.trim())) return parseExpiry(Number(value.trim()));
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return void 0;
}
function sessionFromToken(token, expiryHint) {
  const claims = decodeJwt(token);
  const data = isObject(claims?.data) ? claims.data : void 0;
  const expiresAt = parseExpiry(expiryHint) ?? parseExpiry(claims?.exp) ?? Date.now() + 60 * 6e4;
  const name2 = data ? pick(data, ["username", "user_name", "UserName", "Username", "screen_name", "ScreenName", "name", "Name", "nickname", "NickName"]) : void 0;
  return {
    token,
    expiresAt,
    ...typeof data?.email === "string" ? { email: data.email } : {},
    ...typeof name2 === "string" && name2.trim() ? { name: name2.trim() } : {},
    ...data ? { claimKeys: Object.keys(data) } : {}
  };
}
function unwrap(body) {
  if (!isObject(body)) return { error: "response is not a JSON object" };
  const meta = isObject(body.ResponseMetadata) ? body.ResponseMetadata : void 0;
  const metaError = meta && isObject(meta.Error) ? meta.Error : void 0;
  for (const candidate of [body.Result, body.Data, body.data, body.result, body]) {
    if (!isObject(candidate)) continue;
    const inner = isObject(candidate.OauthToken) ? candidate.OauthToken : isObject(candidate.Token) ? candidate.Token : candidate;
    const token = pick(inner, ["Token", "token", "AccessToken", "access_token", "accessToken"]);
    if (typeof token === "string" && token.length > 20) {
      return { token, expiry: pick(inner, ["TokenExpireAt", "token_expire_at", "ExpiredAt", "expires_at", "ExpireAt"]) };
    }
  }
  const message = pick(metaError ?? body, ["Message", "message", "msg", "error", "Error"]);
  const code = pick(metaError ?? body, ["Code", "code"]);
  return { error: [code, typeof message === "string" ? message : JSON.stringify(body).slice(0, 300)].filter(Boolean).join(": ") };
}
var TraeAuth = class {
  constructor(opts) {
    this.opts = opts;
  }
  session;
  sessionSecret;
  pending;
  /** Forget the cached JWT (the PAT changed). */
  reset() {
    this.session = void 0;
    this.sessionSecret = void 0;
    this.pending = void 0;
  }
  /** Last good session, if any (for status display). */
  get current() {
    return this.session;
  }
  /** A valid JWT, exchanging the PAT when there is none or it is about to expire. */
  async get(force = false) {
    const secret = (await this.opts.readSecret())?.trim();
    if (!secret) {
      throw new LlmError2(
        "Trae\uFF1A\u8FD8\u6CA1\u6709\u586B\u5199\u4E2A\u4EBA\u8BBF\u95EE\u4EE4\u724C\uFF08PAT\uFF09\u3002\u8BF7\u5230 \u8BBE\u7F6E \u2192 \u6A21\u578B \u2192 Trae \u91CC\u586B\u5199\u3002",
        "MISSING_CREDENTIAL"
      );
    }
    if (secret !== this.sessionSecret) this.reset();
    const fresh = this.session && this.session.expiresAt - REFRESH_SKEW_MS > Date.now();
    if (!force && fresh) return this.session;
    if (!force && this.pending) return this.pending;
    const pending = this.obtain(secret).then(
      (session) => {
        if (this.pending === pending) {
          this.session = session;
          this.sessionSecret = secret;
          this.pending = void 0;
        }
        return session;
      },
      (error) => {
        if (this.pending === pending) this.pending = void 0;
        throw error;
      }
    );
    this.pending = pending;
    return pending;
  }
  async obtain(secret) {
    if (/^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(secret)) {
      const session = sessionFromToken(secret);
      if (session.expiresAt <= Date.now()) {
        throw new LlmError2("Trae\uFF1A\u586B\u5199\u7684\u662F\u4E00\u4E2A\u5DF2\u8FC7\u671F\u7684 JWT\u3002\u8BF7\u6539\u586B\u4F01\u4E1A\u7248\u63A7\u5236\u53F0\u751F\u6210\u7684\u4E2A\u4EBA\u8BBF\u95EE\u4EE4\u724C\uFF08PAT\uFF09\u3002", "AUTH");
      }
      return session;
    }
    let res;
    try {
      res = await fetch(`${this.opts.host}${EXCHANGE_PATH}`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", "user-agent": this.opts.userAgent },
        body: JSON.stringify({ RefreshToken: secret, ClientID: this.opts.clientId }),
        signal: AbortSignal.timeout(3e4)
      });
    } catch (error) {
      throw new LlmError2(`Trae\uFF1A\u65E0\u6CD5\u8FDE\u63A5 ${this.opts.host}\uFF08${error instanceof Error ? error.message : String(error)}\uFF09`, "TRANSPORT", { cause: error });
    }
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = void 0;
    }
    const found = unwrap(body);
    if (!res.ok || !found.token) {
      const detail = found.error ?? text.slice(0, 300);
      const auth = res.status === 401 || res.status === 403 || /token|auth|expire|invalid|unauthor/i.test(detail);
      throw new LlmError2(
        `Trae\uFF1A\u4E2A\u4EBA\u8BBF\u95EE\u4EE4\u724C\u5151\u6362\u5931\u8D25\uFF08HTTP ${res.status}\uFF09${detail ? `\uFF1A${detail}` : ""}\u3002\u8BF7\u786E\u8BA4 PAT \u6B63\u786E\u4E14\u672A\u8FC7\u671F\u3002`,
        auth ? "AUTH" : httpCode(res.status, detail),
        { status: res.status }
      );
    }
    return sessionFromToken(found.token, found.expiry);
  }
};

// src/trae/cue.ts
var REPORT_PATH = "/api/ide/v1/report/clients";
var TraeCueReporter = class {
  constructor(opts) {
    this.opts = opts;
  }
  body(userId, events, now) {
    return JSON.stringify({
      env_metadata: {
        ide_version: this.opts.ideVersion,
        environment: "",
        extension_version: "",
        version_code: Number(this.opts.ideVersionCode) || 0,
        region: "cn",
        channel: "unknown",
        app_id: this.opts.appId,
        user_id: userId,
        ab_version: ""
      },
      events: events.map((e) => ({ event: e.event, timestamp: now, payload: JSON.stringify(e.payload) }))
    });
  }
  /**
   * Post events; retries once with a fresh JWT on 401/403, throws on any other
   * failure. Resolves to false, sending nothing, for a privacy-mode account.
   */
  async report(events) {
    if (events.length === 0) return false;
    const user = await this.opts.user();
    if (user.privacyMode) return false;
    let session = await this.opts.auth.get();
    for (let attempt = 0; ; attempt++) {
      const form = new FormData();
      form.append("body", this.body(user.userId, events, Date.now()));
      const res = await fetch(`${this.opts.host}${REPORT_PATH}`, {
        method: "POST",
        headers: {
          authorization: `Cloud-IDE-JWT ${session.token}`,
          "x-app-id": this.opts.appId,
          "user-agent": this.opts.userAgent
        },
        body: form,
        signal: AbortSignal.timeout(1e4)
      });
      if ((res.status === 401 || res.status === 403) && attempt === 0) {
        await res.body?.cancel();
        session = await this.opts.auth.get(true);
        continue;
      }
      if (!res.ok) throw new Error(`report/clients HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      await res.body?.cancel();
      return true;
    }
  }
};

// src/trae/user.ts
var USER_INFO_PATH = "/cloudide/api/v3/trae/GetUserInfo";
var isObject2 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
function at(obj, ...keys) {
  if (!obj) return void 0;
  for (const key of keys) if (obj[key] !== void 0 && obj[key] !== null) return obj[key];
  return void 0;
}
var truthy = (value) => value === true || value === 1 || typeof value === "string" && /^(?:1|true|on|yes)$/i.test(value.trim());
function parseUserInfo(body) {
  if (!isObject2(body)) throw new Error("GetUserInfo: response is not a JSON object");
  const code = at(body, "code", "Code");
  if (code !== void 0 && Number(code) !== 0) {
    throw new Error(`GetUserInfo: ${String(code)} ${String(at(body, "message", "Message") ?? "")}`.trim());
  }
  const data = at(body, "Data", "data", "Result");
  const info = isObject2(data) ? at(data, "UserInfo", "userInfo", "user_info") : void 0;
  const id = isObject2(info) ? at(info, "UserID", "UserId", "userId", "user_id") : void 0;
  if ((typeof id !== "string" || !id.trim()) && typeof id !== "number") throw new Error("GetUserInfo: no UserInfo.UserID in the answer");
  const name2 = isObject2(info) ? at(info, "Username", "UserName", "username", "ScreenName", "screen_name", "Name", "name", "NickName", "Nickname", "nickname") : void 0;
  return {
    userId: String(id).trim(),
    privacyMode: truthy(isObject2(data) ? at(data, "PrivacyMode", "privacyMode", "privacy_mode") : void 0),
    ...typeof name2 === "string" && name2.trim() ? { username: name2.trim() } : {},
    ...isObject2(info) ? { infoKeys: Object.keys(info) } : {}
  };
}
var TraeUserInfo = class {
  constructor(opts) {
    this.opts = opts;
  }
  cached;
  pending;
  reset() {
    this.cached = void 0;
    this.pending = void 0;
  }
  /** The signed-in account, asked once per JWT (a new PAT means a new JWT). */
  async get() {
    const { token } = await this.opts.auth.get();
    if (this.cached?.token === token) return this.cached.user;
    if (this.pending?.token === token) return this.pending.promise;
    const promise = this.fetch(token).then(
      (user) => {
        if (this.pending?.promise === promise) {
          this.cached = { token, user };
          this.pending = void 0;
        }
        return user;
      },
      (error) => {
        if (this.pending?.promise === promise) this.pending = void 0;
        throw error;
      }
    );
    this.pending = { token, promise };
    return promise;
  }
  async fetch(token) {
    const res = await fetch(`${this.opts.host.replace(/\/+$/, "")}${USER_INFO_PATH}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "user-agent": this.opts.userAgent,
        "x-cloudide-token": token
      },
      body: "{}",
      signal: AbortSignal.timeout(15e3)
    });
    if (!res.ok) throw new Error(`GetUserInfo HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return parseUserInfo(await res.json());
  }
};

// src/trae/quota.ts
var QUOTA_PATHS = ["/trae/api/v1/pay/ide_user_ent_usage", "/trae/api/v2/pay/ide_user_ent_usage"];
var CHECK_LOGIN_PATH = "/cloudide/api/v3/trae/CheckLogin";
var FALLBACK_PAY_HOST = "https://api.trae.cn";
function isObject3(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function field(obj, ...keys) {
  if (!obj) return void 0;
  for (const key of keys) if (obj[key] !== void 0 && obj[key] !== null) return obj[key];
  return void 0;
}
function objectAt(obj, ...keys) {
  const value = field(obj, ...keys);
  return isObject3(value) ? value : void 0;
}
function numberOf(value) {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : void 0;
}
function firstNumber(sources, keys) {
  for (const source of sources) {
    for (const key of keys) {
      const n = numberOf(source?.[key]);
      if (n !== void 0) return n;
    }
  }
  return void 0;
}
var LIMIT_KEYS = ["basic_usage_limit", "basicUsageLimit", "credits_limit", "creditsLimit"];
var USED_KEYS = ["basic_usage_amount", "basicUsageAmount", "credits_amount", "creditsAmount"];
var LIST_KEYS = ["user_entitlement_pack_list", "userEntitlementPackList"];
var PRODUCT_NAMES = { 0: "Free", 1: "Pro", 2: "\u52A0\u6CB9\u5305", 3: "Pro+", 4: "Ultra", 5: "Lite", 100: "Express" };
function payload(body) {
  for (const candidate of [body.data, body.Data, body.Result, body.result, body]) {
    if (isObject3(candidate) && LIST_KEYS.some((key) => Array.isArray(candidate[key]))) return candidate;
  }
  return void 0;
}
function businessError(body) {
  const meta = objectAt(body, "ResponseMetadata");
  const source = objectAt(meta, "Error") ?? body;
  const code = field(source, "code", "Code");
  const message = field(source, "message", "Message", "msg");
  if (code === void 0 || code === 0 || code === "0") return void 0;
  return [String(code), typeof message === "string" ? message : ""].filter(Boolean).join(" ");
}
function parseQuota(body, now = Date.now()) {
  const empty = { packs: [], limit: 0, used: 0, remaining: 0, dollars: false, fetchedAt: now };
  if (!isObject3(body)) return { ...empty, raw: String(body).slice(0, 2e3) };
  const data = payload(body);
  if (!data) {
    const error = businessError(body);
    if (error) throw new Error(`Trae \u62D2\u7EDD\u4E86\u989D\u5EA6\u67E5\u8BE2\uFF1A${error}`);
    return { ...empty, raw: JSON.stringify(body).slice(0, 2e3) };
  }
  const list = field(data, ...LIST_KEYS);
  const packs = [];
  let recognized = false;
  for (const [index, entry] of list.entries()) {
    if (!isObject3(entry)) continue;
    const base = objectAt(entry, "entitlement_base_info", "entitlementBaseInfo");
    const subscription = objectAt(objectAt(base, "product_extra", "productExtra"), "subscription_extra", "subscriptionExtra");
    const quotas = [objectAt(base, "quota"), objectAt(subscription, "quota"), objectAt(entry, "quota")];
    const limit = firstNumber(quotas, LIMIT_KEYS);
    if (limit === void 0) continue;
    recognized = true;
    if (limit === 0) continue;
    const endsAt = parseExpiry(field(base, "end_time", "endTime") ?? field(entry, "expire_time", "expireTime"));
    if (endsAt !== void 0 && endsAt <= now) continue;
    const used = Math.max(0, firstNumber([objectAt(entry, "usage"), ...quotas], USED_KEYS) ?? 0);
    const unlimited2 = limit < 0;
    const desc = field(entry, "display_desc", "displayDesc");
    const productType = numberOf(field(base, "product_type", "productType"));
    packs.push({
      name: typeof desc === "string" && desc.trim() ? desc.trim() : productType !== void 0 && PRODUCT_NAMES[productType] ? PRODUCT_NAMES[productType] : `\u5957\u9910 ${index + 1}`,
      limit: unlimited2 ? null : limit,
      used,
      remaining: unlimited2 ? null : Math.max(limit - used, 0),
      ...endsAt !== void 0 ? { endsAt } : {}
    });
  }
  const unlimited = packs.some((p) => p.limit === null);
  const ends = packs.map((p) => p.endsAt).filter((t) => t !== void 0);
  const snapshot2 = {
    packs,
    limit: unlimited ? null : packs.reduce((sum, p) => sum + p.limit, 0),
    used: packs.reduce((sum, p) => sum + p.used, 0),
    remaining: unlimited ? null : packs.reduce((sum, p) => sum + p.remaining, 0),
    dollars: field(data, "is_dollar_usage_billing", "isDollarUsageBilling") === true,
    fetchedAt: now,
    ...ends.length > 0 ? { endsAt: Math.min(...ends) } : {}
  };
  if (packs.length === 0 && list.length > 0 && !recognized) snapshot2.raw = JSON.stringify(body).slice(0, 2e3);
  return snapshot2;
}
var QuotaHttpError = class extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
};
function enterpriseTenant(token) {
  const claims = decodeJwt(token);
  const data = isObject3(claims?.data) ? claims.data : claims;
  const tob = field(data, "tob_tenant_id", "tobTenantId", "tobTenantID");
  if (tob !== void 0 && String(tob).trim() && String(tob).trim() !== "0") return String(tob).trim();
  const tenant = field(data, "tenant_id", "tenantId", "tenantID");
  return typeof tenant === "string" && /^tob/i.test(tenant.trim()) ? tenant.trim() : void 0;
}
function normalizeHost(value) {
  const trimmed = value.trim().replace(/\/+$/, "");
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}
var TraeQuota = class {
  constructor(opts) {
    this.opts = opts;
  }
  cached;
  pending;
  payHosts;
  /** The host + path that answered last; asked first next time. */
  preferred;
  /** Forget everything learned for the current PAT. */
  reset() {
    this.cached = void 0;
    this.pending = void 0;
    this.payHosts = void 0;
    this.preferred = void 0;
    this.opts.tob?.reset();
  }
  get(force = false) {
    const ttl = this.opts.ttlMs ?? 6e4;
    if (!force && this.cached && Date.now() - this.cached.fetchedAt < ttl) return Promise.resolve(this.cached);
    if (this.pending) return this.pending;
    const pending = this.read().then(
      (snapshot2) => {
        if (this.pending === pending) {
          this.cached = snapshot2;
          this.pending = void 0;
        }
        return snapshot2;
      },
      (error) => {
        if (this.pending === pending) this.pending = void 0;
        throw error;
      }
    );
    this.pending = pending;
    return pending;
  }
  async read() {
    const { token } = await this.opts.auth.get();
    const tenant = enterpriseTenant(token);
    if (tenant !== void 0 && this.opts.tob) {
      const snapshot2 = await this.opts.tob.read();
      if (snapshot2) return { ...snapshot2, tenant: snapshot2.tenant ?? tenant };
    }
    const targets = [];
    if (this.preferred) targets.push(this.preferred);
    for (const host of await this.hosts(token)) {
      for (const path of QUOTA_PATHS) {
        if (!targets.some((t) => t.host === host && t.path === path)) targets.push({ host, path });
      }
    }
    let failure;
    let unrecognised;
    let empty;
    const record2 = (error) => {
      if (!failure || failure.status === 404) failure = error;
    };
    for (const target of targets) {
      const source = `${target.host}${target.path}`;
      let body;
      try {
        body = await this.post(target.host, target.path, token);
      } catch (error) {
        if (!(error instanceof QuotaHttpError)) throw error;
        record2(error);
        continue;
      }
      let snapshot2;
      try {
        snapshot2 = parseQuota(body);
      } catch (error) {
        record2(new QuotaHttpError(error instanceof Error ? error.message : String(error), 200));
        continue;
      }
      snapshot2.source = source;
      if (tenant !== void 0) {
        snapshot2.seat = "enterprise";
        snapshot2.tenant = tenant;
      }
      if (snapshot2.raw === void 0 && snapshot2.packs.length > 0) {
        this.preferred = target;
        return snapshot2;
      }
      if (snapshot2.raw === void 0) empty ??= snapshot2;
      else unrecognised ??= snapshot2;
    }
    if (empty) return empty;
    if (unrecognised) return unrecognised;
    throw failure ?? new Error("Trae \u989D\u5EA6\u67E5\u8BE2\u5931\u8D25");
  }
  /** Pay hosts to try: the configured one, else CheckLogin's, then the fallback. */
  async hosts(token) {
    if (this.opts.payHost?.trim()) return [normalizeHost(this.opts.payHost)];
    if (this.payHosts) return this.payHosts;
    const discovered = await this.discoverPayHost(token);
    const hosts = [.../* @__PURE__ */ new Set([...discovered.host ? [discovered.host] : [], FALLBACK_PAY_HOST])];
    if (discovered.answered) this.payHosts = hosts;
    return hosts;
  }
  /** CheckLogin with `GetAIPayHost`, the way the IDE asks it (token in `x-cloudide-token`). */
  async discoverPayHost(token) {
    let res;
    try {
      res = await fetch(`${this.opts.host}${CHECK_LOGIN_PATH}`, {
        method: "POST",
        headers: { ...this.opts.headers(token), "x-cloudide-token": token },
        body: JSON.stringify({ GetAIPayHost: true, ReqSource: "IDE" }),
        signal: AbortSignal.timeout(15e3)
      });
    } catch {
      return { answered: false };
    }
    let body;
    try {
      body = await res.json();
    } catch {
      return { answered: res.ok };
    }
    const data = isObject3(body) ? objectAt(body, "Data", "Result", "data", "result") : void 0;
    const host = field(data, "AIPayHost", "AiPayHost", "ai_pay_host");
    return { answered: res.ok, ...typeof host === "string" && host.trim() ? { host: normalizeHost(host) } : {} };
  }
  /** One POST to a pay host, with the headers the IDE sends there. */
  async post(host, path, token) {
    let res;
    try {
      res = await fetch(`${host}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          "user-agent": this.opts.userAgent,
          authorization: `Cloud-IDE-JWT ${token}`
        },
        body: JSON.stringify({ require_usage: true }),
        signal: AbortSignal.timeout(2e4)
      });
    } catch (error) {
      throw new QuotaHttpError(`Trae\uFF1A\u65E0\u6CD5\u8FDE\u63A5 ${host}\uFF08${error instanceof Error ? error.message : String(error)}\uFF09`, 0);
    }
    const text = await res.text();
    if (!res.ok) {
      let detail = text.trim().startsWith("<") ? "" : text.trim();
      try {
        const body = JSON.parse(text);
        if (isObject3(body)) detail = [field(body, "code"), field(body, "message")].filter((v) => v !== void 0).join(" ");
      } catch {
      }
      const hint = res.status === 404 ? "\uFF0C\u8BE5\u5730\u5740\u4E0D\u63D0\u4F9B\u6B64\u63A5\u53E3" : res.status === 401 || res.status === 403 ? "\uFF0C\u8BE5\u5730\u5740\u4E0D\u63A5\u53D7\u5F53\u524D\u4EE4\u724C" : "";
      throw new QuotaHttpError(`Trae \u989D\u5EA6\u67E5\u8BE2\u5931\u8D25\uFF08${host}\uFF0CHTTP ${res.status}${hint}\uFF09${detail ? `\uFF1A${detail.slice(0, 300)}` : ""}`, res.status);
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new QuotaHttpError(`Trae \u989D\u5EA6\u67E5\u8BE2\u8FD4\u56DE\u7684\u4E0D\u662F JSON\uFF08${host}\uFF09\uFF1A${text.trim().slice(0, 300)}`, res.status);
    }
  }
};

// src/trae/share.ts
var SHARE_ORIGIN = "https://share.traecontent.cn";
var SHARE_API_ORIGIN = "https://trae-api-cn.mchost.guru";
var AUDIT_DEADLINE_MS = 12e4;
var SHARE_PATH = "/api/remote/v1/share";
var SESSIONS_PATH = "/api/remote/v1/chat_sessions";
var TURN_LIMIT = 50;
var AUDIT_ATTEMPTS = 15;
var AUDIT_INTERVAL_MS = 1e3;
var AUDIT_TIMEOUT_MS = 5e3;
var SHARE_CODES = {
  // Generic: createShare says "no messages match the specified turn_ids"
  // (turn_ids want the *user* message_id), local_conversation "invalid parameter".
  991102: "\u8BF7\u6C42\u53C2\u6570\u4E0D\u5408\u6CD5",
  991200: "\u804A\u5929\u670D\u52A1\u91CC\u6CA1\u6709\u8FD9\u6761\u4F1A\u8BDD",
  992700: "\u5206\u4EAB\u4E0D\u5B58\u5728",
  992701: "\u5206\u4EAB\u5DF2\u5173\u95ED\uFF0C\u6216\u65E0\u6743\u64CD\u4F5C\u8FD9\u6761\u5206\u4EAB",
  992702: "\u5206\u4EAB\u5DF2\u88AB\u64A4\u9500\uFF08\u5220\u9664\uFF09",
  992704: "\u6E90\u4F1A\u8BDD\u4E0D\u5B58\u5728",
  992705: "\u65E0\u6743\u8BBF\u95EE\u6E90\u4F1A\u8BDD",
  992706: "\u5206\u4EAB\u5DF2\u8FC7\u671F",
  992707: "\u5206\u4EAB\u4ECD\u5728\u5BA1\u6838\u4E2D",
  993202: "\u5DE5\u4EF6\u5206\u4EAB\u4E0D\u5B58\u5728",
  993400: "\u540C\u4E00\u6761\u4F1A\u8BDD\u5DF2\u6709\u51B2\u7A81\u7684\u5206\u4EAB",
  993401: "\u5185\u5BB9\u5BA1\u6838\u672A\u901A\u8FC7",
  993403: "\u4F1A\u8BDD\u5206\u4EAB\u8D44\u6E90\u6570\u91CF\u8D85\u9650",
  1001: "\u672A\u9274\u6743\uFF1APAT \u7F3A\u5931\u6216\u5931\u6548"
};
var isObject4 = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
function field2(obj, ...keys) {
  if (!obj) return void 0;
  for (const key of keys) if (obj[key] !== void 0 && obj[key] !== null) return obj[key];
  return void 0;
}
var ShareError = class extends Error {
  constructor(message, code, status) {
    super(message);
    this.code = code;
    this.status = status;
    this.name = "ShareError";
  }
};
function describe(code, message) {
  const reason = SHARE_CODES[code];
  const detail = typeof message === "string" && message.trim() ? message.trim() : "";
  if (reason && detail) return `${reason}\uFF08${code}\uFF09\uFF1A${detail}`;
  if (reason) return `${reason}\uFF08${code}\uFF09`;
  return detail ? `${code}\uFF1A${detail}` : String(code);
}
function parseEntries(value) {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return {};
    }
  }
  if (!isObject4(parsed)) return {};
  const out = {};
  for (const [path, entry] of Object.entries(parsed)) {
    if (!isObject4(entry)) continue;
    const downloadUrl = field2(entry, "download_url", "downloadUrl");
    const entryUrl = field2(entry, "entry_url", "entryUrl");
    const fileToken = field2(entry, "file_token", "fileToken");
    const contentLength = Number(field2(entry, "content_length", "contentLength"));
    out[path] = {
      ...typeof downloadUrl === "string" ? { downloadUrl } : {},
      ...typeof entryUrl === "string" ? { entryUrl } : {},
      ...typeof fileToken === "string" ? { fileToken } : {},
      ...Number.isFinite(contentLength) && contentLength >= 0 ? { contentLength } : {}
    };
  }
  return out;
}
function parseSession(body) {
  if (!isObject4(body)) throw new ShareError("\u5206\u4EAB\u54CD\u5E94\u4E0D\u662F JSON \u5BF9\u8C61", -1);
  const code = Number(field2(body, "code") ?? 0);
  if (code !== 0) throw new ShareError(describe(code, field2(body, "message")), code);
  const data = field2(body, "data");
  if (!isObject4(data)) throw new ShareError("\u5206\u4EAB\u54CD\u5E94\u91CC\u6CA1\u6709 data", 0);
  const id = field2(data, "share_session_id", "shareSessionId");
  if (typeof id !== "string" || !id) throw new ShareError("\u5206\u4EAB\u54CD\u5E94\u91CC\u6CA1\u6709 share_session_id", 0);
  const str = (...keys) => {
    const v = field2(data, ...keys);
    return typeof v === "string" && v ? v : void 0;
  };
  return {
    shareSessionId: id,
    ...str("title") ? { title: str("title") } : {},
    ...str("mode") ? { mode: str("mode") } : {},
    ...str("created_at", "createdAt") ? { createdAt: str("created_at", "createdAt") } : {},
    ...str("creator_name", "creatorName") ? { creatorName: str("creator_name", "creatorName") } : {},
    anonymous: field2(data, "anonymous") === true,
    ...str("status") ? { status: str("status") } : {},
    ...str("share_type", "shareType") ? { shareType: str("share_type", "shareType") } : {},
    ...str("artifact_path", "artifactPath") ? { artifactPath: str("artifact_path", "artifactPath") } : {},
    ...str("expires_at", "expiresAt") ? { expiresAt: str("expires_at", "expiresAt") } : {},
    entries: parseEntries(field2(data, "artifact_entries", "artifactEntries")),
    raw: data
  };
}
function parseMessages(body) {
  if (!isObject4(body)) throw new ShareError("\u6D88\u606F\u54CD\u5E94\u4E0D\u662F JSON \u5BF9\u8C61", -1);
  const code = Number(field2(body, "code") ?? 0);
  if (code !== 0) throw new ShareError(describe(code, field2(body, "message")), code);
  const data = field2(body, "data");
  const list = isObject4(data) ? field2(data, "items") : void 0;
  const items = [];
  if (Array.isArray(list)) {
    for (const entry of list) {
      if (!isObject4(entry)) continue;
      const messageId = field2(entry, "message_id", "messageId");
      if (typeof messageId !== "string" || !messageId) continue;
      const role = field2(entry, "role");
      const str = (...keys) => {
        const v = field2(entry, ...keys);
        return typeof v === "string" && v ? v : void 0;
      };
      const index = Number(field2(entry, "message_index", "messageIndex"));
      items.push({
        shareSessionId: str("share_session_id", "shareSessionId") ?? "",
        messageId,
        role: typeof role === "string" ? role : "user",
        ...str("message_type", "messageType") ? { messageType: str("message_type", "messageType") } : {},
        ...str("status") ? { status: str("status") } : {},
        ...Number.isFinite(index) ? { messageIndex: index } : {},
        ...str("agent_type", "agentType") ? { agentType: str("agent_type", "agentType") } : {},
        ...str("created_at", "createdAt") ? { createdAt: str("created_at", "createdAt") } : {},
        ...str("turn_id", "turnId") ? { turnId: str("turn_id", "turnId") } : {},
        ...str("reply_to_message_id", "replyToMessageId") ? { replyToMessageId: str("reply_to_message_id", "replyToMessageId") } : {},
        ...typeof field2(entry, "content") === "string" ? { content: field2(entry, "content") } : {},
        ...typeof field2(entry, "query") === "string" ? { query: field2(entry, "query") } : {}
      });
    }
  }
  const nextToken = isObject4(data) ? field2(data, "next_page_token", "nextPageToken") : void 0;
  return {
    items,
    hasMore: isObject4(data) && field2(data, "has_more", "hasMore") === true,
    ...typeof nextToken === "string" && nextToken ? { nextToken } : {}
  };
}
function turnIdsOf(messages) {
  const seen = /* @__PURE__ */ new Set();
  for (const message of messages) {
    if (message.role !== "user") continue;
    if (message.messageId) seen.add(message.messageId);
  }
  return [...seen];
}
function latestTurns(turnIds, limit = TURN_LIMIT) {
  return turnIds.length > limit ? turnIds.slice(turnIds.length - limit) : [...turnIds];
}
var SHARE_PAGE_ORIGINS = {
  "https://share.traecontent.cn": "https://share.traecontent.cn",
  "https://work.trae.cn": "https://share.traecontent.cn",
  "https://trae-api-cn.mchost.guru": "https://share.traecontent.cn",
  "https://api.enterprise.trae.cn": "https://console.enterprise.trae.cn",
  "https://console.enterprise.trae.cn": "https://console.enterprise.trae.cn"
};
function shareOriginFor(host) {
  const key = host.trim().replace(/\/+$/, "");
  return SHARE_PAGE_ORIGINS[key] ?? SHARE_ORIGIN;
}
function shareUrl(id, origin = SHARE_ORIGIN) {
  return `${origin}/share/${id}?enter_from=pc`;
}
function artifactUrl(id, origin = SHARE_ORIGIN) {
  return `${origin}/artifact/${id}`;
}
var TraeShare = class _TraeShare {
  constructor(opts) {
    this.opts = opts;
  }
  cache = /* @__PURE__ */ new Map();
  /** PAT 变了，缓存作废。 */
  reset() {
    this.cache.clear();
  }
  base() {
    return this.opts.host.replace(/\/+$/, "");
  }
  /** The origin this client speaks to, without a trailing slash. */
  get host() {
    return this.base();
  }
  /** 一次 POST/GET；`token` 缺省表示匿名。 */
  async call(method, path, options = {}) {
    const headers = {
      accept: options.accept ?? "application/json",
      "user-agent": this.opts.userAgent
    };
    if (options.body !== void 0) headers["content-type"] = "application/json";
    if (options.token) headers.authorization = `Cloud-IDE-JWT ${options.token}`;
    const timeout = AbortSignal.timeout(options.timeoutMs ?? 2e4);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    let res;
    try {
      res = await fetch(`${this.base()}${path}`, {
        method,
        headers,
        ...options.body !== void 0 ? { body: JSON.stringify(options.body) } : {},
        signal
      });
    } catch (error) {
      throw new ShareError(`\u65E0\u6CD5\u8FDE\u63A5 ${this.base()}\uFF08${error instanceof Error ? error.message : String(error)}\uFF09`, -1);
    }
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = void 0;
    }
    return { status: res.status, body, text };
  }
  /** JWT，铸链接/列会话用；没有 auth 时给出明确的一句话。 */
  async token() {
    if (!this.opts.auth) throw new ShareError("\u8FD9\u4E2A\u5206\u4EAB\u64CD\u4F5C\u9700\u8981 PAT\uFF0C\u4F46\u63D2\u4EF6\u6CA1\u6709\u6302\u4E0A\u9274\u6743", -1);
    return (await this.opts.auth.get()).token;
  }
  /**
   * 读一条分享。**不需要任何凭证** —— 只要 id 是对的就能读，这也是为什么
   * 链接一旦外流，内容就被原文拉走：服务端不校验调用方和分享者的关系。
   */
  async get(id, options = {}) {
    const ttl = this.opts.ttlMs ?? 6e4;
    if (!options.force && ttl > 0) {
      const hit = this.cache.get(id);
      if (hit && Date.now() - hit.at < ttl) return hit.value;
    }
    const { status, body, text } = await this.call("GET", `${SHARE_PATH}/${encodeURIComponent(id)}`, {
      ...options.signal ? { signal: options.signal } : {}
    });
    if (status === 404 && isObject4(body) && Number(field2(body, "code")) === 992700) {
      throw new ShareError(describe(992700, field2(body, "message")), 992700, 404);
    }
    if (!isObject4(body)) {
      throw new ShareError(`\u5206\u4EAB\u54CD\u5E94\u4E0D\u662F JSON\uFF08HTTP ${status}\uFF09\uFF1A${text.slice(0, 200)}`, -1, status);
    }
    const value = { ...parseSession(body), host: this.base() };
    if (ttl > 0) this.cache.set(id, { at: Date.now(), value });
    return value;
  }
  /** The same read, on one named host — for finding out which namespace an id lives in. */
  async getOn(host, id, options = {}) {
    const client = host.replace(/\/+$/, "") === this.base() ? this : new _TraeShare({ ...this.opts, host, ttlMs: 0 });
    return client.get(id, { force: true, ...options.signal ? { signal: options.signal } : {} });
  }
  /**
   * 读一条分享的全部消息，自动翻页（`page_token` 语义是"从第 N+1 条开始"，
   * `page_size` 服务端不设上限）。
   */
  async messages(id, options = {}) {
    const pageSize = options.pageSize ?? 100;
    const out = [];
    let pageToken;
    for (let page = 0; page < 200; page++) {
      const query = new URLSearchParams({ page_size: String(pageSize) });
      if (pageToken) query.set("page_token", pageToken);
      const path = `${SHARE_PATH}/${encodeURIComponent(id)}/messages?${query}`;
      const { body } = await this.call("GET", path, { ...options.signal ? { signal: options.signal } : {} });
      const parsed = parseMessages(body);
      out.push(...parsed.items);
      if (!parsed.hasMore || !parsed.nextToken) break;
      pageToken = parsed.nextToken;
    }
    return out;
  }
  /** 审核状态（匿名可读，但只有铸链接的过程中才需要它）；单次 timeout 5s，同前端。 */
  async auditStatus(id, signal) {
    return (await this.auditAnswer(id, signal)).status;
  }
  /** `audit_status` 的整个回答：业务码、状态、服务端原话。 */
  async auditAnswer(id, signal) {
    const { status: http, body, text } = await this.call("GET", `${SHARE_PATH}/${encodeURIComponent(id)}/audit_status`, {
      timeoutMs: AUDIT_TIMEOUT_MS,
      ...signal ? { signal } : {}
    });
    if (!isObject4(body)) return { code: -1, message: `\u5BA1\u6838\u67E5\u8BE2\u4E0D\u662F JSON\uFF08HTTP ${http}\uFF09\uFF1A${text.slice(0, 120)}` };
    const data = field2(body, "data");
    const status = isObject4(data) ? field2(data, "status") : void 0;
    const message = field2(body, "message");
    return {
      code: Number(field2(body, "code") ?? 0),
      ...typeof status === "string" && status ? { status } : {},
      ...typeof message === "string" ? { message } : {}
    };
  }
  /**
   * 铸一条对话分享链接。
   *
   * `chatSessionId` / `turnIds` 必须是聊天服务自己的 id —— 不是本插件合成的
   * UUID（见文件头）。
   */
  async create(input) {
    if (input.turnIds.length === 0) throw new ShareError("turn_ids \u4E0D\u80FD\u4E3A\u7A7A\uFF08\u524D\u7AEF\u4E5F\u8981\u6C42\u81F3\u5C11\u9009\u4E00\u8F6E\uFF09", -1);
    if (input.turnIds.length > TURN_LIMIT) {
      throw new ShareError(`turn \u6570 ${input.turnIds.length} \u8D85\u8FC7\u4E0A\u9650 ${TURN_LIMIT}`, -1);
    }
    const token = await this.token();
    const { status, body, text } = await this.call("POST", SHARE_PATH, {
      token,
      body: {
        chat_session_id: input.chatSessionId,
        turn_ids: input.turnIds,
        anonymous: input.anonymous === true,
        // bundle: `currentUser.username.trim()`.
        creator_name: (input.creatorName ?? "").trim()
      },
      ...input.signal ? { signal: input.signal } : {}
    });
    if (status === 401) throw new ShareError(describe(1001, "PAT \u7F3A\u5931\u6216\u5931\u6548"), 1001, 401);
    if (!isObject4(body)) throw new ShareError(`\u94F8\u94FE\u63A5\u54CD\u5E94\u4E0D\u662F JSON\uFF08HTTP ${status}\uFF09\uFF1A${text.slice(0, 200)}`, -1, status);
    const code = Number(field2(body, "code") ?? 0);
    if (code !== 0) throw new ShareError(describe(code, field2(body, "message")), code, status);
    const data = field2(body, "data");
    if (!isObject4(data)) throw new ShareError("\u94F8\u94FE\u63A5\u54CD\u5E94\u91CC\u6CA1\u6709 data", 0, status);
    const id = field2(data, "share_session_id", "shareSessionId");
    if (typeof id !== "string" || !id) throw new ShareError("\u94F8\u94FE\u63A5\u54CD\u5E94\u91CC\u6CA1\u6709 share_session_id", 0, status);
    const initial = field2(data, "status");
    const expiresAt = field2(data, "expires_at", "expiresAt");
    if (initial === "audit_failed" || initial === "failed") throw new ShareError(describe(993401, "share audit failed"), 993401, status);
    let auditPolls = 0;
    let final = typeof initial === "string" ? initial : void 0;
    if (initial === "auditing" && !input.skipAudit) {
      auditPolls = await this.awaitAudit(id, input.signal);
      final = "passed";
    }
    return {
      shareSessionId: id,
      url: shareUrl(id, shareOriginFor(this.base())),
      ...final ? { status: final } : {},
      ...typeof expiresAt === "string" ? { expiresAt } : {},
      auditPolls
    };
  }
  /**
   * 铸一条「本地会话」分享：消息由调用方整段带上（local-share.ts 拼好的
   * body），服务端原样存，不跑模型。客户端 `ee()` 的同一个端点。
   */
  async createLocal(body, signal) {
    const token = await this.token();
    const { status, body: answer, text } = await this.call("POST", `${SHARE_PATH}/local_conversation`, {
      token,
      body,
      // A long session is a big body; give the upload room.
      timeoutMs: 6e4,
      ...signal ? { signal } : {}
    });
    if (status === 401) throw new ShareError(describe(1001, "PAT \u7F3A\u5931\u6216\u5931\u6548"), 1001, 401);
    if (!isObject4(answer)) throw new ShareError(`\u672C\u5730\u4F1A\u8BDD\u5206\u4EAB\u54CD\u5E94\u4E0D\u662F JSON\uFF08HTTP ${status}\uFF09\uFF1A${text.slice(0, 200)}`, -1, status);
    const code = Number(field2(answer, "code") ?? 0);
    if (code !== 0) throw new ShareError(describe(code, field2(answer, "message")), code, status);
    const data = field2(answer, "data");
    const id = isObject4(data) ? field2(data, "share_session_id", "shareSessionId") : void 0;
    if (typeof id !== "string" || !id) throw new ShareError("\u672C\u5730\u4F1A\u8BDD\u5206\u4EAB\u54CD\u5E94\u91CC\u6CA1\u6709 share_session_id", 0, status);
    const initial = isObject4(data) ? field2(data, "status") : void 0;
    if (initial === "audit_failed" || initial === "failed") throw new ShareError(describe(993401, "share audit failed"), 993401, status);
    let auditPolls = 0;
    let final = typeof initial === "string" ? initial : void 0;
    if (initial === "auditing") {
      auditPolls = await this.awaitAudit(id, signal);
      final = "active";
    }
    const expiresAt = isObject4(data) ? field2(data, "expires_at", "expiresAt") : void 0;
    const title = isObject4(data) ? field2(data, "title") : void 0;
    return {
      shareSessionId: id,
      url: shareUrl(id, shareOriginFor(this.base())),
      ...final ? { status: final } : {},
      ...typeof expiresAt === "string" ? { expiresAt } : {},
      ...typeof title === "string" ? { title } : {},
      auditPolls
    };
  }
  /**
   * 审核轮询，对齐前端 `P()`（报告 v2 §1.3）：最多 15 次、间隔 1s、单次
   * timeout 5s、整体 120s。
   *
   * - `passed` 放行；`failed` 抛「内容审核未通过」。
   * - 业务码非 0 或没有 status：`992700`（刚铸好、读侧还没同步）前 14 轮
   *   容忍重试，其他码当场抛服务端原话 —— 同前端。
   * - 连接失败/超时只算这一次没问到（前端没有这一层；插件跑在用户网络上，
   *   不让一次抖动把已经铸好的链接判成失败）。
   */
  async awaitAudit(id, signal) {
    const deadline = Date.now() + AUDIT_DEADLINE_MS;
    let lastError;
    for (let attempt = 0; attempt < AUDIT_ATTEMPTS; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, AUDIT_INTERVAL_MS));
      if (signal?.aborted) throw new ShareError("\u5BA1\u6838\u8F6E\u8BE2\u88AB\u53D6\u6D88", -1);
      if (Date.now() > deadline) break;
      let answer;
      try {
        answer = await this.auditAnswer(id, signal);
      } catch (error) {
        if (signal?.aborted) throw new ShareError("\u5BA1\u6838\u8F6E\u8BE2\u88AB\u53D6\u6D88", -1);
        lastError = error;
        continue;
      }
      if (answer.code !== 0 || !answer.status) {
        if (answer.code === 992700 && attempt < AUDIT_ATTEMPTS - 1) continue;
        throw new ShareError(describe(answer.code, answer.message ?? "audit status unavailable"), answer.code);
      }
      if (answer.status === "passed") return attempt + 1;
      if (answer.status === "failed" || answer.status === "audit_failed") {
        throw new ShareError(describe(993401, "share audit failed"), 993401);
      }
      this.opts.logger?.info(`dsh-trae2api: \u5206\u4EAB ${id} \u5BA1\u6838\u4E2D\uFF08${attempt + 1}/${AUDIT_ATTEMPTS}\uFF09`);
    }
    const detail = lastError instanceof Error ? `\uFF1B\u6700\u540E\u4E00\u6B21\u67E5\u8BE2\uFF1A${lastError.message}` : "";
    throw new ShareError(`\u5BA1\u6838\u8F6E\u8BE2\u8D85\u65F6\uFF08share audit is still in progress\uFF09${detail}`, 992707);
  }
  /**
   * 改分享状态：`disabled` 关闭（之后匿名读 403 992701），`active` 重开。
   * 只有分享者本人能改（别人的 id 是 403 992701）。
   */
  async setStatus(id, status) {
    const token = await this.token();
    const { status: http, body, text } = await this.call(
      "PATCH",
      `${SHARE_PATH}/${encodeURIComponent(id)}/status`,
      { token, body: { status } }
    );
    if (http === 401) throw new ShareError(describe(1001, "PAT \u7F3A\u5931\u6216\u5931\u6548"), 1001, 401);
    if (!isObject4(body)) throw new ShareError(`\u6539\u72B6\u6001\u54CD\u5E94\u4E0D\u662F JSON\uFF08HTTP ${http}\uFF09\uFF1A${text.slice(0, 200)}`, -1, http);
    const code = Number(field2(body, "code") ?? 0);
    if (code !== 0) throw new ShareError(describe(code, field2(body, "message")), code, http);
    this.cache.delete(id);
    const data = field2(body, "data");
    const next = isObject4(data) ? field2(data, "status") : void 0;
    return { shareSessionId: id, status: typeof next === "string" ? next : status };
  }
  /** 撤销一条分享：`DELETE /share/:id`，之后读是 410 992702。不能恢复。 */
  async remove(id) {
    const token = await this.token();
    const { status: http, body, text } = await this.call("DELETE", `${SHARE_PATH}/${encodeURIComponent(id)}`, { token });
    if (http === 401) throw new ShareError(describe(1001, "PAT \u7F3A\u5931\u6216\u5931\u6548"), 1001, 401);
    if (!isObject4(body)) throw new ShareError(`\u64A4\u9500\u54CD\u5E94\u4E0D\u662F JSON\uFF08HTTP ${http}\uFF09\uFF1A${text.slice(0, 200)}`, -1, http);
    const code = Number(field2(body, "code") ?? 0);
    if (code !== 0) throw new ShareError(describe(code, field2(body, "message")), code, http);
    this.cache.delete(id);
    return { shareSessionId: id };
  }
  /**
   * 列本账号自己铸过的分享（`GET /share`，要 JWT）。列表键名还没有抓包定死，
   * 和会话列表一样取常见名字下的第一个数组。
   */
  async list(pageSize = 50) {
    const token = await this.token();
    const { status, body, text } = await this.call("GET", `${SHARE_PATH}?page_size=${pageSize}`, { token });
    if (status === 401) throw new ShareError(describe(1001, "PAT \u7F3A\u5931\u6216\u5931\u6548"), 1001, 401);
    if (!isObject4(body)) throw new ShareError(`\u5206\u4EAB\u5217\u8868\u4E0D\u662F JSON\uFF08HTTP ${status}\uFF09\uFF1A${text.slice(0, 200)}`, -1, status);
    const code = Number(field2(body, "code") ?? 0);
    if (code !== 0) throw new ShareError(describe(code, field2(body, "message")), code, status);
    const data = field2(body, "data");
    const raw = Array.isArray(data) ? data : isObject4(data) ? field2(data, "items", "shares", "share_sessions", "shareSessions", "list", "records") : void 0;
    const items = [];
    for (const entry of Array.isArray(raw) ? raw : []) {
      try {
        items.push({ ...parseSession({ code: 0, data: entry }), host: this.base() });
      } catch {
      }
    }
    return {
      items,
      keys: isObject4(data) ? Object.keys(data) : Array.isArray(data) ? ["<array>"] : [],
      host: this.base()
    };
  }
  /**
   * 列本账号的聊天会话 —— 真 `chat_session_id` 的唯一来源。铸链接前先跑一次
   * 这个，才知道该填什么。
   */
  async sessions(pageSize = 20) {
    const token = await this.token();
    const { status, body, text } = await this.call("GET", `${SESSIONS_PATH}?page_size=${pageSize}`, { token });
    if (status === 401) throw new ShareError(describe(1001, "PAT \u7F3A\u5931\u6216\u5931\u6548"), 1001, 401);
    if (!isObject4(body)) throw new ShareError(`\u4F1A\u8BDD\u5217\u8868\u4E0D\u662F JSON\uFF08HTTP ${status}\uFF09\uFF1A${text.slice(0, 200)}`, -1, status);
    const code = Number(field2(body, "code") ?? 0);
    if (code !== 0) throw new ShareError(describe(code, field2(body, "message")), code, status);
    const data = field2(body, "data");
    const list = Array.isArray(data) ? data : isObject4(data) ? field2(data, "items", "sessions", "chat_sessions", "chatSessions", "list", "records") : void 0;
    const items = Array.isArray(list) ? list.filter(isObject4) : [];
    return {
      items,
      raw: isObject4(data) ? data : {},
      // For the diagnostic line when the list comes back empty.
      keys: isObject4(data) ? Object.keys(data) : Array.isArray(data) ? ["<array>"] : [],
      host: this.base()
    };
  }
  /**
   * 一个真会话的全部 `turn_ids`（从它的消息里捞，注意填的是 user 消息的
   * `message_id`，见 `turnIdsOf`），按 `page_token` 翻完所有页 —— 只看第一页
   * 会把长会话的后半截漏掉。
   */
  async turnsOf(chatSessionId, signal) {
    const token = await this.token();
    const items = [];
    let pageToken;
    for (let page = 0; page < 50; page++) {
      const query = new URLSearchParams({ page_size: "100" });
      if (pageToken) query.set("page_token", pageToken);
      const { status, body, text } = await this.call(
        "GET",
        `${SESSIONS_PATH}/${encodeURIComponent(chatSessionId)}/messages?${query}`,
        { token, ...signal ? { signal } : {} }
      );
      if (status === 401) throw new ShareError(describe(1001, "PAT \u7F3A\u5931\u6216\u5931\u6548"), 1001, 401);
      if (!isObject4(body)) throw new ShareError(`\u4F1A\u8BDD\u6D88\u606F\u4E0D\u662F JSON\uFF08HTTP ${status}\uFF09\uFF1A${text.slice(0, 200)}`, -1, status);
      const code = Number(field2(body, "code") ?? 0);
      if (code !== 0) throw new ShareError(describe(code, field2(body, "message")), code, status);
      const parsed = parseMessages(body);
      items.push(...parsed.items);
      if (!parsed.hasMore || !parsed.nextToken) break;
      pageToken = parsed.nextToken;
    }
    return turnIdsOf(items);
  }
  // ------------------------------------------------------------ chat writes
  //
  // Everything below writes to Trae's chat service, which is a different layer
  // from llm_raw_chat (see the file header). Three measured facts shape it:
  //
  //  - the request body carries `content: []` — empty. The text goes in `query`
  //    and the server derives `content` from it. Sending both is harmless but
  //    pointless; sending only `content` and an empty `query` leaves the turn
  //    with nothing to answer.
  //  - `sendMessage` does **not** return a `turn_id`. The whole response is
  //    `{code, data: {message_id, accepted, status: 'in_progress'}, message}` —
  //    `message_id` is all a freshly started turn gives back.
  //  - minting a share does **not** require a settled turn. `POST
  //    /api/remote/v1/share` with that fresh `message_id`, 0.28s after
  //    `sendMessage` and with the model still running, answers 200 and hands
  //    back a `share_session_id`. The gate was never "can it be minted".
  //
  // What the gate really is: a link minted before the turn settles is a
  // **frozen snapshot**. Measured on such a link, 35s of it — `msgs=1`, the one
  // row the user wrote, `status: in_progress` at t+0s, t+5s, … t+35s. The
  // assistant answer never backfills, while the session side at that same
  // moment (`GET /chat_sessions/:id/messages`) already shows user and assistant
  // both `completed`. So settling is about the shared copy containing the
  // answer — not about getting past a 400.
  //
  // `turn_id` lands late, and lands as a pair: t+0.27s `sendMessage` returns
  // `message_id`; t+0.40s the user row reads `user:-:in_progress` (no `turn_id`
  // yet); t+4.07s both rows flip to `user:<turn_id>:completed` and
  // `assistant:<turn_id>:completed` carrying the *same* server-generated id.
  // Hence `waitForTurn` waits for two `completed` rows, not one.
  //
  // There is still no path that stores a turn without running the model:
  // `batch_sync_history` exists but wants a server-issued `handoff_id` (a
  // fabricated one is 409 991210), and `sendMessage` has no "store without
  // running" flag — `dry_run`, `append_only` and friends are silently ignored.
  // Mirroring N turns therefore costs N model calls.
  /** One user turn on the wire, as the Trae front end sends it. */
  sendBody(chatSessionId, text) {
    return {
      chat_session_id: chatSessionId,
      // Empty on purpose: the server fills `content` from `query`.
      content: [],
      query: JSON.stringify([{ type: "text", data: { content: text } }]),
      // Empty + `auto` lets upstream pick; a model name here would have to be
      // kept in step with the catalog by hand.
      model_name: "",
      agent_type: "",
      agent_id: null,
      model_selection_strategy: "auto",
      common_params: JSON.stringify({ solo_chat_mode: "work" })
    };
  }
  /**
   * Create an empty chat session on this client's host.
   *
   * `mode` and `env` are all that is needed; the front end sends a dozen more
   * fields for project and worktree setups, none of which a mirrored
   * conversation has. The consumer site also answers a `remote_project_id`,
   * the workspace it provisioned — not used here.
   */
  async createSession(mode = "work", env = "remote", signal) {
    const token = await this.token();
    const { status, body, text } = await this.call("POST", SESSIONS_PATH, {
      token,
      body: { mode, env },
      ...signal ? { signal } : {}
    });
    if (status === 401) throw new ShareError(describe(1001, "PAT \u7F3A\u5931\u6216\u5931\u6548"), 1001, 401);
    if (!isObject4(body)) throw new ShareError(`\u5EFA\u4F1A\u8BDD\u54CD\u5E94\u4E0D\u662F JSON\uFF08HTTP ${status}\uFF09\uFF1A${text.slice(0, 200)}`, -1, status);
    const code = Number(field2(body, "code") ?? 0);
    if (code !== 0) throw new ShareError(describe(code, field2(body, "message")), code, status);
    const data = field2(body, "data");
    const id = isObject4(data) ? field2(data, "chat_session_id", "chatSessionId") : void 0;
    if (typeof id !== "string" || !id) throw new ShareError("\u5EFA\u4F1A\u8BDD\u54CD\u5E94\u91CC\u6CA1\u6709 chat_session_id", 0, status);
    return id;
  }
  /**
   * Post one user message and return its `message_id`.
   *
   * That id exists immediately (t+0.27s measured) and is already enough to mint
   * a share with — but the turn is `in_progress` and has no `turn_id` yet, so a
   * link built now freezes on this single user row. `waitForTurn` is what makes
   * the answer part of the share.
   */
  async sendMessage(chatSessionId, text, signal) {
    const token = await this.token();
    const path = `${SESSIONS_PATH}/${encodeURIComponent(chatSessionId)}/messages`;
    const { status, body, text: raw } = await this.call("POST", path, {
      token,
      body: this.sendBody(chatSessionId, text),
      ...signal ? { signal } : {}
    });
    if (status === 401) throw new ShareError(describe(1001, "PAT \u7F3A\u5931\u6216\u5931\u6548"), 1001, 401);
    if (!isObject4(body)) throw new ShareError(`\u53D1\u6D88\u606F\u54CD\u5E94\u4E0D\u662F JSON\uFF08HTTP ${status}\uFF09\uFF1A${raw.slice(0, 200)}`, -1, status);
    const code = Number(field2(body, "code") ?? 0);
    if (code !== 0) throw new ShareError(describe(code, field2(body, "message")), code, status);
    const data = field2(body, "data");
    const id = isObject4(data) ? field2(data, "message_id", "messageId") : void 0;
    if (typeof id !== "string" || !id) throw new ShareError("\u53D1\u6D88\u606F\u54CD\u5E94\u91CC\u6CA1\u6709 message_id", 0, status);
    return id;
  }
  /** One page of message rows — the raw material `waitForTurn` polls for state. */
  async readMessages(chatSessionId, signal) {
    const token = await this.token();
    const query = new URLSearchParams({ page_size: "100" });
    const { status, body, text } = await this.call(
      "GET",
      `${SESSIONS_PATH}/${encodeURIComponent(chatSessionId)}/messages?${query}`,
      { token, ...signal ? { signal } : {} }
    );
    if (status === 401) throw new ShareError(describe(1001, "PAT \u7F3A\u5931\u6216\u5931\u6548"), 1001, 401);
    if (!isObject4(body)) throw new ShareError(`\u4F1A\u8BDD\u6D88\u606F\u4E0D\u662F JSON\uFF08HTTP ${status}\uFF09\uFF1A${text.slice(0, 200)}`, -1, status);
    const code = Number(field2(body, "code") ?? 0);
    if (code !== 0) throw new ShareError(describe(code, field2(body, "message")), code, status);
    return parseMessages(body).items;
  }
  /**
   * Wait for both sides of a turn to reach `completed`, then report the user row
   * a share points at plus the pair's `turn_id` and the answer text.
   *
   * Not a prerequisite for minting — a share minted right after `sendMessage`
   * returns 200 just fine. It is a prerequisite for the link to *contain* the
   * answer: the pre-settle snapshot stays at one `in_progress` user row and
   * never backfills (measured over 35s). Both rows flip to `completed` in the
   * same observation window (~4s in), user and assistant sharing one
   * server-issued `turn_id`, which is why this waits on the pair.
   *
   * The model runs a while (seconds to a minute); polling is the only signal
   * this API offers, as there is no per-turn status endpoint that is cheaper.
   */
  async waitForTurn(chatSessionId, userMessageId, options = {}) {
    const timeoutMs = options.timeoutMs ?? 12e4;
    const intervalMs = options.intervalMs ?? 2e3;
    const deadline = Date.now() + timeoutMs;
    for (; ; ) {
      if (options.signal?.aborted) throw new ShareError("\u7B49\u5F85\u56DE\u5408\u88AB\u53D6\u6D88", -1);
      const items = await this.readMessages(chatSessionId, options.signal);
      const user = items.find((m) => m.messageId === userMessageId);
      const assistant = items.find((m) => m.role === "assistant" && m.replyToMessageId === userMessageId) ?? items.find((m) => m.role === "assistant" && m.turnId && m.turnId === user?.turnId);
      if (user && user.status === "completed" && assistant && assistant.status === "completed") {
        return {
          userMessageId,
          ...user.turnId ? { turnId: user.turnId } : {},
          ...assistant.content ? { answer: assistant.content } : {}
        };
      }
      if (Date.now() >= deadline) {
        throw new ShareError(`\u7B49\u5F85\u56DE\u5408\u8D85\u65F6\uFF08${Math.round(timeoutMs / 1e3)}s\uFF09\uFF1A${userMessageId}`, -1);
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
};

// src/trae/mirror.ts
function textOfContent(content) {
  if (!content) return "";
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    return content;
  }
  if (Array.isArray(parsed)) {
    return parsed.map((part) => {
      if (typeof part !== "object" || part === null) return "";
      const p = part;
      return typeof p.text_content === "string" ? p.text_content : "";
    }).filter(Boolean).join("\n");
  }
  if (typeof parsed !== "object" || parsed === null) return "";
  const messages = parsed.messages;
  if (!Array.isArray(messages)) return "";
  const summaries = [];
  const thoughts = [];
  for (const entry of messages) {
    if (typeof entry !== "object" || entry === null) continue;
    const plan = entry.plan_item;
    if (typeof plan !== "object" || plan === null) continue;
    const info = plan.tool_call_info;
    if (typeof info === "object" && info !== null) {
      const params = info.params;
      if (typeof params === "object" && params !== null) {
        const summary = params.summary;
        if (typeof summary === "string" && summary.trim()) summaries.push(summary.trim());
      }
    }
    for (const key of ["thought", "reasoning_content"]) {
      const text = plan[key];
      if (typeof text === "string" && text.trim()) thoughts.push(text.trim());
    }
  }
  return summaries.join("\n") || thoughts.join("\n");
}
async function mirrorConversation(turns, options) {
  const host = (options.host?.trim() || "").replace(/\/+$/, "") || void 0;
  const share = new TraeShare({
    host: host ?? SHARE_API_ORIGIN,
    auth: options.auth,
    userAgent: options.userAgent,
    ...options.logger ? { logger: options.logger } : {},
    ttlMs: 0
  });
  const users = turns.filter((t) => t.role === "user");
  if (users.length === 0) throw new ShareError("\u6CA1\u6709 user \u56DE\u5408\u53EF\u955C\u50CF", -1);
  if (options.maxTurns <= 0) throw new ShareError("maxTurns \u5FC5\u987B\u4E3A\u6B63\u6570", -1);
  const wanted = users.slice(Math.max(0, users.length - options.maxTurns));
  options.logger?.info(
    `dsh-trae2api: \u955C\u50CF ${wanted.length} \u4E2A\u56DE\u5408\u5230 ${share.host}\uFF08= ${wanted.length} \u6B21\u6A21\u578B\u8C03\u7528\uFF09`
  );
  const chatSessionId = await share.createSession("work", "remote", options.signal);
  const userMessageIds = [];
  const answers = [];
  let partial = false;
  for (const turn of wanted) {
    if (options.signal?.aborted) {
      partial = true;
      break;
    }
    const messageId = await share.sendMessage(chatSessionId, turn.text, options.signal);
    try {
      const settled = await share.waitForTurn(chatSessionId, messageId, {
        ...options.turnTimeoutMs !== void 0 ? { timeoutMs: options.turnTimeoutMs } : {},
        ...options.signal ? { signal: options.signal } : {}
      });
      userMessageIds.push(settled.userMessageId);
      answers.push(textOfContent(settled.answer));
      options.logger?.info(
        `dsh-trae2api: \u56DE\u5408\u843D\u5730 ${settled.userMessageId}` + (settled.turnId ? `\uFF08turn ${settled.turnId}\uFF09` : "")
      );
    } catch (error) {
      userMessageIds.push(messageId);
      partial = true;
      const reason = error instanceof Error ? error.message : String(error);
      options.logger?.warn(`dsh-trae2api: \u56DE\u5408 ${messageId} \u672A\u7ED3\u7B97\uFF08${reason}\uFF09\uFF0C\u955C\u50CF\u4E2D\u6B62`);
      break;
    }
  }
  return { chatSessionId, userMessageIds, modelCalls: userMessageIds.length, answers, partial };
}
async function mirrorAndShare(turns, options) {
  const mirrored = await mirrorConversation(turns, options);
  if (mirrored.userMessageIds.length === 0) {
    throw new ShareError("\u955C\u50CF\u6CA1\u6709\u843D\u5730\u4EFB\u4F55\u56DE\u5408\uFF0C\u65E0\u6CD5\u751F\u6210\u5206\u4EAB", -1);
  }
  const host = (options.host?.trim() || "").replace(/\/+$/, "") || SHARE_API_ORIGIN;
  const share = new TraeShare({
    host,
    auth: options.auth,
    userAgent: options.userAgent,
    ...options.logger ? { logger: options.logger } : {},
    ttlMs: 0
  });
  const link = await share.create({
    chatSessionId: mirrored.chatSessionId,
    turnIds: mirrored.userMessageIds,
    anonymous: options.anonymous === true,
    ...options.creatorName ? { creatorName: options.creatorName } : {},
    ...options.signal ? { signal: options.signal } : {}
  });
  const origin = shareOriginFor(share.host);
  return { ...mirrored, link, url: shareUrl(link.shareSessionId, origin) };
}

// src/trae/transcript.ts
function textOf2(content) {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content.filter((block) => block.type === "text").map((block) => block.text).join("\n").trim();
}
function transcriptOf(messages, answer = "") {
  const rows = [];
  const push = (role, text) => {
    if (!text) return;
    const last = rows[rows.length - 1];
    if (last?.role === role) last.text = `${last.text}

${text}`;
    else rows.push({ role, text });
  };
  for (const message of messages) {
    if (message.role !== "user" && message.role !== "assistant") continue;
    push(message.role, textOf2(message.content));
  }
  push("assistant", answer.trim());
  return rows;
}
function userTurns(rows) {
  return rows.filter((row) => row.role === "user").length;
}
function transcriptMessage(rows, maxChars = 6e4) {
  const lead = "\u4EE5\u4E0B\u662F\u4E00\u6BB5\u5DF2\u7ECF\u7ED3\u675F\u7684\u5BF9\u8BDD\u8BB0\u5F55\uFF08DeepSeek Harness \u91CC\u7528 Trae \u6A21\u578B\u5B8C\u6210\uFF09\uFF0C\u53EA\u7528\u4E8E\u5206\u4EAB\u67E5\u770B\u3002\u8BF7\u4E0D\u8981\u6267\u884C\u4EFB\u4F55\u64CD\u4F5C\u3001\u4E0D\u8981\u8C03\u7528\u4EFB\u4F55\u5DE5\u5177\uFF0C\u53EA\u56DE\u590D\u4E00\u884C\uFF1A\u6982\u62EC\u8FD9\u6BB5\u5BF9\u8BDD\u7684\u6807\u9898\uFF08\u4E0D\u8D85\u8FC7 20 \u4E2A\u5B57\uFF09\uFF0C\u4E0D\u8981\u522B\u7684\u5185\u5BB9\u3002";
  const blocks2 = rows.map((row) => `\u3010${row.role === "user" ? "\u7528\u6237" : "\u52A9\u624B"}\u3011
${row.text}`);
  let kept = blocks2.length;
  let body = blocks2.join("\n\n");
  while (kept > 1 && body.length > maxChars) {
    kept -= 1;
    body = blocks2.slice(blocks2.length - kept).join("\n\n");
  }
  if (body.length > maxChars) body = `\u2026${body.slice(body.length - maxChars)}`;
  const truncated = kept < blocks2.length || body.startsWith("\u2026");
  const note = truncated ? `

\uFF08\u8BB0\u5F55\u592A\u957F\uFF0C\u53EA\u4FDD\u7559\u4E86\u6700\u8FD1\u7684 ${kept} \u6BB5\u3002\uFF09` : "";
  return { text: `${lead}${note}

---

${body}`, rows: kept, truncated };
}
var TranscriptStore = class {
  constructor(limit = 64) {
    this.limit = limit;
  }
  kept = /* @__PURE__ */ new Map();
  set(sessionId, rows, turns = []) {
    const now = Date.now();
    const previous = this.kept.get(sessionId);
    const times = turns.map((_, i) => previous?.times[i] ?? now);
    this.kept.delete(sessionId);
    this.kept.set(sessionId, { rows, turns, times, at: now });
    while (this.kept.size > this.limit) this.kept.delete(this.kept.keys().next().value);
  }
  get(sessionId) {
    return this.kept.get(sessionId);
  }
};

// src/trae/local-share.ts
import { createHash as createHash2 } from "node:crypto";
var LOCAL_SHARE_TURNS = 50;
var LOCAL_SHARE_STEPS = 120;
var LOCAL_SHARE_FIELD_CHARS = 4e3;
var LOCAL_SHARE_TEXT_CHARS = 2e4;
var HARNESS_NOTES = [
  /^\[model changed:[^\]]*\]\s*$/,
  /^Time sampled while preparing turn \d+, step \d+: .*$/
];
function stripNotes(text) {
  return text.split("\n").filter((line) => !HARNESS_NOTES.some((re) => re.test(line.trim()))).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
function blocks(message) {
  const content = message.content;
  if (typeof content === "string") return [{ type: "text", text: content }];
  return Array.isArray(content) ? content : [];
}
function textOf3(content) {
  return content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
}
function parseArgs(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    return { input: parsed };
  } catch {
    return raw ? { input: raw } : {};
  }
}
function conversationTurns(messages, answer, options = {}) {
  const turns = [];
  const calls = /* @__PURE__ */ new Map();
  let current;
  for (const message of messages) {
    const content = blocks(message);
    if (message.role === "user") {
      const text = stripNotes(textOf3(content));
      if (!text) continue;
      current = { user: text, steps: [], answer: "" };
      turns.push(current);
      continue;
    }
    if (!current) continue;
    if (message.role === "assistant") {
      const model = message.source?.model;
      if (model) current.model = model;
      let said = "";
      let thought = "";
      let called = false;
      for (const block of content) {
        if (block.type === "text") said = said ? `${said}
${block.text}` : block.text;
        else if (block.type === "reasoning") thought = thought ? `${thought}
${block.text}` : block.text;
        else if (block.type === "tool-call") {
          const tool = { id: String(block.id), name: block.name, args: parseArgs(block.arguments) };
          calls.set(tool.id, tool);
          current.steps.push({
            ...said.trim() ? { text: said.trim() } : {},
            ...thought.trim() ? { reasoning: thought.trim() } : {},
            tool
          });
          said = "";
          thought = "";
          called = true;
        }
      }
      if (!called) {
        current.answer = said.trim();
        if (thought.trim()) current.answerReasoning = thought.trim();
      } else if (said.trim() || thought.trim()) {
        current.steps.push({ ...said.trim() ? { text: said.trim() } : {}, ...thought.trim() ? { reasoning: thought.trim() } : {} });
      }
      continue;
    }
    if (message.role === "tool") {
      const id = String(message.toolCallId ?? "");
      const tool = calls.get(id);
      if (!tool) continue;
      tool.output = textOf3(content);
      if (message.isError) tool.isError = true;
    }
  }
  const last = turns[turns.length - 1];
  if (last) {
    if (answer.trim()) last.answer = answer.trim();
    if (options.reasoning?.trim()) last.answerReasoning = options.reasoning.trim();
    if (options.model) last.model = options.model;
  }
  return turns;
}
function objectId(seed) {
  return createHash2("sha1").update(seed).digest("hex").slice(0, 24);
}
var clip = (text, max = LOCAL_SHARE_FIELD_CHARS) => {
  if (!text) return "";
  return text.length <= max ? text : `${text.slice(0, max)}
\u2026\uFF08\u5DF2\u622A\u65AD\uFF0C\u539F\u6587 ${text.length} \u5B57\uFF09`;
};
function clipArgs(args) {
  const out = {};
  for (const [key, value] of Object.entries(args)) {
    out[key] = typeof value === "string" ? clip(value) : value;
  }
  return out;
}
var pick2 = (args, ...keys) => {
  for (const key of keys) if (typeof args[key] === "string" && args[key]) return args[key];
  return void 0;
};
function traeTool(name2, args) {
  const n = name2.toLowerCase();
  const path = pick2(args, "file_path", "path", "file", "filename", "filePath", "target_file");
  const params = clipArgs(args);
  if (/^(bash|shell|sh|exec|exec_command|run_command|run|terminal|command)$/.test(n) || /bash|shell|exec|command/.test(n)) {
    const command = pick2(args, "command", "cmd", "script", "input") ?? "";
    return { name: "Shell", params: { ...params, command: clip(command), description: pick2(args, "description") ?? "" } };
  }
  if (/^(read|read_file|view|view_file|cat|open)$/.test(n)) return { name: "Read", params: { ...params, ...path ? { file_path: path } : {} } };
  if (/^(write|write_file|create|create_file|write_to_file)$/.test(n)) return { name: "Write", params: { ...params, ...path ? { file_path: path } : {} } };
  if (/edit|replace|patch|apply/.test(n)) return { name: "Edit", params: { ...params, ...path ? { file_path: path } : {} } };
  if (/^(ls|list|list_dir|list_files|view_folder|tree)$/.test(n)) return { name: "LS", params: { ...params, ...path ? { path } : {} } };
  if (/^glob$/.test(n)) return { name: "Glob", params };
  if (/grep|search_files|file_search|find|ripgrep|rg/.test(n)) return { name: "Grep", params };
  if (/web_?search|search_web|websearch/.test(n)) return { name: "WebSearch", params: { ...params, query: pick2(args, "query", "q") ?? "" } };
  if (/fetch|browse|http|url/.test(n)) return { name: "WebFetch", params: { ...params, url: pick2(args, "url", "uri") ?? "" } };
  if (/todo/.test(n)) return { name: "TodoWrite", params };
  if (/ask_user|question/.test(n)) return { name: "AskUserQuestion", params };
  return { name: name2, params };
}
function toolResult(tool, name2) {
  const status = tool.isError ? "error" : "success";
  const output = clip(tool.output);
  if (name2 === "Shell") {
    return {
      status,
      images: null,
      is_truncated: null,
      render: null,
      data: {
        display_command: typeof (tool.args.command ?? tool.args.cmd) === "string" ? clip(String(tool.args.command ?? tool.args.cmd)) : "",
        exit_code: tool.isError ? 1 : 0,
        status: "completed",
        stdout: output
      }
    };
  }
  return { status, images: null, is_truncated: null, render: null, data: { output } };
}
function planItem(input) {
  return {
    id: objectId(`${input.seed}:entry`),
    type: "plan_item",
    plan_item: {
      agent_display_name: input.model || "DeepSeek Harness",
      agent_id: "solo_work_lite",
      agent_status: { run_mode: "foreground", status: input.done ? "completed" : "running" },
      hide: null,
      id: objectId(`${input.seed}:plan`),
      plan_type: null,
      reasoning_content: clip(input.reasoning),
      render_mode: null,
      thought: clip(input.thought),
      timing: { generated_at_ms: input.at, tool_call_started_at_ms: input.at, tool_call_finished_at_ms: input.at },
      tool_call_info: {
        id: objectId(`${input.seed}:call`),
        name: input.tool.name,
        params: input.tool.params,
        result: input.tool.result
      }
    }
  };
}
function localShareBody(turns, options) {
  const kept = turns.filter((turn) => turn.user && (turn.answer || turn.steps.length > 0));
  const shown = kept.slice(Math.max(0, kept.length - LOCAL_SHARE_TURNS));
  const offset = kept.length - shown.length;
  const session = objectId(`dsh:${options.sessionId}`);
  const messages = [];
  let clock = 0;
  const stamp = (at2) => {
    clock = Math.max(at2, clock + 1);
    return new Date(clock).toISOString();
  };
  shown.forEach((turn, index) => {
    const n = offset + index;
    const at2 = options.turnTimes?.[n] ?? options.updatedAt;
    const seed = `${session}:${n}`;
    const userId = objectId(`${seed}:user`);
    const turnId = objectId(`${seed}:turn`);
    const model = turn.model ?? "";
    messages.push({
      message_id: userId,
      turn_id: turnId,
      status: "completed",
      message_type: "general",
      role: "user",
      message_index: messages.length + 1,
      content: JSON.stringify([{ text_content: clip(turn.user, LOCAL_SHARE_TEXT_CHARS), type: "text" }]),
      query: JSON.stringify([{ type: "text", data: { content: clip(turn.user, LOCAL_SHARE_TEXT_CHARS) } }]),
      agent_type: "solo_work_lite",
      created_at: stamp(at2)
    });
    const steps = turn.steps.slice(Math.max(0, turn.steps.length - LOCAL_SHARE_STEPS));
    let carry = { text: [], reasoning: [] };
    const take = (step) => {
      const text = [...carry.text, ...step.text ? [step.text] : []].join("\n\n");
      const reasoning = [...carry.reasoning, ...step.reasoning ? [step.reasoning] : []].join("\n\n");
      carry = { text: [], reasoning: [] };
      return { ...text ? { thought: text } : {}, ...reasoning ? { reasoning } : {} };
    };
    const items = [];
    steps.forEach((step, i) => {
      if (!step.tool) {
        if (step.text) carry.text.push(step.text);
        if (step.reasoning) carry.reasoning.push(step.reasoning);
        return;
      }
      const mapped = traeTool(step.tool.name, step.tool.args);
      items.push(planItem({
        seed: `${seed}:step${i}`,
        model,
        done: false,
        at: at2,
        ...take(step),
        tool: { ...mapped, result: toolResult(step.tool, mapped.name) }
      }));
    });
    const tail = take({});
    const answerReasoning = [tail.reasoning, turn.answerReasoning].filter(Boolean).join("\n\n");
    items.push(planItem({
      seed: `${seed}:finish`,
      model,
      done: true,
      at: at2,
      ...tail.thought ? { thought: tail.thought } : {},
      ...answerReasoning ? { reasoning: answerReasoning } : {},
      tool: {
        name: "finish",
        params: { summary: clip(turn.answer, LOCAL_SHARE_TEXT_CHARS) || "\uFF08\u8FD9\u4E00\u8F6E\u6CA1\u6709\u6587\u5B57\u56DE\u7B54\uFF09" },
        result: { status: "success", images: null, is_truncated: null, render: null, data: { products: null, summary: "" } }
      }
    }));
    messages.push({
      message_id: objectId(`${seed}:assistant`),
      turn_id: turnId,
      status: "completed",
      message_type: "task",
      role: "assistant",
      message_index: messages.length + 1,
      reply_to_message_id: userId,
      content: JSON.stringify({ messages: items, task_id: objectId(`${seed}:task`) }),
      // `chat_start_time` / `chat_end_time` are read-only: either one on any
      // message gets the whole body refused with a bare `991102 invalid
      // parameter` (report v3 §5.2, found by bisecting a read-back share).
      references: "[]",
      doc_references: '{"documents":[]}',
      agent_type: "solo_work_lite",
      agent_name: model || "DeepSeek Harness",
      created_at: stamp(at2)
    });
  });
  const firstQuestion = shown[0]?.user.split("\n").find((line) => line.trim())?.trim() ?? "";
  const title = (options.title?.trim() || firstQuestion || "DeepSeek Harness \u5BF9\u8BDD").slice(0, 60);
  return {
    body: {
      local_session_id: session,
      chat_session_id: session,
      source_updated_at: new Date(options.updatedAt).toISOString(),
      title,
      mode: "work",
      anonymous: options.anonymous === true,
      creator_name: (options.creatorName ?? "").trim(),
      messages,
      resources: [],
      env: "local"
    },
    turns: shown.length,
    dropped: offset
  };
}

// src/trae/suggest.ts
import { randomUUID as randomUUID3 } from "node:crypto";
var MAX_SESSIONS = 64;
var USER_TURNS = 3;
var USER_CHARS = 1200;
var ANSWER_CHARS = 3e3;
var MAX_CARDS = 3;
var MAX_CHOICES = 4;
var MAX_TEXT = 200;
var SUGGEST_EXAMPLE = [
  {
    question: "\u8981\u628A README \u91CC\u8FC7\u65F6\u7684\u5B89\u88C5\u8DEF\u5F84\u6539\u6210 DSH NEXT.app \u5417\uFF1F",
    choices: [
      { label: "\u6539\u8DEF\u5F84", reply: "\u628A README \u91CC\u8FC7\u65F6\u7684\u5B89\u88C5\u8DEF\u5F84\u6539\u6210 DSH NEXT.app" },
      { label: "\u5148\u67E5\u53EF\u6267\u884C\u540D", reply: "\u5148\u67E5\u4E00\u4E0B DSH NEXT.app \u91CC\u5B9E\u9645\u7684\u53EF\u6267\u884C\u6587\u4EF6\u540D\uFF0C\u518D\u6539\u8DEF\u5F84" }
    ]
  },
  {
    question: "\u8981\u8865\u4E0A\u914D\u7F6E\u4F55\u65F6\u751F\u6548\u7684\u8BF4\u660E\u5417\uFF1F",
    choices: [
      { label: "\u8865\u8BF4\u660E", reply: "\u5728 README \u91CC\u8865\u4E0A profile \u914D\u7F6E\u6539\u5B8C\u540E\u4F55\u65F6\u751F\u6548\u7684\u8BF4\u660E" }
    ]
  }
];
var SUGGEST_SYSTEM = [
  "You read a coding-agent chat right after the assistant's latest answer and turn what it leaves open into cards the user answers with one click.",
  `Output ONLY a JSON array of 0 to ${MAX_CARDS} cards, most likely first:`,
  '[{"question": "...", "choices": [{"label": "...", "reply": "..."}]}]',
  "",
  "The bar for a card: real work the answer itself named, that nobody has done yet, that the user would plausibly want done now. Most answers leave none, so [] is the ordinary output, not a failure. One good card beats three padded ones; an unwanted card costs the user a close.",
  "Output [] when:",
  "- The answer only explains, describes or reports \u2014 a question answered, code read out, a status given \u2014 and proposes no work.",
  "- The answer already did what it set out to do and named nothing left over.",
  "- What is left is the user's to do by hand: look at a screen, read a page, decide a direction, try it themselves.",
  "- Nothing in the answer points at the work; you would have to invent it.",
  "",
  "Never make a card for:",
  "- More talk: explaining further, going deeper, saying it again shorter, listing other options.",
  "- Work the answer already finished, or work it says it is doing next in this same turn.",
  "- Routine hygiene the answer never raised: run the tests, write docs, refactor, commit, clean up.",
  "",
  "Splitting into cards:",
  "- One card per separate thing the answer found, proposed or offered: each problem to fix, each change to make, each command to run, each document to write. An answer that reports two problems is two cards, even if both could be done together.",
  "- Choices on one card are only alternative ways to handle that one thing (do it this way / that way; option A, B or C of one decision).",
  '- Never bundle: no "what next?" card spanning several things, no "do both" or "fix all" choice.',
  `- No "not now", "skip" or "something else" choices: every card already has its own close button and a box for the user's own answer.`,
  "",
  "Each card:",
  '- "question": one short question about that one thing (at most ~30 Chinese characters or ~15 English words).',
  `- "choices": 1 to ${MAX_CHOICES} answers, recommended first. They need not be yes/no \u2014 name the concrete options when there are several.`,
  '- "label": the button text, 1 to 6 words (at most ~10 Chinese characters).',
  '- "reply": the message sent when the button is pressed, written as the user, specific enough to act on by itself.',
  '- A bare agreement is not a reply: never "\u6539\u5427", "\u662F\u7684", "yes", "do it" or "the second one". Name the thing to do and where \u2014 "\u628A README \u91CC\u8FC7\u65F6\u7684\u5B89\u88C5\u8DEF\u5F84\u6539\u6210 DSH NEXT.app", not "\u6539\u5427". The question above it is context the reply must not depend on.',
  "- Write everything in the same language the user writes in.",
  "",
  "Example \u2014 the answer reported an outdated install path and a missing note on when config changes apply:",
  JSON.stringify(SUGGEST_EXAMPLE),
  "",
  "Example \u2014 the answer explained how the token cache expires, fixed nothing and offered nothing:",
  "[]",
  "",
  "No code fences, no explanation. When in doubt, output [] rather than a card the user has to close."
].join("\n");
var SUGGEST_SUBAGENT_RULES = [
  "",
  'Each "reply" is handed to a delegated subagent that cannot see this chat:',
  '- Write it as a self-contained task: name the files, paths, commands, ids and findings it needs, instead of "it", "that file" or "the second problem".',
  "- Keep the one thing its card is about; the subagent has no way to ask what you meant.",
  '- "label" and "question" still speak to the user, short as before.'
].join("\n");
function suggestSystem(subagent) {
  return subagent ? SUGGEST_SYSTEM + SUGGEST_SUBAGENT_RULES : SUGGEST_SYSTEM;
}
function textOf4(content) {
  return content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
}
var ASK_TOOLS = /* @__PURE__ */ new Set(["ask_user_question"]);
function followsAsk(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== "assistant") continue;
    return message.content.some((block) => block.type === "tool-call" && ASK_TOOLS.has(block.name));
  }
  return false;
}
var clip2 = (text, max, tail = false) => text.length <= max ? text : tail ? `\u2026${text.slice(-max)}` : `${text.slice(0, max)}\u2026`;
function suggestPrompt(turn) {
  const users = [];
  const messages = turn.options.messages;
  for (let i = messages.length - 1; i >= 0 && users.length < USER_TURNS; i--) {
    const message = messages[i];
    if (message.role !== "user") continue;
    const text = textOf4(message.content);
    if (text) users.unshift(clip2(text, USER_CHARS));
  }
  return [
    ...users.map((text, i) => `<user_message index="${i + 1}">
${text}
</user_message>`),
    `<assistant_answer>
${clip2(turn.answer.trim(), ANSWER_CHARS, true)}
</assistant_answer>`,
    "The cards, as the JSON array:"
  ].join("\n\n");
}
function cleanLine(raw) {
  if (typeof raw !== "string") return "";
  let text = raw.trim();
  text = text.replace(/^(?:user|用户|下一条消息|next message)\s*[:：]\s*/i, "");
  text = text.replace(/^["'“”‘’「」『』`]+|["'“”‘’「」『』`]+$/g, "").trim();
  return text.length > MAX_TEXT ? "" : text;
}
var EMPTY_REPLY = /^(?:好的?|行|可以|是的?|对|没问题|同意|确认|继续(?:吧)?|就这样|这样吧|都行|随你|要|需要|不用|算了|第[一二三四五六两]个|前者|后者|yes|yeah|yep|ok|okay|sure|do it|go ahead|please do|continue|proceed|both|(?:the )?(?:first|second|third|last) one)[\s。．.!！?？~～、,，;；]*$/i;
function sendable(reply) {
  return reply.length > 0 && !EMPTY_REPLY.test(reply);
}
function choiceOf(item) {
  if (typeof item === "string") {
    const text = cleanLine(item);
    return sendable(text) ? { label: text, reply: text } : void 0;
  }
  if (!item || typeof item !== "object") return void 0;
  const { label, reply } = item;
  const message = cleanLine(reply);
  return sendable(message) ? { label: cleanLine(label) || message, reply: message } : void 0;
}
function cardOf(item) {
  if (typeof item === "string") {
    const choice = choiceOf(item);
    return choice ? { question: "", choices: [choice] } : void 0;
  }
  if (!item || typeof item !== "object") return void 0;
  const { question, choices } = item;
  const kept = [];
  for (const entry of Array.isArray(choices) ? choices : []) {
    const choice = choiceOf(entry);
    if (choice && !kept.some((c) => c.reply === choice.reply)) kept.push(choice);
    if (kept.length === MAX_CHOICES) break;
  }
  return kept.length > 0 ? { question: cleanLine(question), choices: kept } : void 0;
}
function parseSuggestions(raw) {
  const text = raw.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/```(?:json)?/gi, "").trim();
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  let items;
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1));
      if (Array.isArray(parsed)) items = parsed;
    } catch {
    }
  }
  if (!items) {
    const line = text.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0) ?? "";
    items = line && !/^[[{]/.test(line) ? [line] : [];
  }
  const cards = [];
  for (const item of items) {
    const card = cardOf(item);
    if (card) cards.push(card);
    if (cards.length === MAX_CARDS) break;
  }
  return cards;
}
var TraeSuggestions = class {
  constructor(opts) {
    this.opts = opts;
  }
  entries = /* @__PURE__ */ new Map();
  /**
   * A turn ended with a plain answer: start working out what comes next —
   * unless the model has just asked through the host's own dialog.
   */
  turnEnded(turn) {
    if (!this.enabled() || !turn.answer.trim() || followsAsk(turn.options.messages)) return;
    this.drop(turn.sessionId);
    const abort = new AbortController();
    const entry = {
      id: randomUUID3(),
      at: Date.now(),
      conversationId: turn.conversation,
      cards: [],
      abort,
      pending: Promise.resolve(),
      accepted: false
    };
    entry.pending = this.generate(turn, abort.signal).then(
      (cards) => {
        entry.cards = cards;
      },
      (error) => {
        if (!abort.signal.aborted) this.opts.logger.warn(`dsh-trae2api: suggestion failed (${error instanceof Error ? error.message : String(error)})`);
      }
    );
    this.entries.set(turn.sessionId, entry);
    while (this.entries.size > MAX_SESSIONS) this.drop(this.entries.keys().next().value);
  }
  /** A new turn started: whatever was suggested for the last one is stale. */
  turnStarted(sessionId) {
    this.drop(sessionId);
  }
  /**
   * The current suggestion for a session, waiting up to `waitMs` for one that
   * is still being generated. `null` = nothing (yet) for this session.
   */
  async get(sessionId, waitMs) {
    if (!this.enabled()) {
      this.drop(sessionId);
      return null;
    }
    const entry = this.entries.get(sessionId);
    if (!entry) return null;
    if (waitMs > 0) {
      let timer;
      await Promise.race([entry.pending, new Promise((resolve) => {
        timer = setTimeout(resolve, waitMs);
      })]);
      clearTimeout(timer);
    }
    if (this.entries.get(sessionId) !== entry) return null;
    return { cards: entry.cards, at: entry.at, id: entry.id, subagent: this.delegates() };
  }
  /**
   * The composer showed suggestion `id`'s cards, or the user pressed button
   * `pick.choice` on card `pick.card`. Each happens at most once per
   * suggestion, and only for the session's current, non-empty one; the visible
   * time is measured here, not taken from the browser. Resolves to whether an
   * event went out.
   */
  async record(sessionId, id, action, pick3) {
    const entry = this.entries.get(sessionId);
    if (!entry || entry.id !== id || entry.cards.length === 0 || entry.accepted) return false;
    const now = Date.now();
    const base = { resp_id: entry.id, type: "", conversation_id: entry.conversationId };
    let event;
    if (action === "shown") {
      if (entry.shownAt !== void 0) return false;
      entry.shownAt = now;
      event = { event: "code_gen_shown", payload: base };
    } else {
      const chosen = pick3 ? entry.cards[pick3.card]?.choices[pick3.choice] : void 0;
      if (!chosen) return false;
      entry.accepted = true;
      entry.shownAt ??= now;
      event = {
        event: "code_gen_accept",
        payload: {
          ...base,
          accept_content: chosen.reply,
          accept_prefix: "",
          accept_suffix: "",
          suggestion_visible_duration: now - entry.shownAt,
          tab_mode: ""
        }
      };
    }
    if (!this.opts.report) return false;
    try {
      return await this.opts.report([event]);
    } catch (error) {
      this.opts.logger.warn(`dsh-trae2api: Cue report failed (${error instanceof Error ? error.message : String(error)})`);
      return false;
    }
  }
  /** Whether cards are offered at all, as configured right now. */
  enabled() {
    const { enabled } = this.opts;
    return (typeof enabled === "function" ? enabled() : enabled) !== false;
  }
  /** Whether a pressed button goes to a subagent, as configured right now. */
  delegates() {
    const { subagent } = this.opts;
    return (typeof subagent === "function" ? subagent() : subagent) === true;
  }
  drop(sessionId) {
    const entry = this.entries.get(sessionId);
    if (!entry) return;
    entry.abort.abort();
    this.entries.delete(sessionId);
  }
  async generate(turn, signal) {
    const timeout = AbortSignal.timeout(this.opts.timeoutMs);
    const both = AbortSignal.any([signal, timeout]);
    const raw = await this.opts.complete(
      this.opts.model || turn.model,
      suggestSystem(this.delegates()),
      suggestPrompt(turn),
      both
    );
    return parseSuggestions(raw);
  }
};

// src/trae/tob.ts
var TOB_CONSOLE_HOST = "https://console.enterprise.trae.cn";
var TOB_LOGIN_PATH = "/trae/gtm/tob/api/v1/account/login";
var TOB_QUOTA_PATH = "/trae/gtm/tob/api/v1/config/get_personal_quota";
var TOB_USAGE_PATH = "/trae/gtm/tob/api/v1/config/get_user_model_usage";
var TOB_SESSION_COOKIE = "X-Cloudide-Tob-Session";
var NOT_LOGGED_IN = 30011;
function isObject5(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function num(value) {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : void 0;
}
function costOf(list) {
  if (!Array.isArray(list)) return 0;
  let total = 0;
  for (const entry of list) {
    if (isObject5(entry)) total += num(entry.total_cost_currency) ?? 0;
  }
  return total;
}
function parseTobQuota(quotaBody, usageBody, now = Date.now()) {
  const quota = isObject5(quotaBody) && isObject5(quotaBody.user_model_quota) ? quotaBody.user_model_quota : void 0;
  const list = isObject5(usageBody) && Array.isArray(usageBody.user_usage_list) ? usageBody.user_usage_list : [];
  let seatUsed = 0;
  let paygoUsed = 0;
  const models = [];
  for (const entry of list) {
    if (!isObject5(entry)) continue;
    const inSeat = isObject5(entry.in_seat_detail) ? entry.in_seat_detail : void 0;
    seatUsed += num(entry.seat_total_cost_currency) ?? costOf(inSeat?.chat_usage_details);
    paygoUsed += num(entry.extra_total_cost_currency) ?? costOf(entry.model_usage_detail_list);
    for (const source of [inSeat?.chat_usage_details, entry.model_usage_detail_list]) {
      if (!Array.isArray(source)) continue;
      for (const model of source) {
        if (!isObject5(model)) continue;
        const tokens = num(model.total_token_usage) ?? 0;
        const cost = num(model.total_cost_currency) ?? 0;
        if (tokens === 0 && cost === 0) continue;
        const name2 = typeof model.display_name === "string" && model.display_name.trim() ? model.display_name.trim() : typeof model.config_name === "string" ? model.config_name : "\u2014";
        models.push({ name: name2, tokens, cost });
      }
    }
  }
  models.sort((a, b) => b.cost - a.cost);
  const packs = [];
  const add = (name2, limit, used) => {
    if (limit === void 0 || limit === 0) return;
    const unlimited2 = limit < 0;
    packs.push({ name: name2, limit: unlimited2 ? null : limit, used, remaining: unlimited2 ? null : Math.max(limit - used, 0) });
  };
  add("\u5E2D\u4F4D\u989D\u5EA6", num(quota?.seat_pool_currency_quota), seatUsed);
  add("\u8D85\u989D\uFF08\u6309\u91CF\uFF09", num(quota?.paygo_currency_quota), paygoUsed);
  const unlimited = packs.some((pack) => pack.limit === null);
  return {
    packs,
    limit: unlimited ? null : packs.reduce((sum, pack) => sum + pack.limit, 0),
    used: packs.reduce((sum, pack) => sum + pack.used, 0),
    remaining: unlimited ? null : packs.reduce((sum, pack) => sum + pack.remaining, 0),
    dollars: false,
    fetchedAt: now,
    seat: "enterprise",
    ...typeof quota?.tenant_id === "string" ? { tenant: quota.tenant_id } : {},
    ...models.length > 0 ? { models: models.slice(0, 12) } : {}
  };
}
var TobConsole = class {
  constructor(opts) {
    this.opts = opts;
  }
  session;
  /** Forget the session (the account or password changed). */
  reset() {
    this.session = void 0;
  }
  /**
   * The seat's quota, or `undefined` when no console account is configured.
   * @throws when the console refuses the login or the reads.
   */
  async read(now = Date.now()) {
    const email = (await this.opts.readEmail())?.trim();
    const password = (await this.opts.readPassword())?.trim();
    if (!email || !password) return void 0;
    if (!this.session) await this.login(email, password);
    let quota;
    let usage;
    try {
      [quota, usage] = await this.pair();
    } catch (error) {
      if (!(error instanceof TobSessionError)) throw error;
      this.session = void 0;
      await this.login(email, password);
      [quota, usage] = await this.pair();
    }
    const snapshot2 = parseTobQuota(quota, usage, now);
    snapshot2.source = `${this.host()}${TOB_QUOTA_PATH}`;
    return snapshot2;
  }
  pair() {
    return Promise.all([this.post(TOB_QUOTA_PATH, {}), this.post(TOB_USAGE_PATH, {})]);
  }
  host() {
    return this.opts.host.trim().replace(/\/+$/, "") || TOB_CONSOLE_HOST;
  }
  async login(email, password) {
    const host = this.host();
    let res;
    try {
      res = await fetch(`${host}${TOB_LOGIN_PATH}`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ Email: email, Password: password }),
        signal: AbortSignal.timeout(2e4)
      });
    } catch (error) {
      throw new Error(`Trae\uFF1A\u65E0\u6CD5\u8FDE\u63A5\u4F01\u4E1A\u63A7\u5236\u53F0 ${host}\uFF08${error instanceof Error ? error.message : String(error)}\uFF09`);
    }
    const cookie = sessionFrom(res);
    const body = await res.json().catch(() => void 0);
    const code = isObject5(body) ? num(body.code) : void 0;
    if (!res.ok || code !== void 0 && code !== 0) {
      const message = isObject5(body) && typeof body.message === "string" ? body.message : `HTTP ${res.status}`;
      throw new Error(`Trae\uFF1A\u4F01\u4E1A\u63A7\u5236\u53F0\u767B\u5F55\u5931\u8D25\uFF08${message}\uFF09\u3002\u8BF7\u68C0\u67E5\u90AE\u7BB1\u4E0E\u5BC6\u7801\uFF1BSSO \u767B\u5F55\u7684\u8D26\u53F7\u65E0\u6CD5\u7528\u8FD9\u6761\u8DEF\u5F84\u3002`);
    }
    if (!cookie) throw new Error("Trae\uFF1A\u4F01\u4E1A\u63A7\u5236\u53F0\u767B\u5F55\u6210\u529F\u4F46\u6CA1\u6709\u8FD4\u56DE\u4F1A\u8BDD cookie\uFF0C\u63A5\u53E3\u53EF\u80FD\u5DF2\u6539\u3002");
    this.session = cookie;
  }
  async post(path, body) {
    const host = this.host();
    let res;
    try {
      res = await fetch(`${host}${path}`, {
        method: "POST",
        headers: { ...this.headers(), cookie: `${TOB_SESSION_COOKIE}=${this.session ?? ""}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(2e4)
      });
    } catch (error) {
      throw new Error(`Trae\uFF1A\u65E0\u6CD5\u8FDE\u63A5\u4F01\u4E1A\u63A7\u5236\u53F0 ${host}\uFF08${error instanceof Error ? error.message : String(error)}\uFF09`);
    }
    const answer = await res.json().catch(() => void 0);
    if (!isObject5(answer)) throw new Error(`Trae\uFF1A\u4F01\u4E1A\u63A7\u5236\u53F0 ${path} \u8FD4\u56DE\u7684\u4E0D\u662F JSON\uFF08HTTP ${res.status}\uFF09`);
    const code = num(answer.code);
    if (code === NOT_LOGGED_IN) throw new TobSessionError();
    if (code !== void 0 && code !== 0) {
      const message = typeof answer.message === "string" ? answer.message : "";
      throw new Error(`Trae\uFF1A\u4F01\u4E1A\u63A7\u5236\u53F0 ${path} \u62D2\u7EDD\u4E86\u8BF7\u6C42\uFF08${code}${message ? ` ${message}` : ""}\uFF09`);
    }
    return answer;
  }
  headers() {
    const host = this.host();
    return {
      "content-type": "application/json",
      accept: "application/json",
      "accept-language": "zh",
      "user-agent": this.opts.userAgent,
      origin: host,
      referer: `${host}/personal/usage`
    };
  }
};
var TobSessionError = class extends Error {
  constructor() {
    super("session expired");
  }
};
function sessionFrom(res) {
  const headers = res.headers;
  const all = headers.getSetCookie?.() ?? (res.headers.get("set-cookie") ? [res.headers.get("set-cookie")] : []);
  for (const line of all) {
    const match = new RegExp(`${TOB_SESSION_COOKIE}=([^;]+)`, "i").exec(line);
    if (match) return match[1];
  }
  return void 0;
}

// src/index.ts
var name = "dsh-trae2api";
var inject = ["llm"];
var CLIENT_VERSION = "0.206.1-tob";
var SHARE_HOST = SHARE_API_ORIGIN;
var QUOTA_ROUTE = "/api/dsh-trae2api/quota";
var CATALOG_ROUTE = "/api/dsh-trae2api/catalog";
var SESSION_ROUTE = "/api/dsh-trae2api/session";
var SUGGESTION_ROUTE = "/api/dsh-trae2api/suggestion";
var SUGGESTION_MAX_WAIT_MS = 3e4;
var SUGGESTION_EVENT_ROUTE = "/api/dsh-trae2api/suggestion/event";
var SHARE_ROUTE = "/api/dsh-trae2api/share";
var CUE_USER_ID_ENV = "TRAE_USER_ID";
var Config = Schema.object({
  provider: Schema.string().pattern(/^[a-z0-9][a-z0-9-]*$/).default("trae"),
  displayName: Schema.string().default("Trae"),
  patEnv: Schema.string().role("credential-ref").default("TRAE_PAT").volatile().description("Trae \u4E2A\u4EBA\u8BBF\u95EE\u4EE4\u724C\uFF08PAT\uFF09\u5728\u51ED\u636E\u5E93\u91CC\u7684\u540D\u5B57"),
  host: Schema.string().default(TRAE_HOST),
  shareHost: Schema.string().default(SHARE_HOST).description("\u5206\u4EAB\u63A5\u53E3\u6240\u5728\u7684\u7AD9\u70B9\uFF1B\u7A7A = trae-api-cn.mchost.guru\uFF08TRAE SOLO CN \u5BA2\u6237\u7AEF\u7684\u5199\u63A5\u53E3\uFF0C\u94FE\u63A5\u62FC\u5728 share.traecontent.cn \u4E0A\uFF09\u3002\u4F01\u4E1A\u7248\u4E0E\u6D88\u8D39\u7248\u662F\u4E24\u4E2A\u72EC\u7ACB\u7684\u5206\u4EAB\u547D\u540D\u7A7A\u95F4\uFF0C\u4E92\u4E0D\u53EF\u89C1"),
  payHost: Schema.string().default(""),
  consoleHost: Schema.string().default(TOB_CONSOLE_HOST),
  consoleEmail: Schema.string().default(""),
  consoleEmailEnv: Schema.string().role("credential-ref").default("TRAE_CONSOLE_EMAIL").volatile().description("\u4F01\u4E1A\u63A7\u5236\u53F0\u90AE\u7BB1\u5728\u51ED\u636E\u5E93\u91CC\u7684\u540D\u5B57"),
  consolePasswordEnv: Schema.string().role("credential-ref").default("TRAE_CONSOLE_PASSWORD").volatile().description("\u4F01\u4E1A\u63A7\u5236\u53F0\u5BC6\u7801\u5728\u51ED\u636E\u5E93\u91CC\u7684\u540D\u5B57"),
  clientId: Schema.string().default(CLI_CLIENT_ID),
  appId: Schema.string().default("7b3f9dc2-8a4e-5c6d-2f1b-9e4a3c5b7df0"),
  ideVersionCode: Schema.string().default("20260908"),
  clientVersion: Schema.string().default(CLIENT_VERSION),
  catalogSource: Schema.union(["auto", "upstream", "cache", "builtin"]).default("auto").description("\u6A21\u578B\u76EE\u5F55\u6765\u6E90\uFF1Aauto = \u4E0A\u6E38 \u2192 traecli \u7F13\u5B58 \u2192 \u5185\u7F6E"),
  catalogFunctions: Schema.array(Schema.string()).default([CHAT_FUNCTION]).description(`\u95EE\u4E0A\u6E38\u8981\u76EE\u5F55\u7684\u901A\u9053\uFF08function\uFF09\uFF1Bchat \u4E4B\u5916\u7684\u90A3\u4E9B\u5355\u72EC\u53D1\u4E00\u6B21\u8BF7\u6C42\uFF0C\u95EE\u4E0D\u5230\u5C31\u53EA\u7528 chat \u7684\u90A3\u4EFD\u3002\u4F01\u4E1A\u7248\u5B9E\u6D4B\u53EA\u6709 chat \u4E0A\u67B6\u6A21\u578B\uFF0C\u60F3\u8BD5\u522B\u7684\u586B ${EXTRA_CATALOG_FUNCTIONS.join(" / ")}`),
  modelsCacheFile: Schema.string().default("").description("traecli \u6A21\u578B\u7F13\u5B58\u8DEF\u5F84\uFF1B\u7A7A = ~/.trae/cli/models_cache.json"),
  contextBudgetTokens: Schema.natural().default(0).description("\u672C\u5730\u4E0A\u4E0B\u6587\u9884\u7B97\u4E0A\u9650\uFF08token\uFF09\uFF1B0 = \u7528\u6A21\u578B\u81EA\u5DF1\u7684\u7A97\u53E3\u3002\u53EA\u6539\u538B\u7F29\u65F6\u673A\uFF0C\u4E0D\u6539\u4E0A\u6E38\u670D\u52A1\u7684\u7A97\u53E3\uFF08Max \u6A21\u578B\u60F3\u8981\u534A\u6B65\u5C31\u586B 500000\uFF09"),
  readTimeoutMs: Schema.natural().default(3e5),
  emptyRetries: Schema.natural().default(1),
  loopGuardChars: Schema.natural().default(600),
  recoverTextToolCalls: Schema.boolean().default(true).description("\u628A\u6A21\u578B\u5199\u6210 <invoke> \u6587\u672C\u7684\u5DE5\u5177\u8C03\u7528\u6062\u590D\u6210\u771F\u5B9E\u8C03\u7528\uFF08\u4EE3\u7801\u5757\u91CC\u7684\u3001\u6B63\u6587\u4E2D\u95F4\u7684\u4E00\u5F8B\u4E0D\u7B97\uFF09"),
  suggestions: Schema.boolean().default(true).volatile().description("\u6BCF\u8F6E\u56DE\u7B54\u540E\u5728\u8F93\u5165\u6846\u4E0A\u65B9\u7ED9\u51FA\u4E0B\u4E00\u6B65\u5361\u7247\uFF1B\u5173\u6389\u5C31\u4E00\u5F20\u4E5F\u4E0D\u751F\u6210\uFF0C\u4E5F\u4E0D\u4F1A\u591A\u82B1\u90A3\u6B21\u4FA7\u8FB9\u8BF7\u6C42"),
  suggestModel: Schema.string().default(""),
  suggestTimeoutMs: Schema.natural().default(2e4),
  suggestSubagent: Schema.boolean().default(true).volatile().description("\u70B9\u4E0B\u4E00\u6B65\u5361\u7247\u65F6\u4EA4\u7ED9\u5B50\u4F1A\u8BDD\uFF08subagent \u5DE5\u5177\uFF09\u53BB\u505A\uFF0C\u800C\u4E0D\u662F\u5728\u5F53\u524D\u4F1A\u8BDD\u91CC\u76F4\u63A5\u52A8\u624B\uFF1B\u5361\u7247\u4E0A\u4F1A\u5199\u660E"),
  reportCue: Schema.boolean().default(true),
  cueUserId: Schema.string().default("")
});
function apply(ctx, config) {
  const logger = ctx.logger;
  const anyCtx = ctx;
  const settingsNs = anyCtx.fiber?.entry?.options?.id ?? "trae2api";
  try {
    anyCtx.inject(
      ["settings"],
      (child) => {
        child.effect(() => child.settings.configure({ auto: false }, anyCtx.fiber));
      }
    );
  } catch (error) {
    logger.warn("dsh-trae2api: settings integration unavailable", error);
  }
  const host = config.host.replace(/\/+$/, "");
  const userAgent = `codex_exec/${config.clientVersion} (dsh-trae2api) unknown (codex_exec; ${config.clientVersion})`;
  const readSecret = async (ref) => {
    const credentials = anyCtx.get("credentials");
    let value;
    try {
      value = (await credentials?.resolve(ref))?.value;
    } catch {
    }
    return value || process.env[ref] || void 0;
  };
  const auth = new TraeAuth({
    host,
    clientId: config.clientId,
    userAgent,
    readSecret: () => readSecret(config.patEnv.get())
  });
  const tob = new TobConsole({
    host: config.consoleHost,
    userAgent,
    // The card writes the e-mail to the credential store like the password, so
    // saving the pair never has to touch config; `consoleEmail` stays as a
    // config-file escape hatch.
    readEmail: async () => await readSecret(config.consoleEmailEnv.get()) || config.consoleEmail,
    readPassword: () => readSecret(config.consolePasswordEnv.get())
  });
  const identity = {
    appId: config.appId,
    ideFunction: "chat",
    ideVersion: "99.99.99",
    ideVersionCode: config.ideVersionCode,
    clientVersion: config.clientVersion,
    originator: "codex_exec",
    userAgent
  };
  const catalog = new TraeCatalog({
    mode: config.catalogSource,
    cacheFile: config.modelsCacheFile || MODELS_CACHE_FILE,
    functions: config.catalogFunctions.length > 0 ? config.catalogFunctions : [CHAT_FUNCTION],
    ...config.catalogSource === "builtin" ? {} : {
      fetchUpstream: async (signal, payload2) => {
        const body = JSON.stringify(payload2);
        let session = await auth.get();
        for (let attempt = 0; ; attempt++) {
          const res = await fetch(`${host}${CATALOG_PATH}`, {
            method: "POST",
            headers: traeHeaders(identity, session.token, "application/json"),
            body,
            signal
          });
          if ((res.status === 401 || res.status === 403) && attempt === 0) {
            await res.body?.cancel();
            session = await auth.get(true);
            continue;
          }
          if (!res.ok) throw new Error(`HTTP ${res.status}\uFF1A${(await res.text()).slice(0, 200)}`);
          return await res.json();
        }
      }
    },
    logger
  });
  const userInfo = new TraeUserInfo({ host: config.consoleHost, auth, userAgent });
  const cueUserId = (config.cueUserId || process.env[CUE_USER_ID_ENV] || "").trim();
  const cue = config.reportCue ? new TraeCueReporter({
    host,
    auth,
    appId: identity.appId,
    ideVersion: identity.ideVersion,
    ideVersionCode: identity.ideVersionCode,
    userAgent,
    user: async () => {
      const user = await userInfo.get();
      return cueUserId ? { ...user, userId: cueUserId } : user;
    }
  }) : void 0;
  const transcripts = new TranscriptStore();
  const suggestions = new TraeSuggestions({
    complete: (model, system, user, signal) => adapter.complete(model, system, user, signal),
    model: config.suggestModel,
    timeoutMs: config.suggestTimeoutMs,
    enabled: () => config.suggestions.get(),
    subagent: () => config.suggestSubagent.get(),
    ...cue ? { report: (events) => cue.report(events) } : {},
    logger
  });
  const adapter = new TraeAdapter({
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
      try {
        return anyCtx.get("attachments");
      } catch {
        return void 0;
      }
    },
    onTurnStart: (sessionId) => {
      suggestions.turnStarted(sessionId);
    },
    onTurnEnd: (turn) => {
      try {
        transcripts.set(
          turn.sessionId,
          transcriptOf(turn.options.messages, turn.answer),
          conversationTurns(turn.options.messages, turn.answer, {
            ...turn.reasoning ? { reasoning: turn.reasoning } : {},
            model: turn.model
          })
        );
      } catch {
      }
      suggestions.turnEnded(turn);
    },
    logger
  });
  const quota = new TraeQuota({
    host,
    payHost: config.payHost,
    auth,
    userAgent,
    headers: (token) => traeHeaders(identity, token, "application/json"),
    tob
  });
  const share = new TraeShare({
    host: (config.shareHost.trim() || SHARE_HOST).replace(/\/+$/, ""),
    auth,
    userAgent,
    logger
  });
  const shareClients = /* @__PURE__ */ new Map([[share.host, share]]);
  if (!shareClients.has(host)) {
    shareClients.set(host, new TraeShare({ host, auth, userAgent, logger }));
  }
  let bylineMissLogged = false;
  const creatorNameFor = async (input) => {
    if (typeof input.creatorName === "string" && input.creatorName.trim()) return input.creatorName.trim();
    if (input.anonymous === true) return "";
    let user;
    try {
      user = await userInfo.get();
    } catch {
    }
    if (user?.username) return user.username;
    let session;
    try {
      session = await auth.get();
    } catch {
    }
    if (session?.name) return session.name;
    if (!bylineMissLogged) {
      bylineMissLogged = true;
      logger.info(`dsh-trae2api: share byline has no name; GetUserInfo UserInfo keys [${(user?.infoKeys ?? []).join(", ")}], JWT data keys [${(session?.claimKeys ?? []).join(", ")}]`);
    }
    return "";
  };
  ctx.on("credentials/reference-updated", ((ref) => {
    if (ref === config.patEnv.get()) {
      auth.reset();
      quota.reset();
      userInfo.reset();
      catalog.reset();
      for (const c of shareClients.values()) c.reset();
    }
    if (ref === config.consolePasswordEnv.get() || ref === config.consoleEmailEnv.get()) {
      tob.reset();
      quota.reset();
    }
  }));
  ctx.on("loader/volatile-update", (() => {
    auth.reset();
    quota.reset();
    userInfo.reset();
    catalog.reset();
    for (const c of shareClients.values()) c.reset();
  }));
  void catalog.ready().catch(() => {
  });
  anyCtx.inject(["connection"], (child) => {
    try {
      child.connection.fetch.register({
        path: QUOTA_ROUTE,
        methods: ["GET"],
        requestBody: "buffered",
        fetch: async (request) => {
          const force = new URL(request.url).searchParams.has("refresh");
          try {
            return Response.json({ ok: true, value: await quota.get(force) });
          } catch (error) {
            return Response.json({ ok: false, error: error instanceof Error ? error.message : String(error) });
          }
        }
      });
    } catch (error) {
      logger.warn("dsh-trae2api: quota route unavailable", error);
    }
    try {
      child.connection.fetch.register({
        path: CATALOG_ROUTE,
        methods: ["GET"],
        requestBody: "buffered",
        fetch: async (request) => {
          const force = new URL(request.url).searchParams.has("refresh");
          try {
            const snapshot2 = force ? await catalog.refresh(true) : await catalog.ready();
            return Response.json({
              ok: true,
              value: {
                origin: snapshot2.origin,
                at: snapshot2.at,
                ...snapshot2.note ? { note: snapshot2.note } : {},
                models: snapshot2.routes.map((r) => ({
                  id: r.id,
                  key: r.key,
                  contextWindow: r.contextWindow,
                  maxMode: r.maxMode,
                  multimodal: r.multimodal,
                  efforts: r.efforts
                }))
              }
            });
          } catch (error) {
            return Response.json({ ok: false, error: error instanceof Error ? error.message : String(error) });
          }
        }
      });
    } catch (error) {
      logger.warn("dsh-trae2api: catalog route unavailable", error);
    }
    try {
      child.connection.fetch.register({
        path: SESSION_ROUTE,
        methods: ["GET"],
        requestBody: "buffered",
        fetch: async (request) => {
          const sessionId = new URL(request.url).searchParams.get("session") ?? "";
          if (!sessionId) return Response.json({ ok: false, error: "expected ?session=<id>" }, { status: 400 });
          const turn = adapter.sessionInfo(sessionId);
          let userId = "";
          if (turn) {
            try {
              userId = (await userInfo.get()).userId;
            } catch {
            }
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
              debug: turn ? traeDebugLine({
                userId,
                ...turn.trace ? { traceId: turn.trace } : {},
                sessionId: turn.conversation,
                // The client's own naming rule and the TRAE SOLO version the
                // format was read from, so support reads a line in the shape
                // it knows; `traceId` is what ties it to the real request.
                appName: traeAppName(isCnHost(host)),
                appVersion: TRAE_APP_VERSION,
                at: turn.at
              }) : null
            }
          });
        }
      });
    } catch (error) {
      logger.warn("dsh-trae2api: session route unavailable", error);
    }
    try {
      child.connection.fetch.register({
        path: SUGGESTION_ROUTE,
        methods: ["GET"],
        requestBody: "buffered",
        fetch: async (request) => {
          const params = new URL(request.url).searchParams;
          const sessionId = params.get("session") ?? "";
          const wait = Math.min(SUGGESTION_MAX_WAIT_MS, Math.max(0, Number(params.get("wait")) || 0));
          const value = sessionId ? await suggestions.get(sessionId, wait) : null;
          return Response.json({ ok: true, value });
        }
      });
    } catch (error) {
      logger.warn("dsh-trae2api: suggestion route unavailable", error);
    }
    try {
      child.connection.fetch.register({
        path: SUGGESTION_EVENT_ROUTE,
        methods: ["POST"],
        requestBody: "buffered",
        fetch: async (request) => {
          let input;
          try {
            input = await request.json();
          } catch {
            return Response.json({ ok: false, error: "invalid JSON" }, { status: 400 });
          }
          const { session, id, action, card, choice } = input;
          const index = (n) => Number.isInteger(n) && n >= 0;
          if (typeof session !== "string" || typeof id !== "string" || action !== "shown" && action !== "accept" || action === "accept" && !(index(card) && index(choice))) {
            return Response.json({ ok: false, error: 'expected { session, id, action: "shown" | "accept", card, choice }' }, { status: 400 });
          }
          const pick3 = index(card) && index(choice) ? { card, choice } : void 0;
          const reported = await suggestions.record(session, id, action, pick3);
          return Response.json({ ok: true, reported });
        }
      });
    } catch (error) {
      logger.warn("dsh-trae2api: suggestion event route unavailable", error);
    }
    try {
      child.connection.fetch.register({
        path: SHARE_ROUTE,
        methods: ["GET", "POST"],
        requestBody: "buffered",
        fetch: async (request) => {
          const url = new URL(request.url);
          try {
            if (request.method === "GET") {
              if (url.searchParams.has("sessions")) {
                const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("page_size")) || 20));
                const probes = [];
                const found = [];
                for (const client of shareClients.values()) {
                  try {
                    const answer = await client.sessions(pageSize);
                    probes.push({ host: answer.host, count: answer.items.length, keys: answer.keys });
                    for (const session2 of answer.items) found.push({ host: answer.host, session: session2 });
                    if (answer.items.length) break;
                  } catch (error) {
                    probes.push({
                      host: client.host,
                      error: error instanceof Error ? error.message : String(error),
                      ...error instanceof ShareError ? { code: error.code } : {}
                    });
                  }
                }
                for (const { host: from, session: session2 } of found.slice(0, 10)) {
                  logger.info(`dsh-trae2api: share session on ${from}: ${JSON.stringify(Object.fromEntries(
                    Object.entries(session2).filter(([, v]) => typeof v !== "object" || v === null).map(([k, v]) => [k, typeof v === "string" ? v.slice(0, 60) : v])
                  ))}`);
                }
                logger.info(`dsh-trae2api: share sessions ${probes.map((p) => p.error ? `${p.host} error ${p.code ?? ""} ${p.error}` : `${p.host} ${p.count} item(s), data keys [${(p.keys ?? []).join(", ")}]`).join("; ")}`);
                if (found.length === 0 && probes.every((p) => p.error)) {
                  return Response.json({ ok: false, error: probes.map((p) => `${p.host}: ${p.error}`).join("\uFF1B"), probes }, { status: 502 });
                }
                const str = (s, ...keys) => {
                  for (const key of keys) if (typeof s[key] === "string" && s[key]) return s[key];
                  return void 0;
                };
                return Response.json({
                  ok: true,
                  value: found.map(({ host: from, session: s }) => ({
                    chatSessionId: str(s, "chat_session_id", "chatSessionId", "session_id", "sessionId", "id") ?? "",
                    name: str(s, "name", "title", "session_name", "sessionName"),
                    status: str(s, "status"),
                    mode: str(s, "mode"),
                    updatedAt: s.updated_at ?? s.updatedAt ?? void 0,
                    host: from
                  })).filter((s) => s.chatSessionId),
                  probes
                });
              }
              if (url.searchParams.has("mine")) {
                const probes = [];
                const items = [];
                for (const client of shareClients.values()) {
                  try {
                    const answer = await client.list();
                    probes.push({ host: answer.host, count: answer.items.length, keys: answer.keys });
                    for (const item of answer.items) {
                      items.push({
                        shareSessionId: item.shareSessionId,
                        url: shareUrl(item.shareSessionId, shareOriginFor(answer.host)),
                        title: item.title,
                        status: item.status,
                        shareType: item.shareType,
                        createdAt: item.createdAt,
                        expiresAt: item.expiresAt,
                        host: answer.host
                      });
                    }
                  } catch (error) {
                    probes.push({ host: client.host, error: error instanceof Error ? error.message : String(error) });
                  }
                }
                logger.info(`dsh-trae2api: my shares ${probes.map((p) => p.error ? `${p.host} error ${p.error}` : `${p.host} ${p.count} item(s), data keys [${(p.keys ?? []).join(", ")}]`).join("; ")}`);
                if (items.length === 0 && probes.every((p) => p.error)) {
                  return Response.json({ ok: false, error: probes.map((p) => `${p.host}: ${p.error}`).join("\uFF1B"), probes }, { status: 502 });
                }
                return Response.json({ ok: true, value: items, probes });
              }
              if (url.searchParams.has("transcript")) {
                const kept = transcripts.get(url.searchParams.get("transcript") ?? "");
                return Response.json({
                  ok: true,
                  value: kept ? {
                    rows: kept.rows.length,
                    questions: userTurns(kept.rows),
                    turns: kept.turns.length,
                    steps: kept.turns.reduce((n, turn) => n + turn.steps.length, 0),
                    at: kept.at
                  } : null
                });
              }
              const id = url.searchParams.get("id") ?? "";
              if (!id) return Response.json({ ok: false, error: "expected ?id=<share_session_id> or ?sessions=1" }, { status: 400 });
              const session = await share.get(id, { force: url.searchParams.has("refresh") });
              const pageOrigin = shareOriginFor(session.host ?? share.host);
              const pageUrl = session.shareType === "artifact" && session.artifactPath ? artifactUrl(id, pageOrigin) : shareUrl(id, pageOrigin);
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
                  entries: session.entries
                }
              });
            }
            let input;
            try {
              input = await request.json();
            } catch {
              return Response.json({ ok: false, error: "invalid JSON" }, { status: 400 });
            }
            let action = typeof input.action === "string" ? input.action : "create";
            let writer = typeof input.host === "string" && shareClients.get(input.host.replace(/\/+$/, "")) || share;
            if (action === "disable" || action === "enable" || action === "delete") {
              if (typeof input.id !== "string" || !input.id) {
                return Response.json({ ok: false, error: `expected { action:"${action}", id }` }, { status: 400 });
              }
              const value = action === "delete" ? await writer.remove(input.id) : await writer.setStatus(input.id, action === "enable" ? "active" : "disabled");
              logger.info(`dsh-trae2api: share ${input.id} on ${writer.host}: ${action}`);
              return Response.json({ ok: true, value });
            }
            if (typeof input.session === "string" && input.session && input.chatSessionId === void 0) {
              const kept = transcripts.get(input.session);
              const rows = Array.isArray(input.turns) && input.turns.length > 0 ? input.turns : kept?.rows;
              if (!rows || rows.length === 0) {
                return Response.json({
                  ok: false,
                  code: "NO_TRANSCRIPT",
                  error: "\u63D2\u4EF6\u8FD8\u6CA1\u770B\u5230\u8FD9\u6761\u4F1A\u8BDD\u7684\u5BF9\u8BDD\u5185\u5BB9\uFF1A\u8981\u5728\u63D2\u4EF6\u542F\u52A8\u540E\u7528 Trae \u6A21\u578B\u8DD1\u5B8C\u4E00\u8F6E\uFF0C\u624D\u80FD\u5206\u4EAB\u3002\u53D1\u4E00\u8F6E\u518D\u70B9\u3002"
                }, { status: 400 });
              }
              const mode = input.mode === "replay" || input.mode === "transcript" || input.mode === "local" ? input.mode : Array.isArray(input.turns) && input.turns.length > 0 ? "replay" : "local";
              if (mode === "local") {
                if (!kept || kept.turns.length === 0) {
                  return Response.json({ ok: false, code: "NO_TRANSCRIPT", error: "\u63D2\u4EF6\u8FD8\u6CA1\u770B\u5230\u8FD9\u6761\u4F1A\u8BDD\u7684\u5BF9\u8BDD\u5185\u5BB9\uFF1A\u8981\u5728\u63D2\u4EF6\u542F\u52A8\u540E\u7528 Trae \u6A21\u578B\u8DD1\u5B8C\u4E00\u8F6E\uFF0C\u624D\u80FD\u5206\u4EAB\u3002\u53D1\u4E00\u8F6E\u518D\u70B9\u3002" }, { status: 400 });
                }
                const creatorName2 = await creatorNameFor(input);
                const built = localShareBody(kept.turns, {
                  sessionId: input.session,
                  creatorName: creatorName2,
                  anonymous: input.anonymous === true,
                  turnTimes: kept.times,
                  updatedAt: kept.at
                });
                const bytes = Buffer.byteLength(JSON.stringify(built.body));
                try {
                  const link2 = await share.createLocal(built.body);
                  logger.info(`dsh-trae2api: share current session ${input.session} as local conversation on ${share.host} (${bytes} bytes): ${built.turns} turn(s)${built.dropped ? `, ${built.dropped} older dropped` : ""} -> ${link2.shareSessionId} (${link2.status ?? "?"})`);
                  return Response.json({
                    ok: true,
                    value: {
                      url: link2.url,
                      link: link2,
                      title: link2.title,
                      turns: built.turns,
                      dropped: built.dropped,
                      modelCalls: 0,
                      host: share.host
                    }
                  });
                } catch (error) {
                  logger.info(`dsh-trae2api: share current session ${input.session} as local conversation refused (${bytes} bytes): ${error instanceof Error ? error.message : String(error)}`);
                  throw error;
                }
              }
              if (mode === "transcript") {
                const message = transcriptMessage(rows);
                input.turns = [{ role: "user", text: message.text }];
                input.maxTurns = 1;
              } else {
                input.turns = rows;
              }
              input.host = share.host;
              action = "mirror";
              logger.info(`dsh-trae2api: share current session ${input.session} via mirror (${mode}, ${rows.length} row(s), ${userTurns(rows)} question(s))`);
            }
            if (action === "mirror") {
              if (!Array.isArray(input.turns)) {
                return Response.json({ ok: false, error: 'expected { action:"mirror", turns: [{ role, text }], maxTurns }' }, { status: 400 });
              }
              const turns = [];
              for (const entry of input.turns) {
                if (typeof entry !== "object" || entry === null) continue;
                const row = entry;
                const role = row.role;
                const text = row.text;
                if (role !== "user" && role !== "assistant" || typeof text !== "string" || !text) continue;
                turns.push({ role, text });
              }
              if (turns.filter((t) => t.role === "user").length === 0) {
                return Response.json({ ok: false, error: "turns \u91CC\u6CA1\u6709 user \u56DE\u5408\u53EF\u955C\u50CF" }, { status: 400 });
              }
              const maxTurns = Number(input.maxTurns);
              if (!Number.isInteger(maxTurns) || maxTurns <= 0) {
                return Response.json({
                  ok: false,
                  error: "expected maxTurns: a positive integer (each user turn is one model call)",
                  userTurns: turns.filter((t) => t.role === "user").length
                }, { status: 400 });
              }
              const mirrorHost = typeof input.host === "string" && shareClients.get(input.host.replace(/\/+$/, ""))?.host || share.host;
              try {
                const byline = await creatorNameFor(input);
                const mirrored = await mirrorAndShare(turns, {
                  auth,
                  host: mirrorHost,
                  userAgent,
                  maxTurns,
                  ...byline ? { creatorName: byline } : {},
                  ...input.anonymous === true ? { anonymous: true } : {},
                  logger
                });
                logger.info(
                  `dsh-trae2api: mirrored ${mirrored.modelCalls} turn(s) into ${mirrored.chatSessionId} on ${mirrorHost} -> ${mirrored.link.shareSessionId}${mirrored.partial ? " (partial)" : ""}`
                );
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
                    host: mirrorHost
                  }
                });
              } catch (error) {
                const code = error instanceof ShareError ? error.code : void 0;
                return Response.json({
                  ok: false,
                  error: error instanceof Error ? error.message : String(error),
                  ...code !== void 0 ? { code } : {}
                }, { status: error instanceof ShareError && error.status ? error.status : 502 });
              }
            }
            if (action !== "create") {
              return Response.json({ ok: false, error: 'expected action: "create" | "disable" | "mirror"' }, { status: 400 });
            }
            if (typeof input.chatSessionId !== "string" || !input.chatSessionId) {
              return Response.json({ ok: false, error: "expected { chatSessionId } or { session } \u2014 see ?sessions=1 for the ids" }, { status: 400 });
            }
            const chatSessionId = input.chatSessionId;
            const tag = `chat session ${chatSessionId}`;
            let allTurns;
            if (!Array.isArray(input.turnIds)) {
              try {
                allTurns = await writer.turnsOf(chatSessionId);
              } catch (error) {
                logger.info(`dsh-trae2api: share ${tag} on ${writer.host}: reading turns failed: ${error instanceof Error ? error.message : String(error)}`);
                throw error;
              }
            }
            const turnIds = Array.isArray(input.turnIds) ? input.turnIds.filter((t) => typeof t === "string" && t !== "") : latestTurns(allTurns);
            const creatorName = await creatorNameFor(input);
            if (turnIds.length === 0) {
              logger.info(`dsh-trae2api: share ${tag} on ${writer.host}: no turns`);
              return Response.json({
                ok: false,
                error: "\u8FD9\u6761\u4F1A\u8BDD\u91CC\u6CA1\u6709\u53EF\u5206\u4EAB\u7684\u8F6E\u6B21\uFF08\u6CA1\u6709\u5E26 turn_id \u7684\u56DE\u7B54\uFF09"
              }, { status: 400 });
            }
            let link;
            try {
              link = await writer.create({
                chatSessionId,
                turnIds,
                anonymous: input.anonymous === true,
                creatorName,
                skipAudit: input.skipAudit === true
              });
            } catch (error) {
              logger.info(`dsh-trae2api: share ${tag} on ${writer.host}: create failed: ${error instanceof Error ? error.message : String(error)}`);
              throw error;
            }
            let reachable;
            let readableOnWriter;
            if (link.status === "passed") {
              try {
                await share.get(link.shareSessionId, { force: true });
                reachable = true;
              } catch (error) {
                if (error instanceof ShareError && error.code === 992700) reachable = false;
              }
              if (reachable === false && writer !== share) {
                try {
                  await writer.get(link.shareSessionId, { force: true });
                  readableOnWriter = true;
                } catch {
                  readableOnWriter = false;
                }
              }
            }
            logger.info(`dsh-trae2api: share ${tag} on ${writer.host}: minted ${link.shareSessionId} status ${link.status ?? "?"} turns ${turnIds.length} reachable ${reachable ?? "?"} readable-on-writer ${readableOnWriter ?? "?"}`);
            return Response.json({
              ok: true,
              value: {
                ...link,
                host: writer.host,
                turnCount: turnIds.length,
                ...allTurns ? { totalTurns: allTurns.length } : {},
                ...reachable !== void 0 ? { reachable } : {},
                ...readableOnWriter !== void 0 ? { readableOnWriter } : {}
              }
            });
          } catch (error) {
            const code = error instanceof ShareError ? error.code : void 0;
            const status = error instanceof ShareError && error.status ? error.status : 502;
            return Response.json({
              ok: false,
              error: error instanceof Error ? error.message : String(error),
              ...code !== void 0 ? { code } : {}
            }, { status });
          }
        }
      });
    } catch (error) {
      logger.warn("dsh-trae2api: share route unavailable", error);
    }
  });
  ctx.llm.registerAdapter([config.provider], adapter);
  ctx.llm.registerConfigurableProviders([
    { provider: config.provider, displayName: config.displayName, settingsNs, settingsPath: [] }
  ]);
}
export {
  CATALOG_ROUTE,
  Config,
  QUOTA_ROUTE,
  SESSION_ROUTE,
  SHARE_ROUTE,
  SUGGESTION_EVENT_ROUTE,
  SUGGESTION_ROUTE,
  apply,
  inject,
  name
};
