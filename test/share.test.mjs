// Share-link layer: the parsers and the request/审核 flow.
//
// Network is stubbed at `fetch`, so these run offline; the shapes asserted here
// are the ones the live API answered with (captured 2026-11-06).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  TraeShare, ShareError, parseSession, parseMessages, parseEntries, turnIdsOf,
  shareUrl, artifactUrl, shareOriginFor, latestTurns, SHARE_ORIGIN, SHARE_API_ORIGIN, SHARE_PATH, SESSIONS_PATH, TURN_LIMIT,
  AUDIT_ATTEMPTS, SHARE_CODES, parseUserInfo, mirrorConversation,
} from '../lib/testing.mjs'
import { textOfContent } from '../lib/testing.mjs'

// ---------------------------------------------------------------- fixtures

const SESSION_BODY = {
  code: 0,
  message: 'success',
  data: {
    share_session_id: 'H6-Y3XMX7.KEK-',
    title: '验证ClassIsland天气组件气温丢失问题',
    mode: 'work',
    created_at: '2026-10-09T16:16:34+08:00',
    creator_name: '用户3572483714',
    anonymous: false,
    status: 'active',
    share_type: 'all',
    artifact_entries: JSON.stringify({
      'attachments/6ac8713ed5fc68daf6ea883d/Let me ver....txt': {
        download_url: 'https://share-cdn.traecontent.cn/shared-conversation/user:1/l_abc/def/Let%20me%20ver....txt?X-Tos-Signature=s',
      },
    }),
  },
}

const ARTIFACT_BODY = {
  code: 0,
  message: 'success',
  data: {
    share_session_id: 'HDND6Z4UW-8CFO',
    title: 'Shared artifact',
    anonymous: false,
    status: 'active',
    share_type: 'artifact',
    artifact_path: 'hires-cdn-stall-fix/hires-cdn-stall-fix.html',
    artifact_entries: JSON.stringify({
      'hires-cdn-stall-fix/hires-cdn-stall-fix.html': {
        download_url: 'https://share-cdn.traecontent.cn/shared-artifact/w_x/l_y/h/package.zip?sig',
        entry_url: 'https://share-cdn.traecontent.cn/shared-artifact/w_x/l_y/h/entry.html?sig',
      },
    }),
  },
}

const MESSAGES_BODY = {
  code: 0,
  message: 'success',
  data: {
    items: [
      { share_session_id: 'H6-Y3XMX7.KEK-', message_id: 'm1', role: 'user', message_type: 'general', message_index: 1, status: 'completed', content: '[{"text_content":"q","type":"text"}]' },
      { share_session_id: 'H6-Y3XMX7.KEK-', message_id: 'm2', role: 'assistant', message_type: 'task', message_index: 2, status: 'completed', turn_id: 't-1', content: '{"messages":[],"task_id":"x"}' },
      { share_session_id: 'H6-Y3XMX7.KEK-', message_id: 'm3', role: 'user', message_type: 'general', message_index: 3, status: 'completed', content: '[{"text_content":"q2","type":"text"}]' },
      { share_session_id: 'H6-Y3XMX7.KEK-', message_id: 'm4', role: 'assistant', message_type: 'task', message_index: 4, status: 'completed', turn_id: 't-2', content: '{"messages":[],"task_id":"y"}' },
    ],
    has_more: false,
  },
}

/** Install a fetch stub; returns the recorded calls. */
function stubFetch(handler) {
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init = {}) => {
    const call = { url: String(url), method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body }
    calls.push(call)
    const answer = handler(call)
    const status = answer.status ?? 200
    const text = answer.text ?? JSON.stringify(answer.body ?? {})
    return new Response(text, { status, headers: { 'content-type': 'application/json' } })
  }
  return { calls, restore: () => { globalThis.fetch = original } }
}

const makeShare = (auth) => new TraeShare({
  host: 'https://share.invalid', userAgent: 'test/1.0',
  ...auth ? { auth } : {},
  ttlMs: 0,
})

// ---------------------------------------------------------------- parsers

test('share: a session body becomes the fields the card shows', () => {
  const s = parseSession(SESSION_BODY)
  assert.equal(s.shareSessionId, 'H6-Y3XMX7.KEK-')
  assert.equal(s.title, '验证ClassIsland天气组件气温丢失问题')
  assert.equal(s.mode, 'work')
  assert.equal(s.creatorName, '用户3572483714')
  assert.equal(s.anonymous, false)
  assert.equal(s.status, 'active')
  assert.equal(s.shareType, 'all')
  assert.equal(s.createdAt, '2026-10-09T16:16:34+08:00')
  assert.deepEqual(Object.keys(s.entries), ['attachments/6ac8713ed5fc68daf6ea883d/Let me ver....txt'])
})

