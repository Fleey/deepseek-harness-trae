// Entry for `npm run build:test`: re-exports the pure internals the unit tests
// in internals.test.mjs exercise, bundled to lib/testing.mjs.
export { TRAE_MODELS, TRAE_ROUTES, findModel, toRoutes } from '../src/trae/catalog.ts'
export {
  parseDetailParams, parseModelsCache, TraeCatalog, CATALOG_PATH, CATALOG_BODY, MODELS_CACHE_FILE, BUILTIN_SNAPSHOT,
} from '../src/trae/catalog-source.ts'
export {
  toTraeMessages, repairToolHistory, traeEvents, wireContent, LoopDetector, TextToolCallSniffer, sessionUuid, classify, approxTokens,
} from '../src/trae/wire.ts'
export { decodeJwt, parseExpiry } from '../src/trae/auth.ts'
export { TraeAdapter } from '../src/adapter.ts'
export { parseQuota, TraeQuota, QUOTA_PATHS, enterpriseTenant } from '../src/trae/quota.ts'
export { parseTobQuota, TobConsole, TOB_LOGIN_PATH, TOB_QUOTA_PATH, TOB_USAGE_PATH, TOB_SESSION_COOKIE } from '../src/trae/tob.ts'
export { TraeSuggestions, suggestPrompt, cleanSuggestion, SUGGEST_SYSTEM } from '../src/trae/suggest.ts'
export { TraeCueReporter, REPORT_PATH } from '../src/trae/cue.ts'
export { parseUserInfo, TraeUserInfo, USER_INFO_PATH } from '../src/trae/user.ts'
