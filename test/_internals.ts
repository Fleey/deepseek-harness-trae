// Entry for `npm run build:test`: re-exports the pure internals the unit tests
// in internals.test.mjs exercise, bundled to lib/testing.mjs.
export { TRAE_MODELS, TRAE_ROUTES, findModel, toRoutes } from '../src/trae/catalog.ts'
export {
  parseDetailParams, parseModelsCache, TraeCatalog, CATALOG_PATH, CATALOG_BODY, catalogBody, CHAT_FUNCTION,
  EXTRA_CATALOG_FUNCTIONS, MODELS_CACHE_FILE, BUILTIN_SNAPSHOT,
} from '../src/trae/catalog-source.ts'
export {
  toTraeMessages, repairToolHistory, traeEvents, wireContent, LoopDetector, TextToolCallSniffer, CodeScanner,
  sessionUuid, conversationUuid, classify, httpCode, approxTokens, toTraeTools, normalizeToolSchema, normalizeToolSchemas,
} from '../src/trae/wire.ts'
export { decodeJwt, parseExpiry } from '../src/trae/auth.ts'
export { traeDebugLine, traeDebugTime, traceOf, traeAppName, isCnHost, DEBUG_MISSING, TRAE_APP_VERSION } from '../src/trae/debug.ts'
export { TraeAdapter, effortFor } from '../src/adapter.ts'
export { parseQuota, TraeQuota, QUOTA_PATHS, enterpriseTenant } from '../src/trae/quota.ts'
export { parseTobQuota, TobConsole, TOB_LOGIN_PATH, TOB_QUOTA_PATH, TOB_USAGE_PATH, TOB_SESSION_COOKIE } from '../src/trae/tob.ts'
export { TraeSuggestions, suggestPrompt, parseSuggestions, followsAsk, suggestSystem, SUGGEST_SYSTEM, SUGGEST_SUBAGENT_RULES, SUGGEST_EXAMPLE, MAX_CARDS, MAX_CHOICES } from '../src/trae/suggest.ts'
export { TraeCueReporter, REPORT_PATH } from '../src/trae/cue.ts'
export { parseUserInfo, TraeUserInfo, USER_INFO_PATH } from '../src/trae/user.ts'
export {
  TraeShare, ShareError, parseSession, parseMessages, parseEntries, turnIdsOf,
  shareUrl, artifactUrl, shareOriginFor, latestTurns, SHARE_ORIGIN, SHARE_API_ORIGIN, SHARE_PATH, SESSIONS_PATH, TURN_LIMIT,
  AUDIT_ATTEMPTS, AUDIT_INTERVAL_MS, AUDIT_TIMEOUT_MS, SHARE_CODES,
} from '../src/trae/share.ts'
export { mirrorConversation, mirrorAndShare, textOfContent } from '../src/trae/mirror.ts'
export { transcriptOf, transcriptMessage, userTurns, TranscriptStore } from '../src/trae/transcript.ts'
export { conversationTurns, localShareBody, traeTool, objectId, LOCAL_SHARE_TURNS } from '../src/trae/local-share.ts'