test('share: artifact_entries is a JSON string and gets unwrapped once', () => {
  const entries = parseEntries(SESSION_BODY.data.artifact_entries)
  assert.equal(
    entries['attachments/6ac8713ed5fc68daf6ea883d/Let me ver....txt'].downloadUrl.startsWith('https://share-cdn.traecontent.cn/'),
    true,
  )
  // Already an object: same answer. Garbage: empty, never a throw.
  assert.deepEqual(parseEntries({ a: { download_url: 'u' } }), { a: { downloadUrl: 'u' } })
  assert.deepEqual(parseEntries('not json'), {})
  assert.deepEqual(parseEntries(undefined), {})
  // The artifact variant carries both links.
  const art = parseEntries(ARTIFACT_BODY.data.artifact_entries)
  const only = art['hires-cdn-stall-fix/hires-cdn-stall-fix.html']
  assert.ok(only.downloadUrl.endsWith('package.zip?sig'))
  assert.ok(only.entryUrl.endsWith('entry.html?sig'))
})

test('share: a business code raises with its own code, not a bare message', () => {
  assert.throws(
    () => parseSession({ code: 992700, message: 'share session not found' }),
    (error) => {
      assert.ok(error instanceof ShareError)
      assert.equal(error.code, 992700)
      // The translated reason wins, the server's own word follows.
      assert.match(error.message, /分享不存在/)
      assert.match(error.message, /share session not found/)
      return true
    },
  )
  assert.equal(SHARE_CODES[992706], '分享已过期')
})

test('share: messages keep their turn_id, which is what createShare takes', () => {
  const parsed = parseMessages(MESSAGES_BODY)
  assert.equal(parsed.items.length, 4)
  assert.equal(parsed.hasMore, false)
  assert.equal(parsed.items[1].turnId, 't-1')
  assert.equal(parsed.items[1].messageType, 'task')
  // content is left as the JSON string the server sent, not re-parsed.
  assert.equal(parsed.items[0].content, '[{"text_content":"q","type":"text"}]')
  // The name lies: `turn_ids` wants the USER message id of each pair, not the
  // `turn_id` field. Measured on the enterprise API (2026-11-06): passing the
  // assistant's turn_id, or its message_id, is 400 991102 "no messages match";
  // passing the user's message_id mints. So only user rows are collected —
  // one id per user/assistant pair — and a mixed list would be refused whole.
  assert.deepEqual(turnIdsOf(parsed.items), ['m1', 'm3'])
  assert.deepEqual(turnIdsOf([]), [])
  assert.deepEqual(turnIdsOf(parsed.items.filter(m => m.role === 'assistant')), [])
})

test('share: a link is minted on the front end that serves its own namespace', () => {
  // An id lives in exactly one namespace, and the two front ends do not read
  // each other's: an enterprise id opens on the console site, a consumer one on
  // share.traecontent.cn. Picking the wrong origin is the "此链接已失效" page.
  assert.equal(shareOriginFor('https://share.traecontent.cn'), 'https://share.traecontent.cn')
  assert.equal(shareOriginFor('https://work.trae.cn'), 'https://share.traecontent.cn')
  assert.equal(shareOriginFor('https://api.enterprise.trae.cn'), 'https://console.enterprise.trae.cn')
  assert.equal(shareOriginFor('https://console.enterprise.trae.cn'), 'https://console.enterprise.trae.cn')
  // Trailing slash and unknown hosts: normalised, then the consumer default.
  assert.equal(shareOriginFor('https://api.enterprise.trae.cn/'), 'https://console.enterprise.trae.cn')
  assert.equal(shareOriginFor('https://example.invalid'), SHARE_ORIGIN)
})

test('share: get() reports which host answered, so the caller can pick the origin', async () => {
  const stub = stubFetch(() => ({ body: SESSION_BODY }))
  try {
    const session = await makeShare(undefined).get('H6-Y3XMX7.KEK-')
    assert.equal(session.host, 'https://share.invalid')
    assert.equal(shareOriginFor(session.host), SHARE_ORIGIN)
  } finally { stub.restore() }
})

test('share: the page URL follows the front end’s two spellings', () => {
  assert.equal(shareUrl('H6-Y3XMX7.KEK-'), 'https://share.traecontent.cn/share/H6-Y3XMX7.KEK-?enter_from=pc')
  assert.equal(artifactUrl('HDND6Z4UW-8CFO'), 'https://share.traecontent.cn/artifact/HDND6Z4UW-8CFO')
})

// ---------------------------------------------------------------- requests

test('share: reading needs no Authorization header at all', async () => {
  const stub = stubFetch((call) => {
    if (call.url.endsWith('/messages?page_size=100')) return { body: MESSAGES_BODY }
    return { body: SESSION_BODY }
  })
  try {
    const share = makeShare(undefined)
    const session = await share.get('H6-Y3XMX7.KEK-')
    const messages = await share.messages('H6-Y3XMX7.KEK-')
    assert.equal(session.title, '验证ClassIsland天气组件气温丢失问题')
    assert.equal(messages.length, 4)
    for (const call of stub.calls) {
      assert.equal(call.headers.authorization, undefined, `${call.url} must not carry a JWT`)
      assert.equal(call.url.startsWith('https://share.invalid/api/remote/v1/share/'), true)
    }
  } finally { stub.restore() }
})

