// The browser half against a stub host: loads lib/client.js the way the
// module loader does and checks every slot registration the way the real
// slot registry (dsh-client-ui-slots) validates it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/** Slot kinds as the host declares them (dsh-client-ui-conversation / settings). */
const LIST_SLOTS = new Set(['conversation.input.right', 'conversation.input.dock', 'conversation.composer.dock'])
const KEYED_SLOTS = new Set(['plugins.bundle.config', 'settings.models.provider-card'])

function loadClient(react = { createElement: () => null }) {
  let module
  globalThis.window = { __ModuleLoader__: { load: (m) => { module = m } } }
  globalThis.document = { head: { appendChild() {} }, createElement: () => ({ dataset: {}, remove() {} }) }
  new Function(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'))()
  const stubs = {
    react,
    '@deepseek-ai/dsh-client-ui-primitives': {
      SettingsFormModel: class {
        bind(project) { return { getSnapshot: project, subscribe: () => () => {}, set() {} } }
        actions() { return {} }
        shell() { return {} }
        field() { return { text: '' } }
        dispose() {}
      },
    },
    'react-dom': { createPortal: () => null },
  }
  return module.factory((name) => stubs[name] ?? {})
}

/**
 * A stub host context carrying the services this client injects. `inject`
 * hands back the context itself, so a nested injection — the sidebar tab
 * inside the model-directory scope — reaches the same recorders.
 */
function hostCtx({ register = () => {}, openTab = () => {}, locale = () => {} } = {}) {
  const registered = []
  const tabTypes = []
  let dictionaries
  const slots = {
    inject: (_name, fn) => { fn(); return () => {} },
    register: (options, component) => { registered.push(options); register(options, component); return () => {} },
  }
  const ctx = {
    slots,
    locale: {
      register: (_ns, dicts) => { dictionaries = dicts; locale(dicts); return () => {} },
      bind: () => key => dictionaries?.zh?.[key] ?? key,
    },
    remote: { $on: () => () => {}, credentials: { describe: async () => ({ ok: false }) } },
    configForms: { get: () => ({ getSnapshot: () => ({}), subscribe: () => () => {} }), whileServed: (_ns, fn) => fn() },
    effect: (fn) => { fn() },
    modelDirectories: {},
    sidebarRight: { openTab },
    sidebarRightTabs: { register: (definition) => { tabTypes.push(definition); return () => {} } },
    inject: (_deps, cb) => { cb(ctx) },
  }
  return { ctx, registered, tabTypes }
}

test('client: every slot registration passes the host registry rules', () => {
  const plugin = loadClient()
  const { ctx, registered, tabTypes } = hostCtx({
    register: (options) => {
      if (LIST_SLOTS.has(options.name) && !options.id) throw new Error(`list slot "${options.name}" requires options.id`)
      if (KEYED_SLOTS.has(options.name) && !options.key) throw new Error(`keyed slot "${options.name}" requires options.key`)
    },
  })
  plugin.apply(ctx)
  const byName = Object.fromEntries(registered.map(r => [r.name, r]))
  const ids = name => registered.filter(r => r.name === name).map(r => r.id)
  assert.equal(byName['conversation.input.dock'].id, 'trae-choices')
  assert.equal(byName['conversation.input.overlay'], undefined, 'no Tab ghost text any more')
  // Two entries beside the model picker: the quota chip and the "switching
  // reopens the upstream conversation" notice.
  assert.deepEqual(ids('conversation.input.right'), ['trae-quota', 'trae-switch'])
  // The session ids are a tab of their own, not a composer reading.
  assert.equal(byName['conversation.composer.dock'], undefined)
  // The ids are one of the session's own View tabs, after the shipped ones,
  // and the row's label follows the active locale.
  assert.deepEqual(ids('conversation.view'), ['trae-session'])
  assert.equal(byName['conversation.view'].order, 100)
  assert.equal(byName['conversation.view'].label(), '会话 ID')
  // Nothing in the right sidebar or the session header any more.
  assert.equal(tabTypes.length, 0)
  assert.equal(byName['sidebar.right.pane.tab'], undefined)
  assert.equal(byName['conversation.session.header.utilities'], undefined)
  assert.ok(byName['plugins.bundle.config'] && byName['settings.models.provider-card'])
})

/**
 * Render the composer chip against a quota snapshot and return its label and
 * the lines of its tooltip. The element recorder stands in for React: nothing
 * is mounted, so effects are collected and never run, and the dictionaries the
 * client registers are the ones the strings are read from — asserting on what
 * a Chinese UI actually shows rather than on message keys.
 */
function renderChip(value) {
  const react = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useEffect: () => {},
  }
  const plugin = loadClient(react)
  let Chip
  let zh
  const { ctx } = hostCtx({
    register: (options, component) => { if (options.id === 'trae-quota') Chip = component },
    locale: (dicts) => { zh = dicts.zh },
  })
  plugin.apply(ctx)
  const node = Chip({
    t: key => zh[key],
    useTraeModel: select => select({ current: { provider: 'trae' } }),
    useTraeQuota: select => select({ phase: 'ready', value }),
    refresh: () => {},
  })
  const button = node.children[0]
  // The button is text, bar, text: the bar is a component the recorder leaves
  // uncalled, so it is rendered here the way React would to read its segments.
  const bar = button.children.find(child => child && typeof child.type === 'function')
  return {
    label: button.props['aria-label'],
    text: button.children.filter(child => child && typeof child.type === 'string')
      .map(child => child.children[0]).join(' '),
    color: button.props.style.color,
    segments: bar.type(bar.props).children.flat().map(segment => ({
      weight: Number(String(segment.props.style.flex).split(' ')[0]),
      left: segment.children[0].props.style.width,
      color: segment.children[0].props.style.background,
    })),
    lines: node.props.label.children[0].split('\n'),
  }
}

