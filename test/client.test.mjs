// The browser half against a stub host: loads lib/client.js the way the
// module loader does and checks every slot registration the way the real
// slot registry (dsh-client-ui-slots) validates it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/** Slot kinds as the host declares them (dsh-client-ui-conversation / settings). */
const LIST_SLOTS = new Set(['conversation.input.right', 'conversation.input.overlay'])
const KEYED_SLOTS = new Set(['plugins.bundle.config', 'settings.models.provider-card'])

function loadClient() {
  let module
  globalThis.window = { __ModuleLoader__: { load: (m) => { module = m } } }
  globalThis.document = { head: { appendChild() {} }, createElement: () => ({ dataset: {}, remove() {} }) }
  new Function(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'))()
  const stubs = {
    react: { createElement: () => null },
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