test('share: minting sends the front end’s exact body and returns the URL', async () => {
  const stub = stubFetch((call) => {
    if (call.method === 'POST') {
      return { body: { code: 0, data: { share_session_id: 'NEW00000000001', status: 'passed', expires_at: null } } }
    }
    return { body: SESSION_BODY }
  })
  try {
    const auth = { get: async () => ({ token: 'JWT', expiresAt: Date.now() + 3_600_000 }) }
    const share = makeShare(auth)
    const link = await share.create({
      chatSessionId: 'cs-1', turnIds: ['t-1', 't-2'], anonymous: false, creatorName: 'user',
    })
    const post = stub.calls.find(c => c.method === 'POST')
    assert.equal(post.url, `https://share.invalid${SHARE_PATH}`)
    assert.equal(post.headers.authorization, 'Cloud-IDE-JWT JWT')
    assert.deepEqual(JSON.parse(post.body), {
      chat_session_id: 'cs-1', turn_ids: ['t-1', 't-2'], anonymous: false, creator_name: 'user',
    })
    assert.equal(link.shareSessionId, 'NEW00000000001')
    assert.equal(link.url, 'https://share.traecontent.cn/share/NEW00000000001?enter_from=pc')
    // Server said `passed`, so no audit poll was made.
    assert.equal(stub.calls.filter(c => c.url.includes('/audit_status')).length, 0)
    assert.equal(link.auditPolls, 0)
  } finally { stub.restore() }
})

test('share: an auditing share is polled until passed', async () => {
  let polls = 0
  const stub = stubFetch((call) => {
    if (call.method === 'POST') {
      return { body: { code: 0, data: { share_session_id: 'PENDING0000001', status: 'auditing' } } }
    }
    if (call.url.includes('/audit_status')) {
      polls++
      return { body: { code: 0, data: { status: polls < 3 ? 'auditing' : 'passed' } } }
    }
    return { body: SESSION_BODY }
  })
  try {
    const auth = { get: async () => ({ token: 'JWT', expiresAt: Date.now() + 3_600_000 }) }
    const link = await makeShare(auth).create({ chatSessionId: 'cs-1', turnIds: ['t-1'] })
    assert.equal(link.auditPolls, 3)
    assert.equal(polls, 3)
    // What comes back is the outcome, not the `auditing` the POST answered.
    assert.equal(link.status, 'passed')
  } finally { stub.restore() }
})

test('share: a failed audit stops at once, a stuck one gives up after 15', async () => {
  let failed = stubFetch((call) => {
    if (call.method === 'POST') return { body: { code: 0, data: { share_session_id: 'X00000000000001', status: 'auditing' } } }
    return { body: { code: 0, data: { status: 'failed' } } }
  })
  const auth = { get: async () => ({ token: 'JWT', expiresAt: Date.now() + 3_600_000 }) }
  try {
    await assert.rejects(
      () => makeShare(auth).create({ chatSessionId: 'cs-1', turnIds: ['t-1'] }),
      (error) => {
        assert.ok(error instanceof ShareError)
        assert.equal(error.code, 993401)
        return true
      },
    )
    // Exactly one poll: `failed` is terminal.
    assert.equal(failed.calls.filter(c => c.url.includes('/audit_status')).length, 1)
  } finally { failed.restore() }

  const stuck = stubFetch((call) => {
    if (call.method === 'POST') return { body: { code: 0, data: { share_session_id: 'Y00000000000001', status: 'auditing' } } }
    return { body: { code: 0, data: { status: 'auditing' } } }
  })
  try {
    await assert.rejects(
      () => makeShare(auth).create({ chatSessionId: 'cs-1', turnIds: ['t-1'] }),
      (error) => {
        assert.ok(error instanceof ShareError)
        assert.equal(error.code, 992707)
        return true
      },
    )
    assert.equal(stuck.calls.filter(c => c.url.includes('/audit_status')).length, AUDIT_ATTEMPTS)
  } finally { stuck.restore() }
})

test('share: the front end’s own limits are enforced before a request goes out', async () => {
  const stub = stubFetch(() => ({ body: { code: 0, data: {} } }))
  const auth = { get: async () => ({ token: 'JWT', expiresAt: Date.now() + 3_600_000 }) }
  try {
    const share = makeShare(auth)
    await assert.rejects(() => share.create({ chatSessionId: 'cs-1', turnIds: [] }), /turn_ids 不能为空/)
    await assert.rejects(
      () => share.create({ chatSessionId: 'cs-1', turnIds: Array.from({ length: TURN_LIMIT + 1 }, (_, i) => `t-${i}`) }),
      /超过上限 50/,
    )
    // Neither reached the wire.
    assert.equal(stub.calls.length, 0)
  } finally { stub.restore() }
})