const chipTooltip = value => renderChip(value).lines

test('chip: several allowances are listed one by one, with the total only explaining the chip', () => {
  // The plan's own quota plus a top-up: 89% of the sum says nothing about
  // which of the two is nearly gone, so both are spelled out.
  assert.deepEqual(chipTooltip({
    packs: [
      { name: '企业版', limit: 600, used: 87.63, remaining: 512.37 },
      { name: '加油包', limit: 200, used: 0, remaining: 200 },
    ],
    limit: 800, used: 87.63, remaining: 712.37, dollars: false,
  }), [
    '企业版：剩余 512.37 / 600（85%）',
    '加油包：剩余 200 / 200（100%）',
    '合计：剩余 712.37 / 800（89%）',
    '点击刷新',
  ])

  // An unlimited pack and one that carries no quota of this kind still each
  // say what they can, rather than being folded into a number.
  assert.deepEqual(chipTooltip({
    packs: [
      { name: '不限量包', limit: null, used: 12, remaining: null },
      { name: '免费', limit: 0, used: 3, remaining: 0 },
      { name: '加油包', limit: 100, used: 40, remaining: 60 },
    ],
    limit: 100, used: 55, remaining: 60, dollars: true,
  }), [
    '不限量包：不限量',
    '免费：已用 $3',
    '加油包：剩余 $60 / $100（60%）',
    '合计：剩余 $60 / $100（60%）',
    '点击刷新',
  ])

  // One allowance is nothing to split: the line stays as it was.
  assert.deepEqual(chipTooltip({
    packs: [{ name: '企业版', limit: 800, used: 87.63, remaining: 712.37 }],
    limit: 800, used: 87.63, remaining: 712.37, dollars: false,
  }), ['剩余 712.37 / 800（89%）', '已用 87.63', '点击刷新'])
})

