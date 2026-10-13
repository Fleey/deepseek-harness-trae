/**
 * dsh-trae2api — browser half.
 *
 * Renders one settings card in two places:
 *   - the Models settings page, inside the "Trae" provider row
 *     (slot `settings.models.provider-card`, keyed by our settings namespace);
 *   - the plugin's own page in the Plugins sidebar
 *     (slot `plugins.bundle.config`, keyed by the package name).
 *
 * The card edits the host plugin's volatile config fields through the settings
 * service, writes the Trae PAT to the credential store (never into config),
 * and shows whether Trae accepts it and which models it serves — the same
 * models the composer's model picker offers.
 */
window.__ModuleLoader__.load({
  id: 'dsh-trae2api',
  factory: (require) => {
    const React = require('react')
    const P = require('@deepseek-ai/dsh-client-ui-primitives')
    const h = React.createElement

    /** Settings namespace = the row id the bundle patch inserts. */
    const SETTINGS_NS = 'trae2api'
    /** Package name, the key of the plugin page's bundle-config slot. */
    const PACKAGE = 'dsh-trae2api'
    /** Locale namespace owned by this plugin. */
    const NS = 'dshTrae2api'
    /** Provider route the host registers. */
    const PROVIDER = 'trae'
    const DEFAULT_TOKEN_REF = 'TRAE_PAT'
    const TOKEN_FIELD = 'pat'

    const zh = {
      title: 'Trae',
      description: '直接使用 Trae 企业版的模型，只需填写个人访问令牌',
      token: 'Trae 个人访问令牌（PAT）',
      tokenHint: '在 Trae 企业版控制台生成。只保存在 dsh 的凭据库里，不会写进任何配置文件。保存后立即生效。',
      tokenSet: '已保存',
      tokenUnset: '未填写',
      unavailable: 'Trae 插件当前未加载，暂时无法配置。',
      readOnly: '当前部署的设置是只读的。',
      save: '保存',
      saving: '保存中…',
      saveFailed: '保存失败，修改已保留，请检查后重试。',
      status: '连接状态',
      checking: '正在连接 Trae…',
      ready: '已连接，{n} 个模型可用。在对话输入框右下角的模型菜单里选「Trae」分组下的模型，思考档位在同一菜单里切换。',
      failed: '连接失败',
      empty: 'Trae 没有返回任何模型。',
      refresh: '重新检测',
      models: '可用模型',
    }
    const en = {
      title: 'Trae',
      description: 'Use Trae enterprise models with just a Personal Access Token',
      token: 'Trae Personal Access Token (PAT)',
      tokenHint: 'Create it in the Trae enterprise console. Stored only in the dsh credential store, never in config. Takes effect on save.',
      tokenSet: 'Saved',
      tokenUnset: 'Not set',
      unavailable: 'The Trae plugin is not loaded right now.',
      readOnly: 'Settings are read-only in this deployment.',
      save: 'Save',
      saving: 'Saving…',
      saveFailed: 'Save failed; your edits were kept.',
      status: 'Connection',
      checking: 'Connecting to Trae…',
      ready: 'Connected, {n} models available. Pick one under "Trae" in the composer model menu; the thinking level is in the same menu.',
      failed: 'Connection failed',
      empty: 'Trae returned no models.',
      refresh: 'Check again',
      models: 'Models',
    }

    /** Settings form + credential + connection status for one card. */
    class TraeCardController {
      constructor(scope, ctx) {
        this.scope = scope
        this.ctx = ctx
        this.credential = { ref: '', configured: false, writable: true }
        this.status = { phase: 'idle', models: [], message: '' }
        this.statusGeneration = 0
        this.form = new P.SettingsFormModel(
          scope,
          [],
          [{ field: TOKEN_FIELD, write: text => this.writeToken(text) }],
        )
        this.store = this.form.bind(() => this.projection())
        this.unsubscribe = scope.subscribe(() => { void this.readCredential() })
        void this.readCredential()
      }

      projection() {
        return {
          ...this.form.shell(),
          token: this.form.field(TOKEN_FIELD),
          tokenConfigured: this.credential.configured,
          tokenWritable: this.credential.writable,
          status: this.status,
        }
      }

      tokenRef() {
        const declared = this.scope.getSnapshot().value?.patEnv
        return typeof declared === 'string' && declared.length > 0 ? declared : DEFAULT_TOKEN_REF
      }

      async readCredential() {
        const ref = this.tokenRef()
        if (ref !== this.credential.ref) {
          this.credential = { ref, configured: false, writable: true }
          this.store.set(this.projection())
        }
        let response
        try { response = await this.ctx.remote.credentials.describe([ref]) } catch { return }
        if (!response.ok || ref !== this.tokenRef()) return
        const view = response.value[ref]
        const next = { ref, configured: view?.configured ?? false, writable: view?.writable ?? true }
        if (next.configured === this.credential.configured && next.writable === this.credential.writable) return
        this.credential = next
        this.store.set(this.projection())
      }

      refreshCredential(ref) {
        if (ref === this.credential.ref) void this.readCredential()
      }

      async writeToken(value) {
        await this.ctx.remote.credentials.set(this.tokenRef(), value)
        await this.readCredential()
        // The host drops its cached JWT when the PAT changes; check right away.
        setTimeout(() => { void this.checkStatus() }, 300)
        return this.credential.configured
      }

      /** Ask the host's model catalog — the same source as the composer picker. */
      async checkStatus() {
        const generation = ++this.statusGeneration
        this.status = { phase: 'checking', models: this.status.models, message: '' }
        this.store.set(this.projection())
        let next
        try {
          const response = await this.ctx.remote.session.modelCatalog()
          if (!response.ok) {
            next = { phase: 'error', models: [], message: response.error?.message ?? String(response.error) }
          } else {
            const catalog = response.value
            const group = catalog.groups.find(g => g.id === PROVIDER)
            const failure = (catalog.failures ?? []).find(f => f.id === PROVIDER)
            if (group) next = { phase: 'ready', models: group.models.map(m => m.name || m.id), message: '' }
            else if (failure) next = { phase: 'error', models: [], message: failure.message }
            else next = { phase: 'empty', models: [], message: '' }
          }
        } catch (error) {
          next = { phase: 'error', models: [], message: error instanceof Error ? error.message : String(error) }
        }
        if (generation !== this.statusGeneration) return
        this.status = next
        this.store.set(this.projection())
      }

      inject() {
        const actions = this.form.actions()
        return {
          hooks: { traeCard: this.store },
          ...actions,
          save: () => {
            actions.save()
            setTimeout(() => { void this.checkStatus() }, 800)
          },
          checkStatus: () => { void this.checkStatus() },
        }
      }

      dispose() { this.unsubscribe(); this.form.dispose() }
    }

    function StatusBlock(props) {
      const { t, status } = props
      const React_ = React
      React_.useEffect(() => { if (status.phase === 'idle') props.checkStatus() }, [])
      const state = status.phase === 'ready' ? 'done'
        : status.phase === 'checking' || status.phase === 'idle' ? 'ongoing'
          : status.phase === 'empty' ? 'warning' : 'error'
      const line = status.phase === 'ready' ? t('ready').replace('{n}', String(status.models.length))
        : status.phase === 'checking' || status.phase === 'idle' ? t('checking')
          : status.phase === 'empty' ? t('empty') : `${t('failed')}：`
      const muted = { color: 'var(--dsw-alias-label-secondary)', fontSize: 'var(--dsw-font-xs-13, 13px)' }
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 } },
          t('status'),
          h('span', { style: { flex: 1 } }),
          h(P.Button, { variant: 'ghost', size: 'sm', type: 'button', disabled: status.phase === 'checking', onClick: () => props.checkStatus() }, t('refresh')),
        ),
        h('div', { style: { display: 'flex', alignItems: 'flex-start', gap: 8 } },
          h('span', { style: { paddingTop: 5 } }, h(P.StateDot, { state })),
          h('span', { style: { color: 'var(--dsw-alias-label-primary)' } }, line),
        ),
        status.phase === 'error' && status.message
          ? h('pre', {
            style: {
              ...muted, margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 180, overflow: 'auto',
              padding: 8, borderRadius: 'var(--dsw-radius-sm, 6px)', background: 'var(--dsw-alias-bg-layer-1)',
            },
          }, status.message)
          : null,
        status.phase === 'ready' && status.models.length > 0
          ? h('div', { style: muted }, `${t('models')}：${status.models.join('、')}`)
          : null,
      )
    }

    function TraeCard(props) {
      const { t } = props
      const state = props.useTraeCard(snapshot => snapshot)
      if (props.view === 'summary') return t('description')
      return h('div', null,
        h(P.SettingsForm, {
          labels: { unavailable: t('unavailable'), readOnly: t('readOnly'), saveFailed: t('saveFailed'), save: t('save'), saving: t('saving') },
          state,
          onSave: props.save,
          onDiscard: props.discard,
        },
        h(P.SettingsSecretField, {
          id: 'dsh-trae2api-token',
          label: t('token'),
          hint: t('tokenHint'),
          disabled: !state.tokenWritable,
          text: state.token.text,
          configured: state.tokenConfigured,
          stateLabel: state.tokenConfigured ? t('tokenSet') : t('tokenUnset'),
          onEdit: (text) => { props.edit(TOKEN_FIELD, text) },
        }),
        ),
        h(StatusBlock, { t, status: state.status, checkStatus: props.checkStatus }),
      )
    }

    /**
     * The Models page renders its generic editor above this slot; for a
     * namespace it does not know, that editor shows only a "edit cordis.patch.yml"
     * hint and a disabled Save, which reads as a broken second form. Hide that
     * hint and its footer (keeping the card's title). Guarded: if the page's
     * structure ever differs, nothing is touched.
     */
    function useHideGenericEditorChrome(ref) {
      React.useLayoutEffect(() => {
        const hidden = []
        let node = ref.current
        for (let depth = 0; node && depth < 6; depth++, node = node.parentElement) {
          const editor = node.previousElementSibling
          if (!editor) continue
          const hint = Array.from(editor.querySelectorAll('p'))
            .find(p => (p.textContent || '').trim().endsWith(`(${SETTINGS_NS})`))
          if (!hint) continue
          for (let el = hint; el; el = el.nextElementSibling) {
            hidden.push([el, el.style.display])
            el.style.display = 'none'
          }
          break
        }
        return () => { for (const [el, display] of hidden) el.style.display = display }
      })
    }

    /** The Models page passes provider-card owner props instead of a view; always render the full card. */
    function ProviderCardExtras(props) {
      const ref = React.useRef(null)
      useHideGenericEditorChrome(ref)
      return h('div', { ref }, h(TraeCard, { ...props, view: 'page' }))
    }

    return {
      inject: ['slots', 'locale', 'remote', 'remote.credentials', 'remote.session', 'configForms'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-trae2api: dictionaries')
        const card = new TraeCardController(ctx.configForms.get(SETTINGS_NS), ctx)
        ctx.effect(() => () => { card.dispose() }, 'dsh-trae2api: form')
        ctx.effect(
          () => ctx.remote.$on('credentials/reference-updated', (ref) => { card.refreshCredential(ref) }),
          'dsh-trae2api: credential updates',
        )
        ctx.effect(
          () => ctx.remote.$on('llm/adapters-updated', () => { void card.checkStatus() }),
          'dsh-trae2api: provider updates',
        )
        ctx.effect(() => ctx.configForms.whileServed([SETTINGS_NS], () => {
          const disposers = [
            ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
              name: 'plugins.bundle.config', key: PACKAGE, locale: NS, inject: () => card.inject(),
            }, TraeCard)),
            ctx.slots.inject('settings.models.provider-card', () => ctx.slots.register({
              name: 'settings.models.provider-card', key: SETTINGS_NS, locale: NS, inject: () => card.inject(),
            }, ProviderCardExtras)),
          ]
          return () => { for (const dispose of disposers) if (typeof dispose === 'function') dispose() }
        }), 'dsh-trae2api: settings card')
      },
    }
  },
})