test('share: a 401 becomes the PAT message rather than a raw status', async () => {
  const stub = stubFetch((call) => {
    if (call.method === 'POST') return { status: 401, body: { code: 1001, message: 'not authenticated' } }
    return { status: 404, body: { code: 992700, message: 'share session not found' } }
  })
  try {
    const auth = { get: async () => ({ token: 'JWT', expiresAt: Date.now() + 3_600_000 }) }
    await assert.rejects(
      () => makeShare(auth).create({ chatSessionId: 'cs-1', turnIds: ['t-1'] }),
      (error) => {
        assert.equal(error.code, 1001)
        assert.match(error.message, /PAT/)
        return true
      },
    )
    await assert.rejects(
      () => makeShare(undefined).get('nope'),
      (error) => {
        assert.equal(error.code, 992700)
        assert.equal(error.status, 404)
        return true
      },
    )
  } finally { stub.restore() }
})

test('share: turn ids come from the real session’s own messages', async () => {
  const stub = stubFetch((call) => {
    assert.equal(call.url.startsWith(`https://share.invalid${SESSIONS_PATH}/cs-1/messages`), true)
    assert.equal(call.headers.authorization, 'Cloud-IDE-JWT JWT')
    return { body: MESSAGES_BODY }
  })
  try {
    const auth = { get: async () => ({ token: 'JWT', expiresAt: Date.now() + 3_600_000 }) }
    // User rows are the ones `turn_ids` wants (see turnIdsOf); the assistant
    // rows in this fixture contribute nothing.
    assert.deepEqual(await makeShare(auth).turnsOf('cs-1'), ['m1', 'm3'])
  } finally { stub.restore() }
})

test('share: listing sessions is the only source of a chat_session_id', async () => {
  const stub = stubFetch(() => ({
    body: { code: 0, data: { items: [{ chat_session_id: 'cs-1', name: 'a' }, { chat_session_id: 'cs-2' }] } },
  }))
  try {
    const auth = { get: async () => ({ token: 'JWT', expiresAt: Date.now() + 3_600_000 }) }
    const { items } = await makeShare(auth).sessions()
    assert.deepEqual(items.map(i => i.chat_session_id), ['cs-1', 'cs-2'])
  } finally { stub.restore() }
})

test('share: closing and reopening are a PATCH on the status sub-resource, deleting is a DELETE', async () => {
  const stub = stubFetch((call) => ({ body: { code: 0, data: call.method === 'PATCH' ? { status: JSON.parse(call.body).status } : {} } }))
  try {
    const auth = { get: async () => ({ token: 'JWT', expiresAt: Date.now() + 3_600_000 }) }
    const share = makeShare(auth)
    assert.equal((await share.setStatus('H6-Y3XMX7.KEK-', 'disabled')).status, 'disabled')
    assert.equal((await share.setStatus('H6-Y3XMX7.KEK-', 'active')).status, 'active')
    await share.remove('H6-Y3XMX7.KEK-')
    const [close, reopen, remove] = stub.calls
    assert.equal(close.method, 'PATCH')
    assert.equal(close.url, `https://share.invalid${SHARE_PATH}/H6-Y3XMX7.KEK-/status`)
    // Report v2: the body is the status alone.
    assert.deepEqual(JSON.parse(close.body), { status: 'disabled' })
    assert.deepEqual(JSON.parse(reopen.body), { status: 'active' })
    assert.equal(remove.method, 'DELETE')
    assert.equal(remove.url, `https://share.invalid${SHARE_PATH}/H6-Y3XMX7.KEK-`)
    for (const call of stub.calls) assert.equal(call.headers.authorization, 'Cloud-IDE-JWT JWT')
  } finally { stub.restore() }
  // Someone else's share: 403 992701, in words.
  const foreign = stubFetch(() => ({ status: 403, body: { code: 992701, message: 'forbidden' } }))
  try {
    const auth = { get: async () => ({ token: 'JWT', expiresAt: Date.now() + 3_600_000 }) }
    await assert.rejects(() => makeShare(auth).setStatus('4ISXZO1VALO9_Q', 'disabled'), (error) => {
      assert.equal(error.code, 992701)
      assert.match(error.message, /已关闭，或无权操作/)
      return true
    })
  } finally { foreign.restore() }
})

test('share: the account’s own shares are listed with their lifetimes', async () => {
  const stub = stubFetch(() => ({ body: { code: 0, data: { items: [
    { share_session_id: '5J6XE.KMG5R8.S', title: 't', status: 'active', created_at: '2026-11-06T14:00:15+08:00', expires_at: '2027-11-06T14:00:15+08:00' },
  ], total: 1 } } }))
  try {
    const auth = { get: async () => ({ token: 'JWT', expiresAt: Date.now() + 3_600_000 }) }
    const { items, keys } = await makeShare(auth).list()
    assert.equal(stub.calls[0].url, `https://share.invalid${SHARE_PATH}?page_size=50`)
    assert.deepEqual(items.map(i => [i.shareSessionId, i.status, i.expiresAt]), [['5J6XE.KMG5R8.S', 'active', '2027-11-06T14:00:15+08:00']])
    assert.deepEqual(keys, ['items', 'total'])
  } finally { stub.restore() }
})