test('chip: one figure for the total, one bar segment per allowance', () => {
  const two = renderChip({
    packs: [
      { name: '企业版', limit: 600, used: 600, remaining: 0 },
      { name: '加油包', limit: 200, used: 24, remaining: 176 },
    ],
    limit: 800, used: 624, remaining: 176, dollars: false,
  })
  // "0% / 88%" read as a fraction; the chip now says what is left in total
  // and leaves which pack is gone to the bar.
  assert.equal(two.label, 'Trae 剩余 22%')
  assert.equal(two.text, 'Trae 剩余 22%')
  // The colour follows that same total: 22% left is tight, not yet empty.
  assert.equal(two.color, 'var(--dsw-alias-state-warn-primary)')
  // Segments are as wide as the allowance they stand for, and filled with
  // what is left of it — the drained plan is an empty 3:1 segment.
  assert.deepEqual(two.segments, [
    { weight: 0.75, left: '0%', color: 'var(--dsw-alias-state-error-primary)' },
    { weight: 0.25, left: '88%', color: 'var(--dsw-alias-state-success-primary)' },
  ])

  // A comfortable quota keeps the quiet label colour.
  const one = renderChip({
    packs: [{ name: '企业版', limit: 800, used: 87.63, remaining: 712.37 }],
    limit: 800, used: 87.63, remaining: 712.37, dollars: false,
  })
  assert.equal(one.label, 'Trae 剩余 89%')
  assert.equal(one.color, 'var(--dsw-alias-label-secondary)')
  assert.equal(one.segments.length, 1)

  // A pack with no quota of this kind (limit 0) has no share to fill, so it
  // draws no segment rather than a stray empty one.
  assert.equal(renderChip({
    packs: [
      { name: '免费', limit: 0, used: 0, remaining: 0 },
      { name: '企业版', limit: 800, used: 87.63, remaining: 712.37 },
    ],
    limit: 800, used: 87.63, remaining: 712.37, dollars: false,
  }).segments.length, 1)
})

/**
 * Walk the switch notice through a sequence of model selections, running its
 * effect between renders the way React would, and return what it showed after
 * each one (null = nothing shown). Timers are stubbed, so the notice never
 * expires inside the test and no handle outlives it.
 */
function renderNotice(selections) {
  const slots_ = []
  let cursor = 0
  let effect = null
  const react = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState: (initial) => {
      const at = cursor++
      if (!(at in slots_)) slots_[at] = initial
      return [slots_[at], (next) => { slots_[at] = typeof next === 'function' ? next(slots_[at]) : next }]
    },
    useRef: (initial) => {
      const at = cursor++
      if (!(at in slots_)) slots_[at] = { current: initial }
      return slots_[at]
    },
    useEffect: (fn) => { effect = fn },
  }
  const plugin = loadClient(react)
  let Notice, zh
  const { ctx } = hostCtx({
    register: (options, component) => { if (options.id === 'trae-switch') Notice = component },
    locale: (dicts) => { zh = dicts.zh },
  })
  plugin.apply(ctx)
  const timeout = globalThis.setTimeout
  const clear = globalThis.clearTimeout
  globalThis.setTimeout = () => 0
  globalThis.clearTimeout = () => {}
  const shown = []
  try {
    for (const current of selections) {
      const render = () => {
        cursor = 0
        effect = null
        return Notice({ t: key => zh[key], useTraeModel: select => select({ current }) })
      }
      render()
      if (effect) effect()
      // The state the effect set is only visible on the next render.
      const node = render()
      shown.push(node ? node.children[0].children[0] : null)
    }
  } finally {
    globalThis.setTimeout = timeout
    globalThis.clearTimeout = clear
  }
  return shown
}

test('switch notice: quiet until the picked model or level moves, and only for Trae', () => {
  const glm = { provider: 'trae', modelId: 'GLM-5.3', reasoningEffort: 'high' }
  // Binding a session to its first model is not a switch.
  assert.deepEqual(renderNotice([glm, glm]), [null, null])
  // The level alone is a switch: the next turn runs in a new upstream chat.
  assert.deepEqual(renderNotice([glm, { ...glm, reasoningEffort: 'light' }]), [null, '换了模型／档位 · 下一轮重开会话'])
  assert.deepEqual(renderNotice([glm, { ...glm, modelId: 'Kimi-K3' }]), [null, '换了模型／档位 · 下一轮重开会话'])
  // Another provider's selection is none of this plugin's business.
  assert.deepEqual(renderNotice([glm, { provider: 'deepseek', modelId: 'deepseek-chat' }]), [null, null])
  // A selection this plugin cannot read keeps it quiet rather than guessing.
  assert.deepEqual(renderNotice([null, glm]), [null, null])
})

const SESSION = 'f3a9c1d2-7b44-4e55-9a66-0b1122334455'
const UPSTREAM = 'c0ffee00-1111-5222-8333-444455556666'

const SUPPORT = `312308224:2026102815494900_${UPSTREAM}.no_mid.no_mid:codex_exec.0.206.1-tob.no_sid.no_ppe.T(2026/10/28 15:49:49)`

/**
 * Render the session-ids View tab against one answer from the host's session
 * route, running effects the way React would, then press one row's copy button
 * and report what landed on the clipboard. The clipboard and `fetch` are
 * stubbed for the call and put back after it.
 */
