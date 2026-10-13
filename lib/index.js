// src/index.ts
import Schema from "@deepseek-ai/schemastery";

// src/adapter.ts
import { randomUUID as randomUUID2 } from "node:crypto";
import {
  LlmAdapter,
  LlmError
} from "@deepseek-ai/dsh-llm";

// src/trae/catalog.ts
var LIGHT_HIGH = ["light", "high"];
var LIGHT_HIGH_EXTRA = ["light", "high", "extra_high"];
var LOW_HIGH = ["low", "high"];
var HIGH_XHIGH = ["high", "xhigh"];
var NONE = [];
var MAX_1M = 1e6;
var TRAE_MODELS = [
  // Max without a catalog max_key: strategy marker only.
  { id: "Doubao-Seed-Evolving", configName: "Doubao-Seed-Evolving", key: "Doubao-Seed-Evolving__dev", contextWindow: 184e3, efforts: LIGHT_HIGH, defaultEffort: "high", max: { contextWindow: MAX_1M } },
  { id: "Doubao-Seed-2.1-Pro-0915", configName: "Doubao-Seed-2.1-pro", key: "Doubao-Seed-2.1-pro__dev", contextWindow: 184e3, efforts: LIGHT_HIGH, defaultEffort: "high", max: { contextWindow: MAX_1M } },
  // The client table reports 256K for this one, above the catalog's 200K.
  { id: "Doubao-Seed-2.1-Turbo", configName: "Doubao-Seed-2.1-turbo", key: "Doubao-Seed-2.1-turbo__dev", contextWindow: 256e3, efforts: LOW_HIGH, defaultEffort: "high" },
  { id: "Doubao-Seed-2.0-Code", configName: "Doubao-Seed-2.0-Code", key: "Doubao-Seed-2.0-Code__dev", contextWindow: 184e3, efforts: LIGHT_HIGH, defaultEffort: "high" },
  { id: "Doubao-Seed-Code", configName: "Doubao_1_6", key: "Doubao_1_6__dev", contextWindow: 184e3, efforts: NONE },
  { id: "GLM-5.3-FlashX", configName: "glm-5.3-flashx", key: "glm-5.3-flashx__dev", contextWindow: 2e5, efforts: LIGHT_HIGH_EXTRA, defaultEffort: "high", max: { key: "glm-5.3-flashx__max", contextWindow: MAX_1M } },
  { id: "Step-5-Preview", configName: "step-5-preview", key: "step-5-preview__dev", contextWindow: 2e5, efforts: LIGHT_HIGH, defaultEffort: "high", max: { key: "step-5-preview__max", contextWindow: MAX_1M } },
  { id: "GLM-5.3-Flash", configName: "glm-5.3-flash", key: "glm-5.3-flash__dev", contextWindow: 2e5, efforts: LIGHT_HIGH_EXTRA, defaultEffort: "high", max: { key: "glm-5.3-flash__max", contextWindow: MAX_1M } },
  { id: "GLM-5.3", configName: "glm-5.3", key: "glm-5.3__dev", contextWindow: 2e5, efforts: LIGHT_HIGH_EXTRA, defaultEffort: "high", max: { key: "glm-5.3__max", contextWindow: MAX_1M } },
  // Catalog ships a max_key, but the client table says this model has no Max.
  { id: "GLM-5.2", configName: "glm-5.2", key: "glm-5.2__dev", contextWindow: 2e5, efforts: HIGH_XHIGH, defaultEffort: "high" },
  { id: "GLM-5V-Turbo", configName: "glm-5v-turbo", key: "glm-5v-turbo__dev", contextWindow: 2e5, efforts: NONE },
  { id: "MiniMax-M3", configName: "minimax-m3", key: "minimax-m3__dev", contextWindow: 2e5, efforts: NONE, max: { key: "minimax-m3__max", contextWindow: MAX_1M } },
  { id: "MiniMax-M2.7", configName: "minimax-m2.7", key: "minimax-m2.7__dev", contextWindow: 2e5, efforts: NONE },
  { id: "Qwen3.8-Max", configName: "qwen3.8-max", key: "qwen3.8-max__dev", contextWindow: 2e5, efforts: LIGHT_HIGH_EXTRA, defaultEffort: "high", max: { key: "qwen3.8-max__max", contextWindow: MAX_1M } },
  { id: "Qwen3.7-Plus", configName: "qwen-3.7-plus", key: "qwen-3.7-plus__dev", contextWindow: 2e5, efforts: NONE, max: { key: "qwen-3.7-plus__max", contextWindow: MAX_1M } },
  { id: "Kimi-K2.8-Preview", configName: "kimi-k2.8-preview", key: "kimi-k2.8-preview__dev", contextWindow: 2e5, efforts: LIGHT_HIGH_EXTRA, defaultEffort: "extra_high", max: { key: "kimi-k2.8-preview__max", contextWindow: MAX_1M } },
  { id: "Kimi-K3", configName: "kimi-k3", key: "kimi-k3__dev", contextWindow: 2e5, efforts: LIGHT_HIGH_EXTRA, defaultEffort: "extra_high", max: { key: "kimi-k3__max", contextWindow: MAX_1M } },
  { id: "Kimi-K2.7-Code", configName: "kimi-k2.7-code", key: "kimi-k2.7-code__dev", contextWindow: 2e5, efforts: NONE },
  { id: "MiMo-V2.6-Pro", configName: "mimo-v2.6-pro", key: "mimo-v2.6-pro__dev", contextWindow: 2e5, efforts: NONE, max: { key: "mimo-v2.6-pro__max", contextWindow: MAX_1M } },
  { id: "MiMo-V2.6-Flash", configName: "mimo-v2.6-flash", key: "mimo-v2.6-flash__dev", contextWindow: 2e5, efforts: NONE, max: { key: "mimo-v2.6-flash__max", contextWindow: MAX_1M } },
  { id: "DeepSeek-V4.1-Flash", configName: "DeepSeek-V4.1-Flash", key: "DeepSeek-V4.1-Flash__dev", contextWindow: 2e5, efforts: LIGHT_HIGH_EXTRA, defaultEffort: "high", max: { key: "DeepSeek-V4.1-Flash__max", contextWindow: MAX_1M } },
  { id: "DeepSeek-V4-Pro \u6B63\u5F0F\u7248", configName: "DeepSeek-V4-Pro-Official", key: "DeepSeek-V4-Pro-Official__dev", contextWindow: 2e5, efforts: LIGHT_HIGH_EXTRA, defaultEffort: "high", max: { key: "DeepSeek-V4-Pro-Official__max", contextWindow: MAX_1M } },
  // Catalog ships a max_key, but the client table says this model has no Max.
  { id: "DeepSeek-V4-Pro", configName: "deepseek-V4-Pro", key: "deepseek-V4-Pro__dev", contextWindow: 2e5, efforts: HIGH_XHIGH, defaultEffort: "high" },
  { id: "DeepSeek-V4-Flash \u6B63\u5F0F\u7248", configName: "DeepSeek-V4-Flash-Official", key: "deepseek_v4_flash_official__dev", contextWindow: 2e5, efforts: LIGHT_HIGH_EXTRA, defaultEffort: "high", max: { key: "deepseek_v4_flash_official__max", contextWindow: MAX_1M } }
];
var EFFORT_NAMES = {
  light: "Light \u8F7B",
  low: "Low \u8F7B",
  high: "High \u9AD8",
  extra_high: "Extra High \u6781\u9AD8",
  xhigh: "Extra High \u6781\u9AD8"
};
var TRAE_ROUTES = TRAE_MODELS.map((model) => {
  const max = model.max;
  return {
    id: model.id,
    configName: model.configName,
    // Without a `max_key`, Max keeps the standard key and rides the marker.
    key: max?.key ?? model.key,
    contextWindow: max?.contextWindow ?? model.contextWindow,
    efforts: model.efforts,
    ...model.defaultEffort ? { defaultEffort: model.defaultEffort } : {},
    maxMode: max !== void 0
  };
});
var byId = /* @__PURE__ */ new Map();
for (const route of TRAE_ROUTES) {
  const model = TRAE_MODELS.find((m) => m.configName === route.configName);
  for (const alias of [route.id, route.configName, route.key, model.key]) {
    byId.set(alias, route);
    byId.set(alias.toLowerCase(), route);
  }
}
function findModel(id) {
  return byId.get(id) ?? byId.get(id.toLowerCase());
}