test('share: the audit poll tolerates 992700 while the share settles, and stops on any other code', async () => {
  const auth = { get: async () => ({ token: 'JWT', expiresAt: Date.now() + 3_600_000 }) }
  let polls = 0
  const settling = stubFetch((call) => {
    if (call.method === 'POST') return { body: { code: 0, data: { share_session_id: 'S00000000000001', status: 'auditing' } } }
    polls++
    return polls < 3 ? { status: 404, body: { code: 992700, message: 'share session not found' } } : { body: { code: 0, data: { status: 'passed' } } }
  })
  try {
    const link = await makeShare(auth).create({ chatSessionId: 'cs-1', turnIds: ['u-1'] })
    assert.equal(link.status, 'passed')
    assert.equal(link.auditPolls, 3)
  } finally { settling.restore() }
  const broken = stubFetch((call) => {
    if (call.method === 'POST') return { body: { code: 0, data: { share_session_id: 'B00000000000001', status: 'auditing' } } }
    return { status: 500, body: { code: 500001, message: 'internal error' } }
  })
  try {
    await assert.rejects(() => makeShare(auth).create({ chatSessionId: 'cs-1', turnIds: ['u-1'] }), /internal error/)
    assert.equal(broken.calls.filter(c => c.url.includes('/audit_status')).length, 1)
  } finally { broken.restore() }
  // `audit_failed` straight from the POST is a refusal, not a link.
  const refused = stubFetch(() => ({ body: { code: 0, data: { share_session_id: 'F00000000000002', status: 'audit_failed' } } }))
  try {
    await assert.rejects(() => makeShare(auth).create({ chatSessionId: 'cs-1', turnIds: ['u-1'] }), (error) => error.code === 993401)
  } finally { refused.restore() }
})

test('share: messages page through page_token until has_more stops', async () => {
  const pages = [
    { code: 0, data: { items: [{ message_id: 'm1', role: 'user', turn_id: 't-1' }], has_more: true, next_page_token: '2' } },
    { code: 0, data: { items: [{ message_id: 'm2', role: 'assistant', turn_id: 't-2' }], has_more: false } },
  ]
  let served = 0
  const stub = stubFetch(() => ({ body: pages[served++] }))
  try {
    const messages = await makeShare(undefined).messages('S1', { pageSize: 1 })
    assert.deepEqual(messages.map(m => m.messageId), ['m1', 'm2'])
    assert.equal(stub.calls.length, 2)
    assert.match(stub.calls[1].url, /page_token=2/)
  } finally { stub.restore() }
})

// ------------------------------------------------------- fixes against the report

test('share: the API origin is the client’s own write host, the link stays on share.traecontent.cn', async () => {
  // Report v2: TRAE SOLO CN bootConfig `remote.trae.normal`.
  assert.equal(SHARE_API_ORIGIN, 'https://trae-api-cn.mchost.guru')
  assert.equal(shareUrl('X'), 'https://share.traecontent.cn/share/X?enter_from=pc')
  const { shareOriginFor } = await import('../lib/testing.mjs')
  assert.equal(shareOriginFor('https://trae-api-cn.mchost.guru'), 'https://share.traecontent.cn')
  assert.equal(shareOriginFor('https://trae-api-cn.mchost.guru/'), 'https://share.traecontent.cn')
})

test('share: a share the server fails on the spot is an error, not a link', async () => {
  const stub = stubFetch(() => ({ body: { code: 0, data: { share_session_id: 'F00000000000001', status: 'failed' } } }))
  try {
    const auth = { get: async () => ({ token: 'JWT', expiresAt: Date.now() + 3_600_000 }) }
    await assert.rejects(
      () => makeShare(auth).create({ chatSessionId: 'cs-1', turnIds: ['t-1'] }),
      (error) => { assert.equal(error.code, 993401); return true },
    )
    // No poll for a verdict already given.
    assert.equal(stub.calls.filter(c => c.url.includes('/audit_status')).length, 0)
  } finally { stub.restore() }
})

test('share: one audit poll that cannot connect is retried, not fatal', async () => {
  let polls = 0
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url, init = {}) => {
    if ((init.method ?? 'GET') === 'POST') {
      return Response.json({ code: 0, data: { share_session_id: 'R00000000000001', status: 'auditing' } })
    }
    polls++
    if (polls === 1) throw new TypeError('fetch failed')
    return Response.json({ code: 0, data: { status: 'passed' } })
  }
  try {
    const auth = { get: async () => ({ token: 'JWT', expiresAt: Date.now() + 3_600_000 }) }
    const link = await makeShare(auth).create({ chatSessionId: 'cs-1', turnIds: ['t-1'] })
    assert.equal(link.status, 'passed')
    assert.equal(link.auditPolls, 2)
  } finally { globalThis.fetch = realFetch }
})

test('share: creator_name is trimmed like the front end’s username.trim()', async () => {
  const stub = stubFetch(() => ({ body: { code: 0, data: { share_session_id: 'N00000000000001', status: 'passed' } } }))
  try {
    const auth = { get: async () => ({ token: 'JWT', expiresAt: Date.now() + 3_600_000 }) }
    await makeShare(auth).create({ chatSessionId: 'cs-1', turnIds: ['t-1'], creatorName: '  someone \n' })
    assert.equal(JSON.parse(stub.calls[0].body).creator_name, 'someone')
  } finally { stub.restore() }
})