async function renderSessionTab(value, { provider = 'trae', sessionId = SESSION, copyRow = 0 } = {}) {
  const cells = []
  let cursor = 0
  let effects = []
  const react = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState: (initial) => {
      const at = cursor++
      if (!(at in cells)) cells[at] = initial
      return [cells[at], (next) => { cells[at] = typeof next === 'function' ? next(cells[at]) : next }]
    },
    useEffect: (fn) => { effects.push(fn) },
  }
  const plugin = loadClient(react)
  let Tab, zh
  const { ctx } = hostCtx({
    register: (options, component) => { if (options.name === 'conversation.view') Tab = component },
    locale: (dicts) => { zh = dicts.zh },
  })
  plugin.apply(ctx)
  const asked = []
  const copied = []
  const realFetch = globalThis.fetch
  const realNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const settle = () => new Promise(resolve => setTimeout(resolve, 0))
  globalThis.fetch = async (url) => { asked.push(String(url)); return Response.json({ ok: true, value }) }
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { clipboard: { writeText: async (text) => { copied.push(text) } } },
  })
  const props = {
    t: key => zh[key],
    sessionId,
    useTraeModel: select => select({ current: { provider, modelId: 'GLM-5.3' } }),
  }
  const render = (Component) => {
    cursor = 0
    effects = []
    return Component(props)
  }
  try {
    // The whole tab is rendered row by row: the recorder leaves child
    // components uncalled, so each row is rendered the way React would.
    render(Tab)
    for (const effect of effects) effect()
    await settle()
    const tab = render(Tab)
    const rows = tab.children.filter(child => child && typeof child.type === 'function').map((row) => {
      cursor = 0
      effects = []
      const node = row.type(row.props)
      const head = node.children[0]
      const body = node.children[1]
      return {
        label: head.children[0].children[0],
        copy: head.children[1],
        value: body.props.className === 'trae-id-value' ? body.children[0] : null,
        empty: body.props.className === 'trae-id-empty' ? body.children[0] : null,
        hint: node.children[2]?.children?.[0] ?? null,
      }
    })
    const pressed = rows[copyRow]
    if (pressed.copy) pressed.copy.props.onClick()
    await settle()
    return {
      // The line a session on another provider is told, when there is one.
      note: tab.children.find(child => child?.props?.className === 'trae-id-note')?.children?.[0] ?? null,
      rows,
      asked,
      copied,
    }
  } finally {
    globalThis.fetch = realFetch
    if (realNavigator) Object.defineProperty(globalThis, 'navigator', realNavigator)
  }
}

test('session tab: one row per id, each copied on its own, and no tab outside Trae', async () => {
  const ran = await renderSessionTab({
    session: SESSION, conversation: UPSTREAM, model: 'GLM-5.3', effort: 'high', at: 1, debug: SUPPORT,
  })
  assert.deepEqual(ran.rows.map(row => row.label), ['会话 ID', '上游会话', '排查串'])
  assert.deepEqual(ran.rows.map(row => row.value), [SESSION, UPSTREAM, SUPPORT])
  // The row says which variant that upstream chat belongs to.
  assert.equal(ran.rows[1].hint, '上一轮跑在：GLM-5.3 · high')
  assert.equal(ran.asked[0], `api/dsh-trae2api/session?session=${SESSION}`)
  // Pressing copy on the first row copies the whole session id, and re-reads:
  // the other two move with every turn.
  assert.deepEqual(ran.copied, [SESSION])
  assert.equal(ran.asked.length, 2)
  // On a Trae session the tab is only the rows.
  assert.equal(ran.note, null)

  const upstreamRow = await renderSessionTab({
    session: SESSION, conversation: UPSTREAM, model: 'Kimi-K3', effort: null, at: 1, debug: SUPPORT,
  }, { copyRow: 1 })
  assert.deepEqual(upstreamRow.copied, [UPSTREAM])
  assert.equal(upstreamRow.rows[1].hint, '上一轮跑在：Kimi-K3')
  const supportRow = await renderSessionTab({
    session: SESSION, conversation: UPSTREAM, model: 'GLM-5.3', effort: 'high', at: 1, debug: SUPPORT,
  }, { copyRow: 2 })
  assert.deepEqual(supportRow.copied, [SUPPORT])

  // Before the first answer there is no upstream chat and no support line: the
  // rows say so instead of offering an empty copy.
  const fresh = await renderSessionTab({
    session: SESSION, conversation: null, model: null, effort: null, at: null, debug: null,
  }, { copyRow: 1 })
  assert.deepEqual(fresh.rows.map(row => row.empty), [null, '这条会话还没发过一轮，发一轮就有了', '这条会话还没发过一轮，发一轮就有了'])
  assert.deepEqual(fresh.rows.map(row => row.copy === null), [false, true, true])
  assert.deepEqual(fresh.copied, [])

  // The View tab row is a global registry, so another provider's session has
  // this tab too: it says the last two rows are not about it, and still shows
  // the one id that is.
  const other = await renderSessionTab({
    session: SESSION, conversation: null, model: null, effort: null, at: null, debug: null,
  }, { provider: 'deepseek' })
  assert.equal(other.note, '这条会话现在选的不是 Trae 模型，下面两项说的是它上一轮跑 Trae 时的情况。')
  assert.equal(other.rows[0].value, SESSION)
})

