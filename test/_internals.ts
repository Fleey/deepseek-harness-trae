// Entry for `npm run build:test`: re-exports the pure internals the unit tests
// in internals.test.mjs exercise, bundled to lib/testing.mjs.
export { TRAE_MODELS, TRAE_ROUTES, findModel } from '../src/trae/catalog.ts'
export {
  toTraeMessages, repairToolHistory, traeEvents, wireContent, LoopDetector, TextToolCallSniffer, sessionUuid, classify, approxTokens,
} from '../src/trae/wire.ts'
export { decodeJwt, parseExpiry } from '../src/trae/auth.ts'
export { TraeAdapter } from '../src/adapter.ts'
export { parseQuota, TraeQuota, QUOTA_PATHS, enterpriseTenant } from '../src/trae/quota.ts'
export { parseTobQuota, TobConsole, TOB_LOGIN_PATH, TOB_QUOTA_PATH, TOB_USAGE_PATH, TOB_SESSION_COOKIE } from '../src/trae/tob.ts'
