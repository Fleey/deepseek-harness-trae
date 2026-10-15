// The browser half against a stub host: loads lib/client.js the way the
// module loader does and checks every slot registration the way the real
// slot registry (dsh-client-ui-slots) validates it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/** Slot kinds as the host declares them (dsh-client-ui-conversation / settings). */
const LIST_SLOTS = new Set(['conversation.input.right', 'conversation.input.overlay'])
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

test('client: every slot registration passes the host registry rules', () => {
  const plugin = loadClient()
  const registered = []
  const slots = {
    inject: (_name, fn) => { fn(); return () => {} },
    register: (options) => {
      if (LIST_SLOTS.has(options.name) && !options.id) throw new Error(`list slot "${options.name}" requires options.id`)
      if (KEYED_SLOTS.has(options.name) && !options.key) throw new Error(`keyed slot "${options.name}" requires options.key`)
      registered.push(options)
      return () => {}
    },
  }
  const ctx = {
    slots,
    locale: { register: () => () => {} },
    remote: { $on: () => () => {}, credentials: { describe: async () => ({ ok: false }) } },
    configForms: { get: () => ({ getSnapshot: () => ({}), subscribe: () => () => {} }), whileServed: (_ns, fn) => fn() },
    effect: (fn) => { fn() },
    inject: (_deps, cb) => { cb({ slots, modelDirectories: {} }) },
  }
  plugin.apply(ctx)
  const byName = Object.fromEntries(registered.map(r => [r.name, r]))
  assert.equal(byName['conversation.input.overlay'].id, 'trae-suggestion')
  assert.equal(byName['conversation.input.right'].id, 'trae-quota')
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
  const slots = {
    inject: (_name, fn) => { fn(); return () => {} },
    register: (options, component) => { if (options.id === 'trae-quota') Chip = component; return () => {} },
  }
  plugin.apply({
    slots,
    locale: { register: (_ns, dicts) => { zh = dicts.zh; return () => {} } },
    remote: { $on: () => () => {}, credentials: { describe: async () => ({ ok: false }) } },
    configForms: { get: () => ({ getSnapshot: () => ({}), subscribe: () => () => {} }), whileServed: (_ns, fn) => fn() },
    effect: (fn) => { fn() },
    inject: (_deps, cb) => { cb({ slots, modelDirectories: {} }) },
  })
  const node = Chip({
    t: key => zh[key],
    useTraeModel: select => select({ current: { provider: 'trae' } }),
    useTraeQuota: select => select({ phase: 'ready', value }),
    refresh: () => {},
  })
  return {
    label: node.children[0].children[0],
    color: node.children[0].props.style.color,
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

test('chip: the label carries one figure per allowance, coloured by the emptiest', () => {
  const two = renderChip({
    packs: [
      { name: '企业版', limit: 600, used: 510, remaining: 90 },
      { name: '加油包', limit: 200, used: 0, remaining: 200 },
    ],
    limit: 800, used: 510, remaining: 290, dollars: false,
  })
  assert.equal(two.label, 'Trae 剩余 15% / 100%')
  // 290 of 800 left is a comfortable 36% in total; the plan's own 15% is not,
  // and it is the figure the colour has to follow.
  assert.equal(two.color, 'var(--dsw-alias-state-error-primary)')

  // One allowance, or one beside a pack with no quota of this kind, stays a
  // single figure rather than growing a stray "/ 0%".
  assert.equal(renderChip({
    packs: [{ name: '企业版', limit: 800, used: 87.63, remaining: 712.37 }],
    limit: 800, used: 87.63, remaining: 712.37, dollars: false,
  }).label, 'Trae 剩余 89%')
  assert.equal(renderChip({
    packs: [
      { name: '免费', limit: 0, used: 0, remaining: 0 },
      { name: '企业版', limit: 800, used: 87.63, remaining: 712.37 },
    ],
    limit: 800, used: 87.63, remaining: 712.37, dollars: false,
  }).label, 'Trae 剩余 89%')
})