/**
 * Render the next-step cards for one session state with the same element
 * recorder as the chip, plus just enough of React's state hook to re-render
 * after a click. Effects never run; the slot's own inject() supplies
 * load/clear/dismiss/close/take against the real controller, seeded through
 * its store.
 */
function renderCards({ cards, dismissed = [], subagent = false, running = false, draft = '', phase = 'plain' }) {
  const states = []
  let cursor = 0
  const react = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useEffect: () => {},
    useRef: value => ({ current: value }),
    useState: (initial) => {
      const at = cursor++
      if (!(at in states)) states[at] = initial
      return [states[at], (next) => { states[at] = typeof next === 'function' ? next(states[at]) : next }]
    },
  }
  const plugin = loadClient(react)
  let Cards, entry, zh
  const { ctx } = hostCtx({
    register: (options, component) => { if (options.id === 'trae-choices') { Cards = component; entry = options } },
    locale: (dicts) => { zh = dicts.zh },
  })
  plugin.apply(ctx)
  const injected = entry.inject('s1')
  const store = injected.hooks.traeChoices
  store.set({ id: 'sug-1', cards, dismissed, subagent })
  const sent = []
  const inputActions = {
    setDraft: (text) => { sent.push(['draft', text]) },
    submit: () => { sent.push(['submit']) },
  }
  const render = () => {
    cursor = 0
    return Cards({
      t: key => zh[key],
      sessionId: 's1',
      inputActions,
      useSession: select => select({ running }),
      useInput: select => select({ draft, phase }),
      useTraeChoices: select => select(store.getSnapshot()),
      ...injected,
    })
  }
  return { node: render(), render, store, sent }
}

/** Pull the parts of a card out of the recorded tree. */
const cardsOf = node => node.children[0]
const headOf = card => card.children[0]
const eyebrowOf = card => headOf(card).children[0].children[0].children[1]
const questionOf = card => headOf(card).children[0].children[1].children[0]
const closeOf = card => headOf(card).children[1]
const actionsOf = card => card.children[1].children
const choiceButtonsOf = card => actionsOf(card).filter(button => button.props['data-other'] === undefined)
const otherButtonOf = card => actionsOf(card).find(button => button.props['data-other'] === '')
const labelOf = button => button.children.at(-1).children[0]
const otherBoxOf = card => card.children[2]
/** The line under the round: who does the task, and what that means. */
const footOf = node => node.children[1]
const whoOf = node => footOf(node).children[0]
const noteOf = node => footOf(node).children[1].children[0]

const TWO_CARDS = [
  {
    question: '要把 README 里过时的安装路径改掉吗？',
    choices: [
      { label: '改路径', reply: '把 README 里过时的安装路径改成 DSH NEXT.app' },
      { label: '先查可执行名', reply: '先查一下实际的可执行文件名，再改路径' },
    ],
  },
  { question: '要补上配置何时生效的说明吗？', choices: [{ label: '补说明', reply: '在 README 里补上配置何时生效的说明' }] },
]

