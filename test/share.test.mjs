// Share-link layer: the parsers and the request/审核 flow.
//
// Network is stubbed at `fetch`, so these run offline; the shapes asserted here
// are the ones the live API answered with (captured 2026-11-06).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  TraeShare, ShareError, parseSession, parseMessages, parseEntries, turnIdsOf,
  shareUrl, artifactUrl, SHARE_PATH, SESSIONS_PATH, TURN_LIMIT,
  AUDIT_ATTEMPTS, SHARE_CODES,
} from '../lib/testing.mjs'

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
  assert.deepEqual(turnIdsOf(parsed.items), ['t-1', 't-2'])
  // Only assistants carry one; a conversation with none yields nothing.
  assert.deepEqual(turnIdsOf([]), [])
  assert.deepEqual(turnIdsOf(parsed.items.filter(m => m.role === 'user')), [])
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
    assert.deepEqual(await makeShare(auth).turnsOf('cs-1'), ['t-1', 't-2'])
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

test('share: unpublishing is a PATCH on the status sub-resource', async () => {
  const stub = stubFetch(() => ({ body: { code: 0, data: { share_session_id: 'H6-Y3XMX7.KEK-', status: 'disabled' } } }))
  try {
    const auth = { get: async () => ({ token: 'JWT', expiresAt: Date.now() + 3_600_000 }) }
    const result = await makeShare(auth).setStatus('H6-Y3XMX7.KEK-', 'disabled')
    assert.equal(result.status, 'disabled')
    const call = stub.calls[0]
    assert.equal(call.method, 'PATCH')
    assert.equal(call.url, `https://share.invalid${SHARE_PATH}/H6-Y3XMX7.KEK-/status`)
    assert.deepEqual(JSON.parse(call.body), { share_session_id: 'H6-Y3XMX7.KEK-', status: 'disabled' })
  } finally { stub.restore() }
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