test('share: a long session’s turn ids are read across pages, and "select all" keeps the latest 50', async () => {
  const pages = [
    { code: 0, data: { items: [{ message_id: 'm1', role: 'user', turn_id: 't-1' }], has_more: true, next_page_token: '100' } },
    { code: 0, data: { items: [{ message_id: 'm2', role: 'user', turn_id: 't-2' }], has_more: false } },
  ]
  let served = 0
  const stub = stubFetch(() => ({ body: pages[served++] }))
  try {
    const auth = { get: async () => ({ token: 'JWT', expiresAt: Date.now() + 3_600_000 }) }
    // User rows are the ones `turn_ids` wants (see turnIdsOf); the assistant
    // rows in this fixture contribute nothing.
    assert.deepEqual(await makeShare(auth).turnsOf('cs-1'), ['m1', 'm2'])
    assert.equal(stub.calls.length, 2)
    assert.match(stub.calls[1].url, /page_token=100/)
  } finally { stub.restore() }
  const many = Array.from({ length: TURN_LIMIT + 7 }, (_, i) => `t-${i}`)
  const kept = latestTurns(many)
  assert.equal(kept.length, TURN_LIMIT)
  assert.equal(kept[0], 't-7')
  assert.equal(kept.at(-1), `t-${TURN_LIMIT + 6}`)
  assert.deepEqual(latestTurns(['a', 'b']), ['a', 'b'])
})

test('user info: a display name, when GetUserInfo carries one, becomes the share byline', () => {
  assert.equal(parseUserInfo({ code: 0, Data: { UserInfo: { UserID: '1', ScreenName: ' 用户3572483714 ' } } }).username, '用户3572483714')
  assert.equal(parseUserInfo({ code: 0, Data: { UserInfo: { UserID: '1' } } }).username, undefined)
})

test('share: the session list is found under other keys too, and says what keys it saw', async () => {
  const auth = { get: async () => ({ token: 'JWT', expiresAt: Date.now() + 3_600_000 }) }
  for (const data of [
    { sessions: [{ session_id: 's-1' }], total: 1 },
    { list: [{ id: 's-1' }] },
    [{ chat_session_id: 's-1' }],
  ]) {
    const stub = stubFetch(() => ({ body: { code: 0, data } }))
    try {
      const answer = await makeShare(auth).sessions()
      assert.equal(answer.items.length, 1)
      assert.equal(answer.host, 'https://share.invalid')
    } finally { stub.restore() }
  }
  const empty = stubFetch(() => ({ body: { code: 0, data: { total: 0, has_more: false } } }))
  try {
    const answer = await makeShare(auth).sessions()
    assert.deepEqual(answer.items, [])
    assert.deepEqual(answer.keys, ['total', 'has_more'])
  } finally { empty.restore() }
})

// ------------------------------------------------------------ mirror writes

const USER_MSG = { share_session_id: 'S1', message_id: 'u1', role: 'user', status: 'completed', turn_id: 't1', content: '[{"type":"text","text_content":"3+3?"}]' }
// An assistant row as the chat service really sends it: the answer is the
// `finish` tool call's summary, not a top-level text field.
const ASSISTANT_MSG = {
  share_session_id: 'S1', message_id: 'a1', role: 'assistant', status: 'completed', turn_id: 't1', reply_to_message_id: 'u1',
  content: JSON.stringify({ task_id: 'task1', messages: [{ type: 'plan_item', plan_item: {
    id: 'pi1', thought: '', reasoning_content: 'The user wants a number.',
    tool_call_info: { id: 'pi1', name: 'finish', params: { summary: '6' } },
  } }] }),
}

test('mirror: an answer is the finish tool call’s summary, not a text field', () => {
  assert.equal(textOfContent(ASSISTANT_MSG.content), '6')
  // A user row is the plain text_content array.
  assert.equal(textOfContent(USER_MSG.content), '3+3?')
  // Thinking is the fallback when a turn has no summary (interrupted).
  const interrupted = JSON.stringify({ messages: [{ plan_item: { thought: 'thinking…', tool_call_info: {} } }] })
  assert.equal(textOfContent(interrupted), 'thinking…')
  // Degenerate input never throws.
  assert.equal(textOfContent(undefined), '')
  assert.equal(textOfContent('not json'), 'not json')
  assert.equal(textOfContent('{}'), '')
})