test('cards: one card per decision, the model\'s own answers as buttons, its pick first, then "something else"', () => {
  const { node } = renderCards({ cards: TWO_CARDS })
  assert.equal(node.props.className, 'trae-choices')
  const cards = cardsOf(node)
  assert.deepEqual(cards.map(questionOf), ['要把 README 里过时的安装路径改掉吗？', '要补上配置何时生效的说明吗？'])
  assert.deepEqual(cards.map(eyebrowOf), ['下一步 · 1/2', '下一步 · 2/2'])
  assert.deepEqual(cards.map(card => choiceButtonsOf(card).map(labelOf)), [['改路径', '先查可执行名'], ['补说明']])
  assert.deepEqual(choiceButtonsOf(cards[0]).map(button => button.props['data-primary']), ['', undefined])
  assert.deepEqual(cards.map(card => labelOf(otherButtonOf(card))), ['其他建议', '其他建议'])
  assert.equal(otherBoxOf(cards[0]), null, 'the box stays shut until asked for')

  // A single card needs no count.
  assert.equal(eyebrowOf(cardsOf(renderCards({ cards: TWO_CARDS.slice(0, 1) }).node)[0]), '下一步')
})

test('cards: a button sends its reply as the next message and retires every card', () => {
  const original = globalThis.fetch
  const events = []
  globalThis.fetch = async (_url, init) => { events.push(JSON.parse(init.body)); return Response.json({ ok: true }) }
  try {
    const { node, render, sent } = renderCards({ cards: TWO_CARDS })
    choiceButtonsOf(cardsOf(node)[0])[1].props.onClick()
    assert.deepEqual(sent, [['draft', '先查一下实际的可执行文件名，再改路径'], ['submit']])
    assert.deepEqual(events, [{ session: 's1', id: 'sug-1', action: 'accept', card: 0, choice: 1 }])
    assert.equal(render(), null)
  } finally { globalThis.fetch = original }
})

test('cards: with the host delegating, a button sends the task to a subagent and the cards say so', () => {
  const original = globalThis.fetch
  const events = []
  globalThis.fetch = async (_url, init) => { events.push(JSON.parse(init.body)); return Response.json({ ok: true }) }
  try {
    const { node, render, sent } = renderCards({ cards: TWO_CARDS, subagent: true })
    assert.equal(whoOf(node).props['aria-pressed'], true)
    assert.equal(labelOf(whoOf(node)), '子会话处理')
    assert.equal(noteOf(node), '点按钮后交给子会话去做，不占当前会话的上下文，做完回来汇报。')
    assert.deepEqual(cardsOf(node).map(card => eyebrowOf(card)), ['下一步 · 1/2', '下一步 · 2/2'])

    choiceButtonsOf(cardsOf(node)[0])[0].props.onClick()
    const [[, text]] = sent
    assert.ok(text.startsWith('请开一个子会话来做下面这件事：'), text)
    assert.ok(text.includes('subagent 工具'))
    assert.ok(text.endsWith('任务：把 README 里过时的安装路径改成 DSH NEXT.app'), text)
    assert.deepEqual(sent[1], ['submit'])
    // Which button was pressed is reported as before: the wrapping is the composer's.
    assert.deepEqual(events, [{ session: 's1', id: 'sug-1', action: 'accept', card: 0, choice: 0 }])
    assert.equal(render(), null)
  } finally { globalThis.fetch = original }
})

test('cards: the round can be switched back to this session, and sends the reply bare again', () => {
  const { node, render, sent } = renderCards({ cards: TWO_CARDS, subagent: true })
  whoOf(node).props.onClick()
  const back = render()
  assert.equal(whoOf(back).props['aria-pressed'], false)
  assert.equal(labelOf(whoOf(back)), '当前会话处理')
  assert.equal(noteOf(back), '点按钮后直接在当前会话里做。')

  otherButtonOf(cardsOf(back)[0]).props.onClick()
  const typed = otherBoxOf(cardsOf(render())[0]).children[0]
  typed.props.onChange({ target: { value: '先只改路径', style: {}, scrollHeight: 44 } })
  otherBoxOf(cardsOf(render())[0]).children[0].props.onKeyDown({
    key: 'Enter', shiftKey: false, keyCode: 0, nativeEvent: {}, preventDefault() {},
  })
  assert.deepEqual(sent, [['draft', '先只改路径'], ['submit']])
})