// src/trae/wire.ts
import { createHash, randomUUID } from "node:crypto";
function textOf(content, imageNote) {
  const parts2 = [];
  for (const block of content) {
    if (block.type === "text") parts2.push(block.text);
    else if (block.type === "image" && imageNote) parts2.push("[image omitted]");
  }
  return parts2.join("\n\n");
}
var parts = (text) => [{ type: "text", text }];
function rawMessages(options) {
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
      case "user":
        out.push({ role: "user", content: parts(textOf(message.content, true)) });
        break;
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
      const at = unused.indexOf(id);
      if (at >= 0) {
        unused.splice(at, 1);
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
function toTraeMessages(options) {
  return repairToolHistory(rawMessages(options));
}
function toTraeTools(tools) {
  return (tools ?? []).map((t) => ({
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
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") return void 0;
    try {
      const parsed = JSON.parse(payload);
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
var RATE_LIMIT = ["rate limit", "rate-limit", "rate limited", "too many requests", "quota exceeded", "exceeded your quota"];
var OVERLOADED = ["unavailable", "all models failed", "timeout", "try again"];
var PROVIDER_STATUS = /status[ _]?code[:=]\s*(\d{3})/;
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
  if (Number(data.code) === 4023) detail += "\uFF08\u4E0A\u6E38\u4E0D\u8BA4\u8BC6\u8FD9\u4E2A\u6A21\u578B\u540D\uFF1A\u63D2\u4EF6\u5185\u7F6E\u7684\u6A21\u578B\u76EE\u5F55\u4E0E x-ide-version-code \u4E0D\u540C\u4EE3\uFF09";
  return detail.replace(/\n/g, " ").slice(0, 400);
}
function classify(data) {
  const reason = upstreamMessage(data).toLowerCase();
  const code = Number(data.code) || 0;
  const m = PROVIDER_STATUS.exec(reason);
  const status = m ? Number(m[1]) : void 0;
  if (status !== void 0 && status >= 400 && status <= 599) {
    if (status === 429) return { code: "RATE_LIMIT", retryable: true };
    if (status < 500) return { code: "INVALID_REQUEST", retryable: false };
    return { code: "PROVIDER_UNAVAILABLE", retryable: true };
  }
  if (RATE_LIMIT.some((x) => reason.includes(x))) return { code: "RATE_LIMIT", retryable: true };
  if (code === 3003 || OVERLOADED.some((x) => reason.includes(x))) return { code: "PROVIDER_UNAVAILABLE", retryable: true };
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
  span;
  maxUnit;
  minRepeats;
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
var TextToolCallSniffer = class {
  constructor(schemas) {
    this.schemas = schemas;
  }
  schemas;
  buffer = "";
  capturing = false;
  feed(text) {
    if (this.schemas.size === 0 || !text) return { visible: text, calls: [] };
    this.buffer += text;
    const visible = [];
    const calls = [];
    while (this.step(visible, calls)) {
    }
    return { visible: visible.join(""), calls };
  }
  flush() {
    if (this.schemas.size === 0) return { visible: "", calls: [] };
    const visible = [];
    const calls = [];
    while (this.step(visible, calls)) {
    }
    visible.push(this.buffer);
    this.buffer = "";
    this.capturing = false;
    return { visible: visible.join(""), calls };
  }
  step(visible, calls) {
    if (this.capturing) {
      const end = this.buffer.indexOf(INVOKE_CLOSE);
      if (end < 0) return false;
      const block = this.buffer.slice(0, end + INVOKE_CLOSE.length);
      this.buffer = this.buffer.slice(end + INVOKE_CLOSE.length);
      this.capturing = false;
      const call = this.parse(block);
      if (call) calls.push(call);
      else visible.push(block);
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
      let hold = 0;
      for (let size = Math.min(this.buffer.length, LONGEST - 1); size > 0; size--) {
        const tail = this.buffer.slice(-size);
        if (STARTS.some((m) => m.startsWith(tail))) {
          hold = size;
          break;
        }
      }
      const release = this.buffer.slice(0, this.buffer.length - hold);
      this.buffer = this.buffer.slice(this.buffer.length - hold);
      if (release) visible.push(release);
      return false;
    }
    if (index > 0) visible.push(this.buffer.slice(0, index));
    if (WRAPPERS.includes(marker)) {
      this.buffer = this.buffer.slice(index + marker.length);
      return true;
    }
    this.buffer = this.buffer.slice(index);
    this.capturing = true;
    return true;
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
function effortFor(route, requested) {
  if (!requested || route.efforts.length === 0) return void 0;
  const lower = requested.toLowerCase();
  if (route.efforts.includes(lower)) return lower;
  const rung = { none: 0, minimal: 0, light: 0, low: 0, medium: 1, high: 1, extra_high: 2, xhigh: 2, max: 2, ultra: 2 }[lower];
  if (rung === void 0) return void 0;
  const ladder = [["light", "low"], ["high"], ["extra_high", "xhigh"]];
  return ladder[rung].find((name2) => route.efforts.includes(name2));
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
  opts;
  providerInfo(provider) {
    return { id: provider, name: this.opts.displayName };
  }
  /**
   * The catalog is built in, but listing also proves the PAT works: an
   * unconfigured or rejected PAT makes the model picker show the reason
   * instead of a silently missing group.
   */
  async listModels(provider) {
    await this.opts.auth.get();
    return TRAE_ROUTES.map((r) => ({
      provider,
      id: r.id,
      name: r.id,
      description: r.maxMode ? "1M \u4E0A\u4E0B\u6587\uFF08Max\uFF09" : `${Math.round(r.contextWindow / 1e3)}K \u4E0A\u4E0B\u6587`,
      inputModalities: ["text"]
    }));
  }
  resolveModel(provider, model) {
    const known = findModel(model);
    const info = {
      provider,
      id: model,
      name: known?.id ?? model,
      inputModalities: ["text"],
      // Hard-coded per model from the IDE capability table, so the loop plans
      // compaction against the window the backend actually enforces.
      context: { contextWindow: known?.contextWindow ?? 2e5 }
    };
    if (known && known.efforts.length > 0) {
      info.reasoning = {
        efforts: known.efforts.map((e) => ({ id: e, name: EFFORT_NAMES[e] })),
        ...known.defaultEffort ? { defaultEffort: known.defaultEffort } : {}
      };
    }
    return Promise.resolve(info);
  }
  headers(token) {
    const id = this.opts.identity;
    return {
      "content-type": "application/json",
      accept: "text/event-stream",
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
  /** One POST; yields decoded events. Retries once with a fresh JWT on 401/403. */
  async *once(body, signal) {
    let session = await this.opts.auth.get();
    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        res = await fetch(`${this.opts.host}${CHAT_PATH}`, { method: "POST", headers: this.headers(session.token), body, signal });
      } catch (error) {
        if (signal.aborted) throw error;
        throw new LlmError(`Trae\uFF1A\u65E0\u6CD5\u8FDE\u63A5 ${this.opts.host}\uFF08${error instanceof Error ? error.message : String(error)}\uFF09`, "PROVIDER_UNAVAILABLE");
      }
      if ((res.status === 401 || res.status === 403) && attempt === 0) {
        await res.body?.cancel();
        session = await this.opts.auth.get(true);
        continue;
      }
      if (!res.ok) {
        const detail = (await res.text()).slice(0, 400);
        const code = res.status === 401 || res.status === 403 ? "AUTH" : res.status === 429 ? "RATE_LIMIT" : res.status >= 500 ? "PROVIDER_UNAVAILABLE" : "PROVIDER_HTTP_ERROR";
        throw new LlmError(`Trae llm_raw_chat HTTP ${res.status}${detail ? `\uFF1A${detail}` : ""}`, code, { status: res.status });
      }
      if (!res.body) throw new LlmError("Trae \u8FD4\u56DE\u4E86\u7A7A\u54CD\u5E94\u4F53", "PROVIDER_PROTOCOL_ERROR");
      yield* traeEvents(res.body);
      return;
    }
  }
  async *stream(options) {
    const route = findModel(options.model);
    if (!route) {
      throw new LlmError(`Trae\uFF1A\u672A\u77E5\u6A21\u578B\u300C${options.model}\u300D\u3002\u53EF\u7528\uFF1A${TRAE_ROUTES.map((r) => r.id).join("\u3001")}`, "MODEL_NOT_FOUND");
    }
    const effort = effortFor(route, options.reasoningEffort ? String(options.reasoningEffort) : void 0);
    const session = sessionUuid(options.sessionId ? String(options.sessionId) : void 0);
    const body = {
      config_name: route.configName,
      model_name: route.key,
      user_input: "",
      messages: toTraeMessages(options),
      session_id: session,
      conversation_id: session,
      tools: toTraeTools(options.tools),
      access_type: 4
    };
    if (route.maxMode) {
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
    const payload = JSON.stringify(body);
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
    const sniffer = new TextToolCallSniffer(schemas);
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
          for await (const ev of this.once(payload, controller.signal)) {
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
                const { visible, calls: calls2 } = sniffer.feed(response);
                yield* emitText(visible);
                yield* emitRecovered(calls2);
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
              throw new LlmError(`Trae\uFF1A\u4E0A\u6E38 ${Math.round(this.opts.readTimeoutMs / 1e3)} \u79D2\u6CA1\u6709\u6570\u636E\uFF0C\u5DF2\u653E\u5F03\u672C\u8F6E`, "PROVIDER_TIMEOUT");
            }
            throw err;
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
      const tail = sniffer.flush();
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
    const payload = JSON.parse(Buffer.from(parts2[1], "base64url").toString("utf8"));
    if (typeof payload.data === "string") {
      try {
        payload.data = JSON.parse(payload.data);
      } catch {
      }
    }
    return payload;
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
  return { token, expiresAt, ...typeof data?.email === "string" ? { email: data.email } : {} };
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
  opts;
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
      throw new LlmError2(`Trae\uFF1A\u65E0\u6CD5\u8FDE\u63A5 ${this.opts.host}\uFF08${error instanceof Error ? error.message : String(error)}\uFF09`, "PROVIDER_UNAVAILABLE");
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
        auth ? "AUTH" : "PROVIDER_HTTP_ERROR",
        { status: res.status }
      );
    }
    return sessionFromToken(found.token, found.expiry);
  }
};

// src/index.ts
var name = "dsh-trae2api";
var inject = ["llm"];
var CLIENT_VERSION = "0.206.1-tob";
var Config = Schema.object({
  provider: Schema.string().pattern(/^[a-z0-9][a-z0-9-]*$/).default("trae"),
  displayName: Schema.string().default("Trae"),
  patEnv: Schema.string().role("credential-ref").default("TRAE_PAT").volatile().description("Trae \u4E2A\u4EBA\u8BBF\u95EE\u4EE4\u724C\uFF08PAT\uFF09\u5728\u51ED\u636E\u5E93\u91CC\u7684\u540D\u5B57"),
  host: Schema.string().default(TRAE_HOST),
  clientId: Schema.string().default(CLI_CLIENT_ID),
  appId: Schema.string().default("7b3f9dc2-8a4e-5c6d-2f1b-9e4a3c5b7df0"),
  ideVersionCode: Schema.string().default("20260908"),
  clientVersion: Schema.string().default(CLIENT_VERSION),
  readTimeoutMs: Schema.natural().default(3e5),
  emptyRetries: Schema.natural().default(1),
  loopGuardChars: Schema.natural().default(600)
});
function apply(ctx, config) {
  const logger = ctx.logger;
  const anyCtx = ctx;
  const settingsNs = anyCtx.fiber?.entry?.options?.id ?? "trae2api";
  try {
    anyCtx.inject(["settings"], (child) => {
      child.effect(() => child.settings.configure({ auto: false }, anyCtx.fiber));
    });
  } catch (error) {
    logger.warn("dsh-trae2api: settings integration unavailable", error);
  }
  const host = config.host.replace(/\/+$/, "");
  const userAgent = `codex_exec/${config.clientVersion} (dsh-trae2api) unknown (codex_exec; ${config.clientVersion})`;
  const auth = new TraeAuth({
    host,
    clientId: config.clientId,
    userAgent,
    readSecret: async () => {
      const ref = config.patEnv.get();
      const credentials = anyCtx.get("credentials");
      let value;
      try {
        value = (await credentials?.resolve(ref))?.value;
      } catch {
      }
      return value || process.env[ref] || void 0;
    }
  });
  const adapter = new TraeAdapter({
    displayName: config.displayName,
    host,
    identity: {
      appId: config.appId,
      ideFunction: "chat",
      ideVersion: "99.99.99",
      ideVersionCode: config.ideVersionCode,
      clientVersion: config.clientVersion,
      originator: "codex_exec",
      userAgent
    },
    auth,
    readTimeoutMs: config.readTimeoutMs,
    emptyRetries: config.emptyRetries,
    loopGuardChars: config.loopGuardChars,
    logger
  });
  ctx.on("credentials/reference-updated", ((ref) => {
    if (ref === config.patEnv.get()) auth.reset();
  }));
  ctx.on("loader/volatile-update", (() => {
    auth.reset();
  }));
  ctx.llm.registerAdapter([config.provider], adapter);
  ctx.llm.registerConfigurableProviders([
    { provider: config.provider, displayName: config.displayName, settingsNs, settingsPath: [] }
  ]);
}
export {
  Config,
  apply,
  inject,
  name
};