test('mirror: the send body carries the text in query and leaves content empty', async () => {
  const stub = stubFetch((call) => {
    if (call.url.endsWith('/chat_sessions')) return { body: { code: 0, data: { chat_session_id: 'cs-new' } } }
    return { body: { code: 0, data: { message_id: 'u-new' } } }
  })
  try {
    const auth = { get: async () => ({ token: 'JWT', expiresAt: Date.now() + 3_600_000 }) }
    const share = makeShare(auth)
    assert.equal(await share.createSession(), 'cs-new')
    assert.equal(await share.sendMessage('cs-new', '你好'), 'u-new')

    const post = stub.calls.filter(c => c.method === 'POST').at(-1)
    const body = JSON.parse(post.body)
    // Measured: the front end sends an empty content array; the server derives
    // content from query. Sending the text in content and nothing in query
    // leaves the turn with nothing to answer.
    assert.deepEqual(body.content, [])
    assert.deepEqual(JSON.parse(body.query), [{ type: 'text', data: { content: '你好' } }])
    // An empty model name with `auto` lets upstream pick, so no catalog mapping
    // has to be kept in step by hand here.
    assert.equal(body.model_name, '')
    assert.equal(body.model_selection_strategy, 'auto')
    assert.deepEqual(JSON.parse(body.common_params), { solo_chat_mode: 'work' })
  } finally { stub.restore() }
})

test('mirror: a turn is only settled once both sides are completed', async () => {
  let reads = 0
  const stub = stubFetch((call) => {
    if (call.url.startsWith(`https://share.invalid${SESSIONS_PATH}`) && call.url.includes('/cs-1/messages')) {
      reads++
      // First poll: only the user row. Second: the pair, both completed.
      if (reads === 1) return { body: { code: 0, data: { items: [{ ...USER_MSG, status: 'in_progress' }] } } }
      return { body: { code: 0, data: { items: [USER_MSG, ASSISTANT_MSG] } } }
    }
    return { body: { code: 0, data: {} } }
  })
  try {
    const auth = { get: async () => ({ token: 'JWT', expiresAt: Date.now() + 3_600_000 }) }
    const settled = await makeShare(auth).waitForTurn('cs-1', 'u1', { intervalMs: 1, timeoutMs: 5_000 })
    assert.equal(settled.userMessageId, 'u1')
    assert.equal(settled.turnId, 't1')
    assert.equal(textOfContent(settled.answer), '6')
    assert.equal(reads, 2)
  } finally { stub.restore() }
})

test('mirror: waiting gives up rather than hanging on a turn that never lands', async () => {
  const stub = stubFetch(() => ({ body: { code: 0, data: { items: [{ ...USER_MSG, status: 'in_progress' }] } } }))
  try {
    const auth = { get: async () => ({ token: 'JWT', expiresAt: Date.now() + 3_600_000 }) }
    await assert.rejects(
      () => makeShare(auth).waitForTurn('cs-1', 'u1', { intervalMs: 1, timeoutMs: 30 }),
      /等待回合超时/,
    )
  } finally { stub.restore() }
})

test('mirror: only the latest maxTurns user turns are replayed, and each costs a model call', async () => {
  const sent = []
  const stub = stubFetch((call) => {
    if (call.url.endsWith('/chat_sessions')) return { body: { code: 0, data: { chat_session_id: 'cs-m' } } }
    if (call.url.endsWith('/messages') && call.method === 'POST') {
      const body = JSON.parse(call.body)
      sent.push(JSON.parse(body.query)[0].data.content)
      return { body: { code: 0, data: { message_id: `u-${sent.length}` } } }
    }
    // Every turn settles immediately.
    const id = `u-${sent.length}`
    return { body: { code: 0, data: { items: [
      { ...USER_MSG, message_id: id, turn_id: `t-${sent.length}` },
      { ...ASSISTANT_MSG, message_id: `a-${sent.length}`, turn_id: `t-${sent.length}`, reply_to_message_id: id },
    ] } } }
  })
  try {
    const auth = { get: async () => ({ token: 'JWT', expiresAt: Date.now() + 3_600_000 }) }
    const result = await mirrorConversation(
      [
        { role: 'user', text: 'q1' }, { role: 'assistant', text: 'a1' },
        { role: 'user', text: 'q2' }, { role: 'assistant', text: 'a2' },
        { role: 'user', text: 'q3' }, { role: 'assistant', text: 'a3' },
      ],
      { auth, userAgent: 'test', maxTurns: 2 },
    )
    // Assistant turns are never posted: the chat service makes those itself.
    assert.deepEqual(sent, ['q2', 'q3'])
    assert.equal(result.modelCalls, 2)
    assert.equal(result.partial, false)
    assert.deepEqual(result.answers, ['6', '6'])
  } finally { stub.restore() }
})