test('cards: the host\'s own words travel with the task when it goes to a subagent', () => {
  const { node, sent, render } = renderCards({ cards: TWO_CARDS, subagent: true })
  otherButtonOf(cardsOf(node)[0]).props.onClick()
  const box = otherBoxOf(cardsOf(render())[0])
  box.children[0].props.onChange({ target: { value: '把安装路径和配置说明一起改掉', style: {}, scrollHeight: 44 } })
  otherBoxOf(cardsOf(render())[0]).children[1].props.onClick()
  assert.equal(sent.length, 2)
  assert.ok(sent[0][1].endsWith('任务：把安装路径和配置说明一起改掉'), sent[0][1])
})

test('cards: "something else" opens a box on that card; Enter sends the user\'s own words, unreported', () => {
  const original = globalThis.fetch
  const events = []
  globalThis.fetch = async (_url, init) => { events.push(JSON.parse(init.body)); return Response.json({ ok: true }) }
  try {
    const { node, render, sent } = renderCards({ cards: TWO_CARDS })
    otherButtonOf(cardsOf(node)[1]).props.onClick()
    let cards = cardsOf(render())
    assert.equal(otherBoxOf(cards[0]), null)
    const box = otherBoxOf(cards[1])
    assert.equal(otherButtonOf(cards[1]).props['aria-expanded'], true)
    const [input, sendButton] = box.children
    assert.equal(input.props.autoFocus, true)
    assert.equal(input.props.placeholder, '说说你想怎么做，回车发送')
    assert.equal(sendButton.props.disabled, true, 'nothing typed, nothing to send')

    const key = (k, extra = {}) => ({ key: k, shiftKey: false, keyCode: 0, nativeEvent: {}, preventDefault() {}, ...extra })
    // Blank input: Enter does nothing.
    input.props.onKeyDown(key('Enter'))
    assert.deepEqual(sent, [])

    input.props.onChange({ target: { value: '  先只改路径，配置说明下次再补  ', style: {}, scrollHeight: 44 } })
    const [typed] = otherBoxOf(cardsOf(render())[1]).children
    assert.equal(typed.props.value, '  先只改路径，配置说明下次再补  ')
    // Enter while an IME is still composing picks a candidate, it does not send.
    typed.props.onKeyDown(key('Enter', { nativeEvent: { isComposing: true } }))
    typed.props.onKeyDown(key('Enter', { keyCode: 229 }))
    // Shift+Enter is a new line.
    typed.props.onKeyDown(key('Enter', { shiftKey: true }))
    assert.deepEqual(sent, [])

    typed.props.onKeyDown(key('Enter'))
    assert.deepEqual(sent, [['draft', '先只改路径，配置说明下次再补'], ['submit']])
    assert.deepEqual(events, [], 'the user\'s own words are no suggestion of Trae\'s')
    assert.equal(render(), null, 'answered: every card is done')
  } finally { globalThis.fetch = original }
})

test('cards: Escape or a second click shuts the box without sending', () => {
  const { node, render, sent } = renderCards({ cards: TWO_CARDS })
  otherButtonOf(cardsOf(node)[0]).props.onClick()
  otherBoxOf(cardsOf(render())[0]).children[0].props.onKeyDown({ key: 'Escape', shiftKey: false, keyCode: 0, nativeEvent: {}, preventDefault() {} })
  assert.equal(otherBoxOf(cardsOf(render())[0]), null)

  otherButtonOf(cardsOf(render())[0]).props.onClick()
  otherButtonOf(cardsOf(render())[0]).props.onClick()
  assert.equal(otherBoxOf(cardsOf(render())[0]), null)
  assert.deepEqual(sent, [])
})

test('cards: × closes just that card; typing, a running turn or an open menu hide them all', () => {
  const { node, render } = renderCards({ cards: TWO_CARDS })
  closeOf(cardsOf(node)[0]).props.onClick()
  assert.deepEqual(cardsOf(render()).map(questionOf), ['要补上配置何时生效的说明吗？'])

  assert.equal(renderCards({ cards: TWO_CARDS, draft: '我自己说' }).node, null)
  assert.equal(renderCards({ cards: TWO_CARDS, running: true }).node, null)
  assert.equal(renderCards({ cards: TWO_CARDS, phase: 'claimed' }).node, null)
  assert.equal(renderCards({ cards: TWO_CARDS, dismissed: [0, 1] }).node, null)
  assert.equal(renderCards({ cards: [] }).node, null)
})