test('transcript: text only, one row per side of a turn, the final answer last', async () => {
  const { transcriptOf, transcriptMessage, userTurns, TranscriptStore } = await import('../lib/testing.mjs')
  const rows = transcriptOf([
    { role: 'system', content: [{ type: 'text', text: 'sys' }] },
    { role: 'user', content: [{ type: 'text', text: 'fix the bug' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'Looking.' }, { type: 'tool-call', id: 'c1', name: 'bash', arguments: '{}' }] },
    { role: 'tool', content: [{ type: 'tool-result', id: 'c1', output: 'ok' }] },
    { role: 'assistant', content: [{ type: 'tool-call', id: 'c2', name: 'bash', arguments: '{}' }] },
  ], 'Fixed it.')
  assert.deepEqual(rows, [
    { role: 'user', text: 'fix the bug' },
    { role: 'assistant', text: 'Looking.\n\nFixed it.' },
  ])
  assert.equal(userTurns(rows), 1)

  const message = transcriptMessage(rows)
  assert.equal(message.truncated, false)
  assert.match(message.text, /【用户】\nfix the bug/)
  assert.match(message.text, /【助手】\nLooking\.\n\nFixed it\./)
  // Too long: the oldest rows go, and the message says so.
  const long = Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: `${i}`.repeat(100) }))
  const cut = transcriptMessage(long, 450)
  assert.equal(cut.truncated, true)
  assert.ok(cut.rows < 10)
  assert.match(cut.text, /只保留了最近的/)
  assert.match(cut.text, /9{100}/)

  const store = new TranscriptStore(2)
  store.set('a', rows); store.set('b', rows); store.set('c', rows)
  assert.equal(store.get('a'), undefined)
  assert.ok(store.get('c'))
})

test('local share: turns open at each question, steps carry their call and result, the greeting is dropped', async () => {
  const { conversationTurns } = await import('../lib/testing.mjs')
  const model = { kind: 'model', provider: 'trae', model: 'GLM-5.3' }
  const turns = conversationTurns([
    { role: 'system', content: [{ type: 'text', text: 'sys' }] },
    { role: 'assistant', source: model, content: [{ type: 'text', text: 'Hello, ready.' }] },
    { role: 'user', content: [{ type: 'text', text: 'list files\n[model changed: assistant turns above this point were generated by A; the session continues with B]' }] },
    { role: 'assistant', source: model, content: [
      { type: 'tool-call', id: 'a', name: 'ls', arguments: '{"path":"."}' },
      { type: 'tool-call', id: 'b', name: 'read', arguments: '{"path":"README.md"}' },
    ] },
    { role: 'tool', toolCallId: 'a', content: [{ type: 'text', text: 'README.md' }] },
    { role: 'tool', toolCallId: 'b', content: [{ type: 'text', text: '# Title' }] },
    { role: 'assistant', source: model, content: [{ type: 'text', text: 'One file.' }] },
    { role: 'user', content: [{ type: 'text', text: 'thanks' }] },
  ], 'You are welcome.', { reasoning: 'polite', model: 'Kimi-K3' })
  assert.equal(turns.length, 2)
  assert.equal(turns[0].user, 'list files')
  assert.deepEqual(turns[0].steps.map(s => [s.tool.name, s.tool.output]), [['ls', 'README.md'], ['read', '# Title']])
  assert.equal(turns[0].answer, 'One file.')
  assert.equal(turns[0].model, 'GLM-5.3')
  assert.deepEqual([turns[1].answer, turns[1].answerReasoning, turns[1].model], ['You are welcome.', 'polite', 'Kimi-K3'])
})

test('local share: dsh tools land on the families the share page renders', async () => {
  const { traeTool } = await import('../lib/testing.mjs')
  assert.deepEqual(traeTool('bash', { command: 'ls' }).name, 'Shell')
  assert.equal(traeTool('bash', { command: 'ls' }).params.command, 'ls')
  assert.deepEqual(traeTool('read', { path: 'a.ts' }).params.file_path, 'a.ts')
  assert.equal(traeTool('write', { path: 'a.ts', content: 'x' }).name, 'Write')
  assert.equal(traeTool('edit', { path: 'a.ts' }).name, 'Edit')
  assert.equal(traeTool('grep', { pattern: 'x' }).name, 'Grep')
  assert.equal(traeTool('glob', { pattern: '*.ts' }).name, 'Glob')
  assert.equal(traeTool('web_search', { query: 'q' }).params.query, 'q')
  assert.equal(traeTool('web_fetch', { url: 'https://x' }).name, 'WebFetch')
  assert.equal(traeTool('todo_write', {}).name, 'TodoWrite')
  assert.equal(traeTool('mcp__thing', { a: 1 }).name, 'mcp__thing')
})

test('local share: at most 50 turns go out, the latest ones, with stable ids', async () => {
  const { localShareBody, LOCAL_SHARE_TURNS, objectId } = await import('../lib/testing.mjs')
  const turns = Array.from({ length: LOCAL_SHARE_TURNS + 3 }, (_, i) => ({ user: `q${i}`, steps: [], answer: `a${i}` }))
  const once = localShareBody(turns, { sessionId: 's', updatedAt: 1_700_000_000_000 })
  assert.equal(once.turns, LOCAL_SHARE_TURNS)
  assert.equal(once.dropped, 3)
  assert.equal(once.body.messages.length, LOCAL_SHARE_TURNS * 2)
  assert.deepEqual(JSON.parse(once.body.messages[0].content), [{ text_content: 'q3', type: 'text' }])
  assert.equal(once.body.title, 'q3')
  assert.equal(once.body.chat_session_id, objectId('dsh:s'))
  assert.match(once.body.messages[0].message_id, /^[0-9a-f]{24}$/)
  // The same session shares under the same ids.
  assert.deepEqual(localShareBody(turns, { sessionId: 's', updatedAt: 1_700_000_000_000 }).body, once.body)
})
