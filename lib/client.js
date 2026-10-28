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
 * models the composer's model picker offers — plus the remaining quota.
 *
 * The remaining quota also shows as a small chip next to the composer's model
 * picker (slot `conversation.input.right`) while a Trae model is selected, and
 * the stats row under the composer (slot `conversation.composer.dock`, beside
 * the host's own turn and token readings) carries this session's id — click to
 * copy it, Alt-click to copy the upstream conversation id its last turn ran in.
 *
 * After each Trae answer, cards above the composer (slot
 * `conversation.input.dock`) offer the next steps the answer left open, each
 * with the model's own answers as buttons; a button sends its reply — as a
 * subagent task while `suggestSubagent` is on, which the line under the cards
 * says and can switch back to this session.
 */
window.__ModuleLoader__.load({
  id: 'dsh-trae2api',
  factory: (require) => {
    const React = require('react')
    const P = require('@deepseek-ai/dsh-client-ui-primitives')
    // Optional: the collapsed status line goes up into the row's own header
    // when portals are available, and stays in the card body when they are not.
    let createPortal
    try { createPortal = require('react-dom').createPortal } catch { createPortal = undefined }
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
    /** Enterprise console login, only shown for a ToB seat (see src/trae/tob.ts). */
    const DEFAULT_CONSOLE_PASSWORD_REF = 'TRAE_CONSOLE_PASSWORD'
    const CONSOLE_PASSWORD_FIELD = 'consolePassword'
    const EMAIL_FIELD = 'consoleEmail'
    const DEFAULT_CONSOLE_EMAIL_REF = 'TRAE_CONSOLE_EMAIL'
    /** Host route serving the remaining quota (see QUOTA_ROUTE in src/index.ts). */
    const QUOTA_ROUTE = '/api/dsh-trae2api/quota'
    /** How often a visible chip re-reads the quota. */
    const QUOTA_POLL_MS = 5 * 60_000
    /** How long the "new upstream conversation next turn" notice stays up. */
    const SWITCH_NOTICE_MS = 8_000
    /** Host route serving the session's own id and its upstream one (SESSION_ROUTE). */
    const SESSION_ROUTE = '/api/dsh-trae2api/session'
    /** How long the chip says "copied" after a click. */
    const COPIED_MS = 1_600
    /** Host route serving next-step cards (see SUGGESTION_ROUTE in src/index.ts). */
    const SUGGESTION_ROUTE = '/api/dsh-trae2api/suggestion'
    /** How long a just-ended turn waits for its cards. */
    const SUGGESTION_WAIT_MS = 20_000
    /** Host route the composer reports shown cards / a pressed button to (SUGGESTION_EVENT_ROUTE). */
    const SUGGESTION_EVENT_ROUTE = '/api/dsh-trae2api/suggestion/event'
    /**
     * Fire-and-forget: the host dedupes, times and decides whether anything is
     * reported (Cue reporting is off unless configured).
     */
    function reportSuggestion(session, id, action, pick) {
      fetch(SUGGESTION_EVENT_ROUTE.slice(1), {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ session, id, action, ...pick }),
      }).catch(() => {})
    }

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
      ready: '已连接，{n} 个模型可用。在输入框的模型菜单里选「Trae」分组，思考档位在同一菜单。',
      failed: '连接失败',
      empty: 'Trae 没有返回任何模型。',
      refresh: '重新检测',
      models: '可用模型（{n}）',
      quota: '剩余额度',
      quotaRefresh: '刷新',
      quotaLoading: '正在查询额度…',
      quotaRemaining: '剩余 {remaining} / {limit}（{percent}）',
      quotaPackUsed: '已用 {used} / {limit}',
      quotaUsed: '已用 {used}',
      quotaUnlimited: '不限量',
      quotaEnds: '{date} 到期',
      quotaNone: '当前账号没有额度包。',
      quotaEnterprise: '你是企业版账号，填一下控制台账号就能看到额度。',
      quotaEnterpriseHint: '企业版的额度记在公司账户下（租户 {tenant}），Trae 给 IDE 的那个接口查不到，只有企业控制台知道。在下面填一次登录控制台用的邮箱和密码就好。',
      console: '企业控制台账号',
      consoleHint: '就是你登录 console.enterprise.trae.cn 用的那个账号。密码只存在 dsh 的凭据库里，不会写进配置文件。用 SSO 登录的公司暂时用不了这个。',
      consoleEmail: '邮箱',
      consolePassword: '密码',
      consoleSet: '已保存',
      consoleUnset: '未填写',
      consoleSaveFailed: '没保存上：',
      consoleSettled: '已连上控制台，额度正常读取中。要换账号就点右边的「修改」。',
      consoleEdit: '修改',
      credentialsEdit: '编辑',
      cancel: '取消',
      collapsedReady: '已连接 · {n} 个模型',
      collapsedQuota: '剩余 {percent}',
      consoleCollapse: '收起',
      quotaModels: '按模型用量（{n}）',
      quotaNoneHint: '查了 {source}，这个账号名下没有任何额度包。如果你在 Trae 官网能看到额度，说明接口对不上，欢迎把这行反馈回来。',
      quotaUnknown: 'Trae 返回了无法识别的额度格式。原始响应如下，可用于反馈：',
      quotaFailed: '额度查询失败：',
      quotaChip: 'Trae 剩余 {percent}',
      quotaChipPack: '{name}：{detail}',
      quotaChipTotal: '合计：{detail}',
      quotaChipHint: '点击刷新',
      sessionChip: 'ID {id}',
      sessionChipLabel: '当前会话 ID {id}，点击复制',
      sessionIdLine: '会话 ID：{id}',
      sessionUpstreamLine: '上游会话：{id}（{model}）',
      sessionUpstreamNone: '上游会话：这条会话还没发过一轮，发一轮就有了',
      sessionDebugLine: '排查串：{id}',
      sessionCopyHint: '点击复制会话 ID；Alt 点击复制上游会话 ID；Shift 点击复制排查串（Trae 客服那套格式）',
      sessionCopied: '已复制',
      sessionCopyFailed: '复制失败，ID 见上面这几行',
      switchNotice: '换了模型／档位 · 下一轮重开会话',
      switchNoticeHint: '上游是按会话绑定模型的：换了模型或思考档位，下一轮就在一条新的上游会话里跑。上一个模型的服务端状态和 prompt 缓存都不沿用，这一轮按完整 prompt 计费；换回原来的模型和档位，还是回到它自己那条会话。',
      switchCardHint: '换模型或思考档位会在下一轮开一条新的上游会话（prompt 缓存从头建立）——上游不认同一条会话里换模型。',
      choicesDismiss: '收起',
      choicesEyebrow: '下一步',
      choicesOther: '其他建议',
      choicesOtherPlaceholder: '说说你想怎么做，回车发送',
      choicesSend: '发送',
      choicesSubagentOn: '子会话处理',
      choicesSubagentOff: '当前会话处理',
      choicesSubagentHint: '点按钮后交给子会话去做，不占当前会话的上下文，做完回来汇报。',
      choicesInlineHint: '点按钮后直接在当前会话里做。',
      choicesSubagentToggle: '切换由谁来做：子会话 / 当前会话',
      choicesSubagentTask: '请开一个子会话来做下面这件事：用 subagent 工具把它派出去，你自己不要在当前会话里直接动手；子会话结束后把结果要点和改动过的文件告诉我。\n\n任务：{task}',
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
      ready: 'Connected, {n} models available. Pick one under "Trae" in the composer model menu; thinking level is in the same menu.',
      failed: 'Connection failed',
      empty: 'Trae returned no models.',
      refresh: 'Check again',
      models: 'Models ({n})',
      quota: 'Remaining quota',
      quotaRefresh: 'Refresh',
      quotaLoading: 'Checking quota…',
      quotaRemaining: '{remaining} of {limit} left ({percent})',
      quotaPackUsed: '{used} of {limit} used',
      quotaUsed: '{used} used',
      quotaUnlimited: 'Unlimited',
      quotaEnds: 'ends {date}',
      quotaNone: 'This account has no quota packs.',
      quotaEnterprise: 'This is an enterprise account — add the console login below to see your quota.',
      quotaEnterpriseHint: 'Your quota is metered on the company account (tenant {tenant}), which the IDE-facing API cannot see; only the enterprise console knows it. Just add the e-mail and password you sign in to the console with.',
      console: 'Enterprise console account',
      consoleHint: 'The account you sign in to console.enterprise.trae.cn with. The password is kept in dsh\'s credential store, never in a config file. SSO-only companies cannot use this yet.',
      consoleEmail: 'E-mail',
      consolePassword: 'Password',
      consoleSet: 'Saved',
      consoleUnset: 'Not set',
      consoleSaveFailed: 'Not saved: ',
      consoleSettled: 'Connected to the console; quota is reading fine. Use Change on the right to switch accounts.',
      consoleEdit: 'Change',
      credentialsEdit: 'Edit',
      cancel: 'Cancel',
      collapsedReady: 'Connected · {n} models',
      collapsedQuota: '{percent} left',
      consoleCollapse: 'Collapse',
      quotaModels: 'Usage by model ({n})',
      quotaNoneHint: 'Asked {source}: this account has no quota packs at all. If the Trae site does show quota for you, the plugin is asking the wrong place — worth reporting.',
      quotaUnknown: 'Trae answered in a quota format this plugin does not recognise. The raw answer, for a bug report:',
      quotaFailed: 'Quota check failed: ',
      quotaChip: 'Trae {percent} left',
      quotaChipPack: '{name}: {detail}',
      quotaChipTotal: 'Total: {detail}',
      quotaChipHint: 'Click to refresh',
      sessionChip: 'ID {id}',
      sessionChipLabel: 'Session id {id}, click to copy',
      sessionIdLine: 'Session id: {id}',
      sessionUpstreamLine: 'Upstream chat: {id} ({model})',
      sessionUpstreamNone: 'Upstream chat: this session has not run a turn yet',
      sessionDebugLine: 'Support line: {id}',
      sessionCopyHint: 'Click copies the session id; Alt the upstream one; Shift the support line (Trae\'s own format)',
      sessionCopied: 'Copied',
      sessionCopyFailed: 'Copy failed — the ids are in the lines above',
      switchNotice: 'Model/level changed · new chat next turn',
      switchNoticeHint: 'Upstream binds a chat to the model it started on: after a model or thinking-level switch, the next turn runs in a new upstream chat. None of the previous model\'s server-side state or prompt cache carries over, so that turn pays full prompt price; switching back to the earlier model and level returns to its own chat.',
      switchCardHint: 'Switching model or thinking level starts a new upstream chat on the next turn (prompt cache starts over) — upstream does not honour a model switch inside one chat.',
      choicesDismiss: 'Dismiss',
      choicesEyebrow: 'Next step',
      choicesOther: 'Something else',
      choicesOtherPlaceholder: 'Say what you want instead — Enter to send',
      choicesSend: 'Send',
      choicesSubagentOn: 'In a subagent',
      choicesSubagentOff: 'In this session',
      choicesSubagentHint: 'A button hands its task to a subagent: it stays out of this session\'s context and reports back when done.',
      choicesInlineHint: 'A button is done in this session, right here.',
      choicesSubagentToggle: 'Switch who does it: a subagent or this session',
      choicesSubagentTask: 'Hand the task below to a subagent: delegate it with the subagent tool instead of doing it in this session, and tell me what it found and which files it changed once the child is done.\n\nTask: {task}',
    }

    /** Minimal uSES-compatible snapshot store — the shape slot `hooks` bind to. */
    function createStore(initial) {
      let snapshot = initial
      const listeners = new Set()
      return {
        getSnapshot: () => snapshot,
        subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
        set: (next) => { snapshot = next; for (const listener of [...listeners]) listener() },
      }
    }

    /** Remaining quota, shared by the settings card and the composer chip. */
    class QuotaController {
      constructor() {
        this.store = createStore({ phase: 'idle', value: null, error: '', at: 0 })
        this.generation = 0
      }

      /**
       * Read the quota from the host. Without `force` a read younger than a
       * minute (or one in flight) is reused; `force` also skips the host's cache.
       */
      async load(force) {
        const current = this.store.getSnapshot()
        if (!force && (current.phase === 'loading' || Date.now() - current.at < 60_000)) return
        const generation = ++this.generation
        this.store.set({ ...current, phase: 'loading' })
        let next
        try {
          // Page-relative, like the official clients' `api/...` routes, so a
          // prefixed mount and the Desktop page both resolve it.
          const response = await fetch(`${QUOTA_ROUTE.slice(1)}${force ? '?refresh=1' : ''}`, { headers: { accept: 'application/json' } })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const body = await response.json()
          next = body && body.ok === true
            ? { phase: 'ready', value: body.value, error: '', at: Date.now() }
            : { phase: 'error', value: current.value, error: String(body?.error ?? 'unknown error'), at: Date.now() }
        } catch (error) {
          next = { phase: 'error', value: current.value, error: error instanceof Error ? error.message : String(error), at: Date.now() }
        }
        if (generation === this.generation) this.store.set(next)
      }
    }

    /** A session without cards: before its first answer, while a turn runs, after a pick. */
    const NO_CHOICES = Object.freeze({ id: '', cards: [], dismissed: [], subagent: false })

    /**
     * Next-step cards per session, the browser end of src/trae/suggest.ts.
     * A session's snapshot is `{ id, cards, dismissed, subagent }`: the
     * suggestion's id, its cards (`{ question, choices: [{ label, reply }] }`),
     * the indexes of cards closed without an answer, and whether the host asks
     * for a pressed button to go to a subagent (config `suggestSubagent`).
     * Kept for the page's lifetime, so switching back to a session shows what
     * it had.
     */
    class SuggestionController {
      constructor() {
        this.stores = new Map()
      }

      storeFor(sessionId) {
        let store = this.stores.get(sessionId)
        if (!store) {
          store = createStore(NO_CHOICES)
          this.stores.set(sessionId, store)
        }
        return store
      }

      /** A turn is running: whatever was offered is stale. */
      clear(sessionId) {
        this.storeFor(sessionId).set(NO_CHOICES)
      }

      /** Read the session's cards, waiting up to `waitMs` for ones still being generated. Returns a canceller. */
      load(sessionId, waitMs) {
        const abort = new AbortController()
        fetch(`${SUGGESTION_ROUTE.slice(1)}?session=${encodeURIComponent(sessionId)}&wait=${waitMs}`, {
          headers: { accept: 'application/json' }, signal: abort.signal,
        })
          .then(response => response.ok ? response.json() : null)
          .then((body) => {
            if (abort.signal.aborted) return
            const value = body?.ok ? body.value : null
            const store = this.storeFor(sessionId)
            if (!value || !Array.isArray(value.cards) || value.cards.length === 0) store.set(NO_CHOICES)
            // Read again, the same suggestion keeps the cards already closed or answered.
            else if (store.getSnapshot().id !== value.id) {
              store.set({ id: value.id, cards: value.cards, dismissed: [], subagent: value.subagent === true })
            }
          })
          .catch(() => {})
        return () => { abort.abort() }
      }

      /** Card `card` closed without an answer. */
      dismiss(sessionId, card) {
        const store = this.storeFor(sessionId)
        const current = store.getSnapshot()
        if (!current.dismissed.includes(card)) store.set({ ...current, dismissed: [...current.dismissed, card] })
      }

      /** The user answered: every card is done, and the same suggestion read again stays done. */
      close(sessionId) {
        const store = this.storeFor(sessionId)
        store.set({ ...store.getSnapshot(), cards: [], dismissed: [] })
      }

      /** Button `choice` of card `card` pressed: every card is done. Returns that button's choice. */
      take(sessionId, card, choice) {
        const picked = this.storeFor(sessionId).getSnapshot().cards[card]?.choices?.[choice]
        if (picked) this.close(sessionId)
        return picked
      }
    }

    function formatAmount(n, dollars) {
      const text = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(n)
      return dollars ? `$${text}` : text
    }

    /** Remaining share of the limit in percent, or null when there is no finite limit. */
    function remainingPercent(value) {
      if (!value || value.limit === null || value.remaining === null || !(value.limit > 0)) return null
      return Math.max(0, Math.min(100, (value.remaining / value.limit) * 100))
    }

    /** 17114388 -> "17.1M", so a model row stays one line. */
    function formatTokens(n) {
      if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`
      if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
      if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
      return String(n)
    }

    function formatPercent(p) {
      return `${p >= 10 ? Math.round(p) : Math.round(p * 10) / 10}%`
    }

    function formatDate(ms) {
      return new Date(ms).toLocaleDateString()
    }

    /** "1,234 / 2,000 left (62%)" for a quota with a finite limit. */
    function remainingLine(t, value) {
      return t('quotaRemaining')
        .replace('{remaining}', formatAmount(value.remaining, value.dollars))
        .replace('{limit}', formatAmount(value.limit, value.dollars))
        .replace('{percent}', formatPercent(remainingPercent(value) ?? 0))
    }

    /**
     * What is left of one allowance, however that allowance is shaped: a
     * finite limit reads as the usual remaining line, an unlimited pack says
     * so, and a pack with no limit of this kind (limit 0) can only report
     * what it has spent.
     */
    function packDetail(t, pack, dollars) {
      if (pack.limit === null) return t('quotaUnlimited')
      if (remainingPercent(pack) === null) return t('quotaUsed').replace('{used}', formatAmount(pack.used, dollars))
      return remainingLine(t, { ...pack, dollars })
    }

    /** Settings form + credential + connection status for one card. */
    class TraeCardController {
      constructor(scope, ctx, quota) {
        this.scope = scope
        this.ctx = ctx
        this.quota = quota
        this.credential = { ref: '', configured: false, writable: true }
        this.consoleCredential = { ref: '', configured: false, writable: true }
        this.consoleEmailCredential = { ref: '', configured: false, writable: true }
        /** Last credential-write failure, shown under the fields. */
        this.credentialError = ''
        this.status = { phase: 'idle', models: [], message: '' }
        this.statusGeneration = 0
        this.form = new P.SettingsFormModel(
          scope,
          [],
          [
            { field: TOKEN_FIELD, write: text => this.writeToken(text) },
            { field: EMAIL_FIELD, write: text => this.writeSecret('consoleEmailCredential', this.consoleEmailRef(), text) },
            { field: CONSOLE_PASSWORD_FIELD, write: text => this.writeSecret('consoleCredential', this.consoleRef(), text) },
          ],
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
          email: this.form.field(EMAIL_FIELD),
          emailConfigured: this.consoleEmailCredential.configured,
          emailWritable: this.consoleEmailCredential.writable,
          consolePassword: this.form.field(CONSOLE_PASSWORD_FIELD),
          consoleConfigured: this.consoleCredential.configured,
          consoleWritable: this.consoleCredential.writable,
          credentialError: this.credentialError,
          status: this.status,
        }
      }

      tokenRef() {
        const declared = this.scope.getSnapshot().value?.patEnv
        return typeof declared === 'string' && declared.length > 0 ? declared : DEFAULT_TOKEN_REF
      }

      consoleRef() {
        const declared = this.scope.getSnapshot().value?.consolePasswordEnv
        return typeof declared === 'string' && declared.length > 0 ? declared : DEFAULT_CONSOLE_PASSWORD_REF
      }

      consoleEmailRef() {
        const declared = this.scope.getSnapshot().value?.consoleEmailEnv
        return typeof declared === 'string' && declared.length > 0 ? declared : DEFAULT_CONSOLE_EMAIL_REF
      }

      /** The three credential slots this card owns: [state key, reference]. */
      slots() {
        return [
          ['credential', this.tokenRef()],
          ['consoleEmailCredential', this.consoleEmailRef()],
          ['consoleCredential', this.consoleRef()],
        ]
      }

      async readCredential() {
        const slots = this.slots()
        let changed = false
        for (const [key, ref] of slots) {
          if (ref === this[key].ref) continue
          this[key] = { ref, configured: false, writable: true }
          changed = true
        }
        if (changed) this.store.set(this.projection())
        let response
        try { response = await this.ctx.remote.credentials.describe(slots.map(([, ref]) => ref)) } catch { return }
        const current = this.slots()
        if (!response.ok || current.some(([key, ref], i) => key !== slots[i][0] || ref !== slots[i][1])) return
        changed = false
        for (const [key, ref] of slots) {
          const view = response.value[ref]
          const next = { ref, configured: view?.configured ?? false, writable: view?.writable ?? true }
          if (next.configured === this[key].configured && next.writable === this[key].writable) continue
          this[key] = next
          changed = true
        }
        if (changed) this.store.set(this.projection())
      }

      refreshCredential(ref) {
        if (this.slots().some(([, name]) => name === ref)) void this.readCredential()
      }

      async writeToken(value) {
        const ok = await this.writeSecret('credential', this.tokenRef(), value)
        // The host drops its cached JWT when the PAT changes; check right away.
        if (ok) setTimeout(() => { void this.checkStatus() }, 300)
        return ok
      }

      /**
       * Write one credential and report whether it landed. The form only knows
       * "saved" or "failed", so the reason is kept here and shown by the card —
       * otherwise a rejected write reads as an unexplained failure.
       */
      async writeSecret(key, ref, value) {
        try {
          const response = await this.ctx.remote.credentials.set(ref, value)
          if (response && response.ok === false) {
            this.credentialError = `${ref}: ${response.error?.message ?? String(response.error)}`
            this.store.set(this.projection())
            return false
          }
        } catch (error) {
          this.credentialError = `${ref}: ${error instanceof Error ? error.message : String(error)}`
          this.store.set(this.projection())
          return false
        }
        this.credentialError = ''
        await this.readCredential()
        setTimeout(() => { void this.quota.load(true) }, 300)
        return this[key].configured
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
          hooks: { traeCard: this.store, traeQuota: this.quota.store },
          ...actions,
          save: () => {
            actions.save()
            setTimeout(() => { void this.checkStatus() }, 800)
          },
          checkStatus: () => { void this.checkStatus() },
          refreshQuota: (force) => { void this.quota.load(force) },
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
        // Switching the picker mid-conversation is not free: say so where the
        // picker is first mentioned, so the composer notice later is a reminder
        // rather than a surprise.
        status.phase === 'ready' ? h('span', { style: muted }, t('switchCardHint')) : null,
        // 24 names is a wall of text in a settings card: keep it one line,
        // openable when someone actually wants to read it.
        status.phase === 'ready' && status.models.length > 0
          ? h('details', { style: muted },
            h('summary', { style: { cursor: 'pointer' } }, t('models').replace('{n}', String(status.models.length))),
            h('div', { style: { marginTop: 4 } }, status.models.join('、')),
          )
          : null,
      )
    }

    /**
     * How much of an allowance is spent, as a colour: comfortable, getting
     * tight, nearly gone. The bands are on the spent share, so a bar that
     * grows to the right also warms up as it goes.
     */
    const TONE_COLOR = {
      ok: 'var(--dsw-alias-state-success-primary)',
      warn: 'var(--dsw-alias-state-warn-primary)',
      low: 'var(--dsw-alias-state-error-primary)',
    }

    /** Composer room is scarce: the chip's bar reads at a glance and no wider. */
    const QUOTA_BAR_WIDTH = 34

    function meterTone(spent) {
      if (spent >= 85) return 'low'
      if (spent >= 60) return 'warn'
      return 'ok'
    }

    /**
     * One allowance: its name, what is left of it, and a bar that fills from
     * the left with what has been spent.
     */
    function QuotaMeter(props) {
      const { t, pack, dollars } = props
      const muted = { color: 'var(--dsw-alias-label-secondary)', fontSize: 'var(--dsw-font-xs-13, 13px)' }
      const unlimited = pack.limit === null
      const spent = unlimited || !(pack.limit > 0) ? 0 : Math.max(0, Math.min(100, (pack.used / pack.limit) * 100))
      const tone = meterTone(spent)
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
        h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 'var(--dsw-font-xs-13, 13px)' } },
          h('span', { style: { color: 'var(--dsw-alias-label-primary)', flex: 1, minWidth: 0 } }, pack.name),
          h('span', {
            style: {
              ...muted, fontVariantNumeric: 'tabular-nums',
              // The figure picks up the bar's colour once it starts to matter.
              ...tone === 'ok' || unlimited ? {} : { color: TONE_COLOR[tone] },
            },
          }, unlimited ? t('quotaUnlimited')
            : t('quotaPackUsed')
              .replace('{used}', formatAmount(pack.used, dollars))
              .replace('{limit}', formatAmount(pack.limit, dollars))),
        ),
        unlimited ? null : h('div', {
          style: {
            height: 6, borderRadius: 999, overflow: 'hidden',
            background: 'var(--dsw-alias-bg-layer-2)',
          },
        }, h('div', {
          style: {
            width: `${spent}%`, height: '100%', borderRadius: 999,
            transition: 'width 240ms ease, background-color 240ms ease',
            background: TONE_COLOR[tone],
          },
        })),
        pack.endsAt === undefined ? null
          : h('div', { style: muted }, t('quotaEnds').replace('{date}', formatDate(pack.endsAt))),
      )
    }

    function QuotaBlock(props) {
      const { t, quota } = props
      React.useEffect(() => { props.refresh(false) }, [])
      const value = quota.value
      const muted = { color: 'var(--dsw-alias-label-secondary)', fontSize: 'var(--dsw-font-xs-13, 13px)' }
      const pre = text => h('pre', {
        style: {
          ...muted, margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 180, overflow: 'auto',
          padding: 8, borderRadius: 'var(--dsw-radius-sm, 6px)', background: 'var(--dsw-alias-bg-layer-1)',
        },
      }, text)
      // Prose, not a code block: the mono `pre` is for raw upstream answers.
      const note = text => h('p', { style: { ...muted, margin: 0, lineHeight: 1.5 } }, text)
      const percent = remainingPercent(value)

      let state, line, extra = []
      if (quota.phase === 'error') {
        state = 'error'; line = t('quotaFailed'); extra = [pre(quota.error)]
      } else if (!value) {
        state = 'ongoing'; line = t('quotaLoading')
      } else if (value.raw !== undefined) {
        state = 'warning'; line = t('quotaUnknown'); extra = [pre(value.raw)]
      } else if (value.packs.length === 0 && value.seat === 'enterprise') {
        // A ToB seat's quota sits on the enterprise tenant, which this personal
        // entitlement API never carries: saying "no quota packs" would be wrong.
        state = 'warning'; line = t('quotaEnterprise')
        extra = [note(t('quotaEnterpriseHint').replace('{tenant}', value.tenant || '—'))]
      } else if (value.packs.length === 0) {
        // Name the endpoint: an account that really has nothing reads the same
        // as one whose quota lives somewhere this plugin does not ask.
        state = 'warning'; line = t('quotaNone')
        if (value.source) extra = [note(t('quotaNoneHint').replace('{source}', value.source))]
      } else {
        state = percent !== null && percent < 10 ? 'warning' : 'done'
        line = value.limit === null ? t('quotaUnlimited') : remainingLine(t, value)
        if (value.endsAt !== undefined) {
          extra.push(h('div', { key: 'ends', style: muted }, t('quotaEnds').replace('{date}', formatDate(value.endsAt))))
        }
        // One meter per pack, each filling left to right with what is spent —
        // a seat allowance and a pay-as-you-go allowance run down separately,
        // and a single combined bar hides which one is nearly gone.
        extra.push(h('div', {
          key: 'meters',
          style: { display: 'flex', flexDirection: 'column', gap: 10, marginTop: 2 },
        }, value.packs.map(pack => h(QuotaMeter, { key: pack.name, t, pack, dollars: value.dollars }))))
        // Only the enterprise console reports per-model figures; fold them away.
        if (value.models && value.models.length > 0) {
          extra.push(h('details', { key: 'models', style: { ...muted, marginTop: 2 } },
            h('summary', { style: { cursor: 'pointer' } }, t('quotaModels').replace('{n}', String(value.models.length))),
            h('div', { style: { marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 } },
              value.models.map(model => h('div', {
                key: model.name,
                style: { display: 'flex', alignItems: 'baseline', gap: 8 },
              },
              h('span', { style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, model.name),
              h('span', { style: { fontVariantNumeric: 'tabular-nums' } }, `${formatTokens(model.tokens)} tokens`),
              h('span', { style: { fontVariantNumeric: 'tabular-nums', minWidth: 64, textAlign: 'right' } }, formatAmount(model.cost, value.dollars)),
              )),
            ),
          ))
        }
      }

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 } },
          t('quota'),
          h('span', { style: { flex: 1 } }),
          h(P.Button, { variant: 'ghost', size: 'sm', type: 'button', disabled: quota.phase === 'loading', onClick: () => props.refresh(true) }, t('quotaRefresh')),
        ),
        h('div', { style: { display: 'flex', alignItems: 'flex-start', gap: 8 } },
          h('span', { style: { paddingTop: 5 } }, h(P.StateDot, { state })),
          h('span', {
            style: { color: 'var(--dsw-alias-label-primary)', fontVariantNumeric: 'tabular-nums' },
          }, line),
        ),
        ...extra,
      )
    }

    /**
     * The chip's bar: one segment per allowance with a finite limit, each as
     * wide as that allowance's share of the whole and filled with what is
     * left of it. Two numbers side by side read as a fraction ("0% / 88%"),
     * a bar does not — the drained pack is simply an empty segment.
     */
    function QuotaBar(props) {
      const { packs } = props
      const total = packs.reduce((sum, pack) => sum + pack.limit, 0)
      return h('span', {
        'aria-hidden': 'true',
        style: { display: 'inline-flex', alignItems: 'center', gap: 2, width: QUOTA_BAR_WIDTH, flex: 'none' },
      }, packs.map(pack => {
        const left = remainingPercent(pack) ?? 0
        return h('span', {
          key: pack.name,
          style: {
            // Weighted by the allowance itself: a 600 plan beside a 200 top-up
            // reads as 3:1, so a nearly empty big pack cannot look like a nick.
            flex: `${total > 0 ? pack.limit / total : 1} 1 0`,
            minWidth: 4, height: 6, borderRadius: 999, overflow: 'hidden',
            background: 'var(--dsw-alias-bg-layer-2)',
          },
        }, h('span', {
          style: {
            display: 'block', width: `${left}%`, height: '100%', borderRadius: 999,
            transition: 'width 240ms ease, background-color 240ms ease',
            background: TONE_COLOR[meterTone(100 - left)],
          },
        }))
      }))
    }

    /**
     * Composer chip beside the model picker: a bar of the session's Trae
     * allowances followed by one figure — what is left in total — while the
     * session's model is a Trae one and the quota has a finite limit; nothing
     * otherwise (no error noise in the composer — the card shows those).
     * Clicking re-reads the quota past every cache.
     */
    function QuotaChip(props) {
      const { t } = props
      const provider = props.useTraeModel(snapshot => snapshot?.current?.provider)
      const quota = props.useTraeQuota(snapshot => snapshot)
      const active = provider === PROVIDER
      React.useEffect(() => {
        if (!active) return undefined
        props.refresh(false)
        const timer = setInterval(() => { props.refresh(false) }, QUOTA_POLL_MS)
        return () => { clearInterval(timer) }
      }, [active])
      const value = quota.value
      const percent = remainingPercent(value)
      if (!active || quota.phase === 'error' || !value || value.raw !== undefined || percent === null) return null
      // Several allowances are several numbers: adding a top-up pack to the
      // plan's own quota hides which one is about to run out, so each pack
      // gets its line and the total follows only to explain the chip's figure.
      const details = value.packs.length > 1
        ? [
            ...value.packs.map(pack => t('quotaChipPack')
              .replace('{name}', pack.name)
              .replace('{detail}', packDetail(t, pack, value.dollars))),
            t('quotaChipTotal').replace('{detail}', remainingLine(t, value)),
          ]
        : [remainingLine(t, value), t('quotaUsed').replace('{used}', formatAmount(value.used, value.dollars))]
      if (value.endsAt !== undefined) details.push(t('quotaEnds').replace('{date}', formatDate(value.endsAt)))
      details.push(t('quotaChipHint'))
      // The bar splits in pack order. A pack carrying no quota of this kind
      // (limit 0) has no share to fill and is left out, so one real allowance
      // beside a free empty pack still draws as a single segment.
      const bars = value.packs.filter(pack => remainingPercent(pack) !== null)
      // Same bands as the card's meters, read off what is left rather than
      // spent; a comfortable chip stays quiet grey instead of shouting green.
      // The figure is the total, so its colour follows the total: which pack
      // is nearly gone is the bar's job, and the tooltip spells it out.
      const tone = meterTone(100 - percent)
      const color = tone === 'ok' ? 'var(--dsw-alias-label-secondary)' : TONE_COLOR[tone]
      // The same sentence the chip used to be, split around its figure: the
      // bar takes the figure's place, and the figure follows it.
      const [before, after] = t('quotaChip').split('{percent}')
      const label = t('quotaChip').replace('{percent}', formatPercent(percent))
      return h(P.Tooltip, { label: h('div', { style: { whiteSpace: 'pre-line' } }, details.join('\n')), side: 'top' },
        h('button', {
          type: 'button',
          onClick: () => { props.refresh(true) },
          'aria-label': label,
          style: {
            display: 'inline-flex', alignItems: 'center', gap: 6,
            border: 'none', background: 'transparent', cursor: 'pointer', padding: '2px 6px', borderRadius: 6,
            color, fontSize: 12, lineHeight: '20px', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums',
            opacity: quota.phase === 'loading' ? 0.6 : 1,
          },
        },
        before.trim() === '' ? null : h('span', { key: 'before' }, before.trim()),
        h(QuotaBar, { key: 'bar', packs: bars.length > 0 ? bars : [{ name: 'total', limit: 1, remaining: percent / 100 }] }),
        h('span', { key: 'figure' }, `${formatPercent(percent)}${after}`),
        ),
      )
    }

    /**
     * Signature of a session's model selection — what a switch changes. The
     * directory's snapshot shape belongs to the host's model picker, so the
     * model and level fields are picked by name and the whole selection is the
     * fallback: an unexpected shape makes the notice quiet, never wrong about
     * which field moved.
     */
    function selectionKey(current) {
      if (!current || typeof current !== 'object') return null
      const named = Object.keys(current).filter(key => /model|effort|reasoning/i.test(key)).sort()
      const fields = named.length > 0 ? named : Object.keys(current).sort()
      try {
        return JSON.stringify(fields.map(key => [key, current[key]]))
      } catch { return null }
    }

    /**
     * Composer notice beside the model picker: the picked model or thinking
     * level just changed, so the next turn runs in a new upstream conversation
     * (the host half derives the id from the variant — see `conversationUuid`
     * in src/trae/wire.ts). Shown for a few seconds, then gone; it says what
     * the switch costs rather than asking for anything.
     */
    function SwitchNotice(props) {
      const { t } = props
      const current = props.useTraeModel(snapshot => snapshot?.current ?? null)
      const key = selectionKey(current)
      const active = current?.provider === PROVIDER
      const [shownAt, setShownAt] = React.useState(0)
      const last = React.useRef(key)
      React.useEffect(() => {
        const previous = last.current
        last.current = key
        // Binding the session to its first model is not a switch, and neither
        // is a selection this plugin cannot read.
        if (!active || !key || !previous || previous === key) return undefined
        setShownAt(Date.now())
        const timer = setTimeout(() => { setShownAt(0) }, SWITCH_NOTICE_MS)
        return () => { clearTimeout(timer) }
      }, [key, active])
      if (!active || !shownAt) return null
      return h(P.Tooltip, { label: h('div', { style: { whiteSpace: 'pre-line' } }, t('switchNoticeHint')), side: 'top' },
        h('span', {
          style: {
            padding: '2px 6px', borderRadius: 6, color: 'var(--dsw-alias-label-secondary)',
            fontSize: 12, lineHeight: '20px', whiteSpace: 'nowrap',
          },
        }, t('switchNotice')),
      )
    }

    /**
     * Put `text` on the clipboard, and say whether it landed. The async
     * clipboard is the normal path; a page it is not granted on (an insecure
     * origin, a stricter WebView) falls back to the old selection copy, which
     * needs a real element on the page.
     */
    async function copyText(text) {
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text)
          return true
        }
      } catch { /* denied or unavailable: try the old way */ }
      try {
        const area = document.createElement('textarea')
        area.value = text
        area.setAttribute('readonly', '')
        area.style.cssText = 'position:fixed;top:-1000px;opacity:0'
        document.body.appendChild(area)
        area.select()
        const ok = document.execCommand('copy')
        area.remove()
        return ok === true
      } catch { return false }
    }

    /**
     * The telling head of an id. A harness session id is a prefix plus a UUID
     * (`session-9c2f9c16-…`), and the prefix is the same for every session, so
     * the first characters of the id say nothing: skip a leading word before
     * taking the eight that do.
     */
    function shortId(id) {
      const body = /^[a-z]+[-_]/i.test(id) ? id.slice(id.search(/[-_]/) + 1) : id
      return body.length > 10 ? body.slice(0, 8) : body
    }

    /**
     * One more stat in the row under the composer, beside the host's own turn
     * and token readings: this session's id, with the upstream conversation its
     * last Trae turn ran in and Trae's own support line behind the tooltip.
     * Clicking copies the session id, Alt-clicking the upstream one,
     * Shift-clicking the support line. The upstream id is derived per model
     * variant and thinking level (wire.ts `conversationUuid`), so it is not the
     * session id and cannot be guessed from it.
     *
     * Only while the session's model is a Trae one, like the quota chip.
     */
    function SessionIdChip(props) {
      const { t, sessionId } = props
      const selection = props.useTraeModel(snapshot => snapshot?.current ?? null)
      const active = selection?.provider === PROVIDER && typeof sessionId === 'string' && sessionId !== ''
      const [info, setInfo] = React.useState(null)
      const [copied, setCopied] = React.useState('')
      // A turn running or ending is when the upstream id appears or moves; the
      // host does not pass this hook to every slot, so its absence just means
      // the chip re-reads on mount, on a switch and on a click instead.
      const running = typeof props.useSession === 'function' ? props.useSession(s => s?.running) : undefined
      // The upstream conversation follows the picked model and level, so a
      // switch is a re-read as much as a finished turn is.
      const key = selectionKey(selection)
      const read = () => {
        if (!active) return undefined
        const abort = new AbortController()
        fetch(`${SESSION_ROUTE.slice(1)}?session=${encodeURIComponent(sessionId)}`, {
          headers: { accept: 'application/json' }, signal: abort.signal,
        })
          .then(response => response.ok ? response.json() : null)
          .then((body) => { if (!abort.signal.aborted) setInfo(body?.ok ? body.value : null) })
          .catch(() => {})
        return () => { abort.abort() }
      }
      React.useEffect(() => read(), [active, sessionId, key, running])
      React.useEffect(() => {
        if (!copied) return undefined
        const timer = setTimeout(() => { setCopied('') }, COPIED_MS)
        return () => { clearTimeout(timer) }
      }, [copied])
      if (!active) return null
      const upstream = info?.conversation ?? ''
      // The whole line Trae's own client copies for support, built host-side
      // from what this turn really has (src/trae/debug.ts).
      const support = info?.debug ?? ''
      const variant = info?.effort ? `${info.model} · ${info.effort}` : info?.model ?? ''
      const details = [t('sessionIdLine').replace('{id}', sessionId)]
      details.push(upstream
        ? t('sessionUpstreamLine').replace('{id}', upstream).replace('{model}', variant)
        : t('sessionUpstreamNone'))
      if (support) details.push(t('sessionDebugLine').replace('{id}', support))
      details.push(copied === 'failed' ? t('sessionCopyFailed') : t('sessionCopyHint'))
      // Shift copies the support line, Alt the upstream id — the one an
      // upstream complaint is about — and either falls back to the session id
      // while no turn has produced them.
      const copy = (event) => {
        const wanted = event.shiftKey && support ? support
          : event.altKey && upstream ? upstream
            : sessionId
        // The upstream id is read per turn, so a stale chip copies a stale id:
        // ask again while the write runs, not after it.
        read()
        void copyText(wanted).then((ok) => { setCopied(ok ? 'ok' : 'failed') })
      }
      // Built like the host's own stat controls (`data-composer-stat`, icon
      // then label), so it sits in that row as one of them rather than as a
      // visitor.
      return h('span', { className: 'trae-stat', 'data-composer-stat': 'trae-session' },
        h(P.Tooltip, { label: h('div', { style: { whiteSpace: 'pre-line' } }, details.join('\n')), side: 'top' },
          h('button', {
            type: 'button',
            className: 'trae-stat-pill',
            onClick: copy,
            'aria-label': t('sessionChipLabel').replace('{id}', sessionId),
          },
          icon(ICON_ID, 14),
          h('span', { className: 'trae-stat-label' },
            copied === 'ok' ? t('sessionCopied') : t('sessionChip').replace('{id}', shortId(sessionId))),
          ),
        ),
      )
    }

    /**
     * Card and stat-pill styles, injected once. Colours, radii and the
     * elevation come from the host's design tokens — the same ones its own
     * question dialog and its own composer stats use — so both follow the
     * theme, light or dark. The card column is sized like the host's dock
     * panels (todo, queue) so everything lines up.
     */
    const CHOICES_CSS = `
.trae-stat{min-width:0;display:inline-flex;font-size:calc(var(--dsh-content-font-size-secondary, 13px) - 1px);line-height:calc(20px + var(--dsh-content-font-delta-secondary, 0px))}
.trae-stat-pill{box-sizing:border-box;max-width:100%;padding:1px 8px;border:none;border-radius:var(--dsw-radius-sm,6px);background:0 0;color:var(--dsw-alias-label-tertiary);font:inherit;font-variant-numeric:tabular-nums;line-height:inherit;white-space:nowrap;cursor:pointer;display:inline-flex;align-items:center;gap:6px}
.trae-stat-pill svg{flex:none;width:14px;height:14px}
.trae-stat-pill:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
.trae-stat-pill:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.trae-stat-label{min-width:0;overflow:hidden;text-overflow:ellipsis}
.trae-choices{box-sizing:border-box;width:calc(100% - 2 * var(--dsh-composer-side-clearance, 0px) - 4 * var(--dsh-composer-dock-inset, 0px));max-width:calc(var(--dsh-composer-card-max-width, 100%) - 4 * var(--dsh-composer-dock-inset, 0px));margin:0 auto;flex:none;display:flex;flex-direction:column;gap:8px}
.trae-choice{--dsw-elevation-stroke-color:var(--dsw-alias-border-l2-darkmode-thin);border-radius:var(--dsw-radius-xl,16px);background:var(--dsw-specific-input-major,var(--dsw-specific-menu));box-shadow:var(--dsw-elevation-panel);color:var(--dsw-alias-label-primary);padding:12px 12px 14px 16px;display:flex;flex-direction:column;gap:10px;animation:trae-choice-in .18s ease-out}
.trae-choice *{box-sizing:border-box}
.trae-choice-head{display:flex;align-items:flex-start;gap:12px}
.trae-choice-heading{flex:1;min-width:0}
.trae-choice-eyebrow{display:flex;align-items:center;gap:4px;margin-bottom:2px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
.trae-choice-question{margin:0;font-size:14px;font-weight:500;line-height:22px;overflow-wrap:anywhere}
.trae-choice-tag{margin-left:2px;padding:0 6px;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);font-size:10px;line-height:15px}
.trae-choice-foot{display:flex;align-items:center;flex-wrap:wrap;gap:4px 8px;padding:0 4px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
.trae-choice-who{flex:none;height:20px;padding:0 8px 0 6px;border:.5px solid var(--dsw-alias-border-l4);border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;line-height:16px;cursor:pointer;display:inline-flex;align-items:center;gap:4px}
.trae-choice-who:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.trae-choice-who[aria-pressed="true"]{border-color:transparent;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.trae-choice-who:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.trae-choice-note{min-width:0;flex:1}
.trae-choice-close{flex:none;width:24px;height:24px;margin:-2px -2px 0 0;padding:0;border:none;border-radius:999px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;display:grid;place-items:center}
.trae-choice-close:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.trae-choice-actions{display:flex;flex-wrap:wrap;gap:8px}
.trae-choice-btn{height:30px;max-width:100%;padding:0 12px;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md,8px);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;transition:background-color .12s,border-color .12s,color .12s}
.trae-choice-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.trae-choice-btn[data-primary]{border-color:transparent;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}
.trae-choice-btn[data-primary]:hover{background:var(--dsw-alias-button-primary-hover)}
.trae-choice-btn[data-other]{border:1px dashed var(--dsw-alias-border-l4);color:var(--dsw-alias-label-secondary)}
.trae-choice-btn[data-other][aria-expanded="true"]{border-style:solid;border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.trae-choice-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.trae-choice-btn:focus-visible,.trae-choice-close:focus-visible,.trae-choice-send:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.trae-choice-other{display:flex;align-items:flex-end;gap:8px;padding:5px 5px 5px 12px;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-lg,12px);background:var(--dsw-alias-bg-module-platform);transition:border-color .12s}
.trae-choice-other:focus-within{border-color:var(--dsw-alias-state-business-primary)}
.trae-choice-input{flex:1;min-width:0;max-height:120px;padding:3px 0;resize:none;border:none;outline:none;background:transparent;color:var(--dsw-alias-label-primary);caret-color:var(--dsw-alias-state-business-primary);font:inherit;font-size:14px;line-height:22px}
.trae-choice-input::placeholder{color:var(--dsw-alias-label-caption,var(--dsw-alias-label-tertiary))}
.trae-choice-send{flex:none;width:28px;height:28px;padding:0;border:none;border-radius:999px;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);cursor:pointer;display:grid;place-items:center}
.trae-choice-send:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}
.trae-choice-send:disabled{opacity:.35;cursor:default}
@keyframes trae-choice-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.trae-choice{animation:none}.trae-choice-btn,.trae-choice-other{transition:none}}
`

    /** A 16×16 line icon (or a filled one) in the current text colour. */
    function icon(d, size = 14, filled = false) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 16 16', 'aria-hidden': true,
        fill: filled ? 'currentColor' : 'none', stroke: filled ? 'none' : 'currentColor',
        strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round',
      }, h('path', { d }))
    }
    const ICON_SPARK = 'M8 1.5 9.4 6.6 14.5 8 9.4 9.4 8 14.5 6.6 9.4 1.5 8 6.6 6.6Z'
    const ICON_CLOSE = 'M4.5 4.5l7 7M11.5 4.5l-7 7'
    const ICON_PEN = 'M10.5 3l2.5 2.5L6 12.5H3.5V10z'
    const ICON_SEND = 'M8 12.5v-9M4 7.5l4-4 4 4'
    /** A line branching off: the task going to a child session. */
    const ICON_BRANCH = 'M5 2.5v6a3 3 0 0 0 3 3h3M11 9l2 2.5-2 2.5'
    /** A name tag: the session's own id. */
    const ICON_ID = 'M2 4.5h12v7H2zM4.5 7.5h2M4.5 9.5h4M9.5 7.5h2'

    /** Grow a textarea with its text, up to the stylesheet's max-height. */
    function fitHeight(element) {
      element.style.height = 'auto'
      element.style.height = `${element.scrollHeight}px`
    }

    /**
     * Next-step cards above the composer, beside the host's todo and queue
     * docks: one card per decision the last Trae answer left open, each with
     * the model's own answers as buttons (its recommendation first, filled).
     * A button sends its reply as the user's next message; "something else"
     * opens a box on the card to write one's own; × closes that card without
     * sending anything. The cards step aside while the user types in the
     * composer, and go once a turn runs.
     *
     * With the host's `suggestSubagent` on, what a button sends is that reply
     * wrapped in "delegate this to a subagent": the one line under the cards
     * says so, and switches the round back to this session when the user would
     * rather watch it happen here.
     */
    function SuggestionCards(props) {
      const { t, sessionId, inputActions } = props
      const running = props.useSession(s => s.running) ?? false
      const draft = props.useInput(s => s.draft ?? '')
      const phase = props.useInput(s => s.phase)
      const choices = props.useTraeChoices(s => s)
      // The card whose "something else" box is open, and what is typed in it.
      const [other, setOther] = React.useState(null)
      // Who does the task: the host's answer for this round until it is switched.
      const [delegate, setDelegate] = React.useState(null)

      // Ask once a turn ends (waiting while the host still works it out), and
      // once on mount so switching back to a session shows what it had.
      const wasRunning = React.useRef(running)
      React.useEffect(() => {
        const ended = wasRunning.current && !running
        wasRunning.current = running
        if (running) { props.clear(); return undefined }
        return props.load(ended ? SUGGESTION_WAIT_MS : 0)
      }, [running, sessionId])

      // A new round of cards starts with every box closed and the host's own
      // answer for who does the work.
      React.useEffect(() => { setOther(null); setDelegate(null) }, [choices.id])

      const open = choices.cards
        .map((card, index) => ({ card, index }))
        .filter(({ index }) => !choices.dismissed.includes(index))
      const visible = open.length > 0 && !running && draft === '' && (phase === undefined || phase === 'plain')

      // Tell the host they were actually on screen; it counts each suggestion once.
      React.useEffect(() => {
        if (visible) reportSuggestion(sessionId, choices.id, 'shown')
      }, [visible, choices.id])

      if (!visible) return null
      const toSubagent = delegate ?? choices.subagent === true
      // The editor applies a draft as one discrete update, so submit already reads it.
      // A delegated task travels as the message asking for it: the host has no
      // way to start a child of its own for an idle session.
      const send = (text) => {
        inputActions.setDraft(toSubagent ? t('choicesSubagentTask').replace('{task}', text) : text)
        inputActions.submit()
      }
      const pick = (card, choice) => {
        const picked = props.take(card, choice)
        if (!picked) return
        reportSuggestion(sessionId, choices.id, 'accept', { card, choice })
        send(picked.reply)
      }
      // The user's own words are not one of the suggestions, so Cue hears nothing of them.
      const sendOther = () => {
        const text = other?.text.trim()
        if (!text) return
        props.close()
        setOther(null)
        send(text)
      }
      const onOtherKey = (event) => {
        if (event.nativeEvent?.isComposing || event.keyCode === 229) return
        if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendOther() }
        else if (event.key === 'Escape') { event.preventDefault(); setOther(null) }
      }

      return h('div', { className: 'trae-choices', 'data-trae-choices': '' },
        open.map(({ card, index }, position) => {
          const editing = other?.card === index
          return h('div', { key: `${choices.id}:${index}`, className: 'trae-choice' },
            h('div', { className: 'trae-choice-head' },
              h('div', { className: 'trae-choice-heading' },
                h('div', { className: 'trae-choice-eyebrow' },
                  icon(ICON_SPARK, 12, true),
                  open.length > 1 ? `${t('choicesEyebrow')} · ${position + 1}/${open.length}` : t('choicesEyebrow'),
                  toSubagent ? h('span', { className: 'trae-choice-tag' }, t('choicesSubagentOn')) : null,
                ),
                card.question ? h('p', { className: 'trae-choice-question' }, card.question) : null,
              ),
              h('button', {
                type: 'button', className: 'trae-choice-close',
                'aria-label': t('choicesDismiss'), title: t('choicesDismiss'),
                onClick: () => { props.dismiss(index) },
              }, icon(ICON_CLOSE)),
            ),
            h('div', { className: 'trae-choice-actions' },
              ...card.choices.map((choice, at) => h('button', {
                key: at, type: 'button', className: 'trae-choice-btn',
                'data-primary': at === 0 ? '' : undefined,
                title: choice.reply,
                onClick: () => { pick(index, at) },
              }, h('span', { className: 'trae-choice-label' }, choice.label))),
              h('button', {
                key: 'other', type: 'button', className: 'trae-choice-btn',
                'data-other': '', 'aria-expanded': editing,
                onClick: () => { setOther(editing ? null : { card: index, text: '' }) },
              }, icon(ICON_PEN, 13), h('span', { className: 'trae-choice-label' }, t('choicesOther'))),
            ),
            editing
              ? h('div', { className: 'trae-choice-other' },
                h('textarea', {
                  className: 'trae-choice-input', rows: 1, autoFocus: true,
                  placeholder: t('choicesOtherPlaceholder'), 'aria-label': t('choicesOther'),
                  value: other.text,
                  onChange: (event) => {
                    fitHeight(event.target)
                    setOther({ card: index, text: event.target.value })
                  },
                  onKeyDown: onOtherKey,
                }),
                h('button', {
                  type: 'button', className: 'trae-choice-send',
                  disabled: !other.text.trim(),
                  'aria-label': t('choicesSend'), title: t('choicesSend'),
                  onClick: sendOther,
                }, icon(ICON_SEND)),
              )
              : null,
          )
        }),
        // One line for the whole round: who does what a button sends, and the
        // switch to the other one.
        h('div', { className: 'trae-choice-foot', 'data-subagent': toSubagent ? '' : undefined },
          h('button', {
            type: 'button', className: 'trae-choice-who',
            'aria-pressed': toSubagent, title: t('choicesSubagentToggle'),
            onClick: () => { setDelegate(!toSubagent) },
          }, icon(ICON_BRANCH, 12), h('span', null, t(toSubagent ? 'choicesSubagentOn' : 'choicesSubagentOff'))),
          h('span', { className: 'trae-choice-note' }, t(toSubagent ? 'choicesSubagentHint' : 'choicesInlineHint')),
        ),
      )
    }

    /**
     * The enterprise console login. Once it is saved and the quota is actually
     * coming back, this is settled business: it folds away to one line, and
     * opens again on demand (or on its own when something is missing or a
     * write failed).
     */
    function ConsoleAccount(props) {
      const { t, state } = props
      const settled = props.working && state.emailConfigured && state.consoleConfigured && !state.credentialError
      const [open, setOpen] = React.useState(!settled)
      // Collapse the moment it starts working; reopen if it stops.
      React.useEffect(() => { setOpen(!settled) }, [settled])
      const muted = { color: 'var(--dsw-alias-label-secondary)', fontSize: 'var(--dsw-font-xs-13, 13px)' }
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: open ? 12 : 4, marginTop: 4 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          h('span', { style: { fontWeight: 600 } }, t('console')),
          settled ? h(P.Tag, { tone: 'neutral' }, t('consoleSet')) : null,
          h('span', { style: { flex: 1 } }),
          settled
            ? h(P.Button, {
              variant: 'ghost', size: 'sm', type: 'button',
              onClick: () => { setOpen(!open) },
            }, open ? t('consoleCollapse') : t('consoleEdit'))
            : null,
        ),
        !open
          ? h('p', { style: { ...muted, margin: 0 } }, t('consoleSettled'))
          : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
            h(P.SettingsValueField, {
              id: 'dsh-trae2api-console-email',
              label: t('consoleEmail'),
              hint: t('consoleHint'),
              // Write-only like the password, so it reads back blank: say so in
              // the placeholder instead of looking like it was not saved.
              placeholder: state.emailConfigured ? t('consoleSet') : 'you@example.com',
              disabled: !state.emailWritable,
              text: state.email.text,
              onEdit: (text) => { props.edit(EMAIL_FIELD, text) },
            }),
            h(P.SettingsSecretField, {
              id: 'dsh-trae2api-console-password',
              label: t('consolePassword'),
              disabled: !state.consoleWritable,
              text: state.consolePassword.text,
              configured: state.consoleConfigured,
              stateLabel: state.consoleConfigured ? t('consoleSet') : t('consoleUnset'),
              onEdit: (text) => { props.edit(CONSOLE_PASSWORD_FIELD, text) },
            }),
            state.credentialError
              ? h('p', {
                style: {
                  margin: 0, fontSize: 'var(--dsw-font-xs-13, 13px)', whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word', color: 'var(--dsw-alias-state-error-primary)',
                },
              }, `${t('consoleSaveFailed')}${state.credentialError}`)
              : null,
          ),
      )
    }

    function TraeCard(props) {
      const { t } = props
      const state = props.useTraeCard(snapshot => snapshot)
      const quota = props.useTraeQuota(snapshot => snapshot)
      // Credentials are set-and-forget: once they are in, the card folds down to
      // one status line. The row's own "edit" button opens it (props.editorOpen);
      // the line's own button overrides that either way, for the case where the
      // page's structure moved and that signal never arrives.
      const [override, setOverride] = React.useState(undefined)
      const lastEditorOpen = React.useRef(props.editorOpen)
      React.useEffect(() => {
        if (lastEditorOpen.current === props.editorOpen) return
        lastEditorOpen.current = props.editorOpen
        setOverride(undefined)
      }, [props.editorOpen])
      // An enterprise seat is not set up until its console account is in, so it
      // stays open until then — folding away the fields it still needs would
      // hide the only thing left to do.
      const needsConsole = quota.value?.seat === 'enterprise'
        && !(state.emailConfigured && state.consoleConfigured)
      const settled = state.tokenConfigured && !state.credentialError && !needsConsole
      const open = !settled || (override ?? props.editorOpen === true)
      // Folded, neither the status block nor the quota block is mounted to ask
      // for its own data, and the one line shows both: ask here.
      React.useEffect(() => {
        if (state.status.phase === 'idle') props.checkStatus()
        props.refreshQuota(false)
      }, [])
      const headerSlot = useRowHeaderSlot(props.hostRef, !open && props.view !== 'summary')
      if (props.view === 'summary') return t('description')
      // Folded away, the whole card is one line: is it working, and how much is
      // left. The line itself opens the editor, the way the row's own "edit"
      // button does — one affordance, not two.
      if (!open) {
        const percent = remainingPercent(quota.value)
        const parts = []
        if (state.status.phase === 'ready') parts.push(t('collapsedReady').replace('{n}', String(state.status.models.length)))
        else if (state.status.phase === 'error' || state.status.phase === 'empty') parts.push(t('failed'))
        else parts.push(t('checking'))
        if (percent !== null) parts.push(t('collapsedQuota').replace('{percent}', formatPercent(percent)))
        else if (quota.value?.limit === null && (quota.value?.packs.length ?? 0) > 0) parts.push(t('quotaUnlimited'))
        const dotState = state.status.phase === 'ready' ? (percent !== null && percent < 15 ? 'warning' : 'done')
          : state.status.phase === 'checking' || state.status.phase === 'idle' ? 'ongoing' : 'error'
        const line = h('div', {
          role: 'button',
          tabIndex: 0,
          'aria-expanded': false,
          title: t('credentialsEdit'),
          onClick: () => { setOverride(true) },
          onKeyDown: (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            setOverride(true)
          },
          style: {
            display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
            fontSize: 'var(--dsw-font-xs-13, 13px)', color: 'var(--dsw-alias-label-secondary)',
            ...headerSlot ? {} : { marginTop: 4 },
          },
        },
        h(P.StateDot, { state: dotState }),
        h('span', { style: { fontVariantNumeric: 'tabular-nums' } }, parts.join(' · ')),
        )
        // On the row's own header line when the page lets us, in the card body
        // otherwise.
        return headerSlot ? createPortal(line, headerSlot) : line
      }
      // Open: one inset panel in the shape of the page's own provider editor —
      // title, fields, then cancel/save at the bottom right. SettingsForm is not
      // used here because its footer sits on the left, out of step with the rest
      // of the page; the save it would run is this card's own `props.save`.
      const blocked = !state.dirty || state.invalid || state.saving
      return h('div', {
        style: {
          display: 'flex', flexDirection: 'column', gap: 16, marginTop: 8,
          padding: 16, borderRadius: 'var(--dsw-radius-md, 10px)',
          background: 'var(--dsw-alias-bg-layer-1)',
        },
      },
      h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8 } },
        h('span', { style: { fontWeight: 600 } }, t('title')),
        h('span', {
          style: { color: 'var(--dsw-alias-label-secondary)', fontSize: 'var(--dsw-font-xs-13, 13px)' },
        }, PROVIDER),
      ),
      !state.available
        ? h('p', { style: { margin: 0, color: 'var(--dsw-alias-label-secondary)' } }, t('unavailable'))
        : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 16 } },
          !state.writable
            ? h('p', {
              style: { margin: 0, color: 'var(--dsw-alias-label-secondary)', fontSize: 'var(--dsw-font-xs-13, 13px)' },
            }, t('readOnly'))
            : null,
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
          // Only a ToB seat needs these: a consumer account's quota comes off
          // the IDE API, and the console login would be meaningless for it.
          quota.value?.seat === 'enterprise'
            ? h(ConsoleAccount, { t, state, edit: props.edit, working: (quota.value?.packs.length ?? 0) > 0 })
            : null,
          h(StatusBlock, { t, status: state.status, checkStatus: props.checkStatus }),
          h(QuotaBlock, { t, quota, refresh: props.refreshQuota }),
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' } },
            state.failed
              ? h('p', {
                style: { margin: 0, flex: 1, color: 'var(--dsw-alias-state-error-primary)', fontSize: 'var(--dsw-font-xs-13, 13px)' },
              }, t('saveFailed'))
              : null,
            h(P.Button, {
              variant: 'outline',
              size: 'md',
              type: 'button',
              onClick: () => { props.discard(); if (settled) setOverride(false) },
            }, t('cancel')),
            h(P.Button, {
              variant: 'primary',
              size: 'md',
              type: 'button',
              disabled: blocked,
              onClick: () => { props.save() },
            }, state.saving ? t('saving') : t('save')),
          ),
        ),
      )
    }

    /**
     * The Models page renders its generic editor beside this slot while the
     * row's own "edit" button is on; for a namespace it does not know, that
     * editor is nothing but a title, a "edit cordis.patch.yml" hint and a
     * disabled Save — a broken-looking second form next to this card's real
     * one. Hide the whole thing, and report whether it was there at all: that
     * is the only signal this slot gets for "the row is being edited", since
     * the page passes it no such prop.
     *
     * Guarded: if the page's structure ever differs, nothing is touched and the
     * card falls back to its own disclosure.
     */
    function useGenericEditorChrome(ref) {
      const [open, setOpen] = React.useState(false)
      React.useLayoutEffect(() => {
        const hidden = []
        let node = ref.current
        for (let depth = 0; node && hidden.length === 0 && depth < 6; depth++, node = node.parentElement) {
          // The editor sits before this slot on the setup card and after it on
          // a normal row, so look both ways.
          for (const editor of [node.previousElementSibling, node.nextElementSibling]) {
            if (!editor || editor.contains(ref.current)) continue
            const ours = Array.from(editor.querySelectorAll('p'))
              .some(p => (p.textContent || '').trim().endsWith(`(${SETTINGS_NS})`))
            if (!ours) continue
            hidden.push([editor, editor.style.display])
            editor.style.display = 'none'
          }
        }
        // Same value is a no-op in React, so this cannot loop.
        setOpen(hidden.length > 0)
        return () => { for (const [el, display] of hidden) el.style.display = display }
      })
      return open
    }

    /**
     * The row's own header — the strip with the provider name and its buttons —
     * so the collapsed status line can sit on that line instead of starting a
     * second one. Recognised structurally (the row's first child, which holds
     * buttons and does not contain this card), so a page that looks different
     * simply yields nothing.
     */
    function findRowHeader(el) {
      for (let node = el, depth = 0; node && depth < 6; depth++, node = node.parentElement) {
        const head = node.parentElement?.firstElementChild
        if (!head || head === node || head.contains(el)) continue
        if (!head.querySelector('button')) continue
        return head
      }
      return undefined
    }

    /**
     * A span parked in the row header to portal into, while `enabled`.
     *
     * Checked on every render rather than once: on the first mount this effect
     * runs before the owner's ref is attached (a child's layout effect is
     * processed before its parent's ref), so the header is not reachable yet,
     * and the page may also re-render the row out from under the span.
     */
    function useRowHeaderSlot(ref, enabled) {
      const [slot, setSlot] = React.useState(null)
      const parked = React.useRef(null)
      const detach = () => {
        if (!parked.current) return
        parked.current.remove()
        parked.current = null
        setSlot(null)
      }
      React.useLayoutEffect(() => {
        if (!enabled || !createPortal) { detach(); return }
        if (parked.current?.isConnected) return
        const header = ref?.current ? findRowHeader(ref.current) : undefined
        if (!header) return
        const host = document.createElement('span')
        host.style.cssText = 'display:flex;align-items:center;gap:8px;margin-right:auto'
        // After the name, before the row's buttons.
        header.insertBefore(host, header.firstElementChild?.nextElementSibling ?? null)
        parked.current = host
        setSlot(host)
      })
      React.useEffect(() => () => { detach() }, [])
      return slot
    }

    /** The Models page passes provider-card owner props instead of a view; always render the full card. */
    function ProviderCardExtras(props) {
      const ref = React.useRef(null)
      const editorOpen = useGenericEditorChrome(ref)
      // `display: contents` so this wrapper generates no box of its own: folded
      // away, the card renders nothing in place (its one line lives in the row
      // header), and an empty flex item would still take the row's gap and
      // leave this row taller than the others.
      return h('div', { ref, style: { display: 'contents' } },
        h(TraeCard, { ...props, view: 'page', editorOpen, hostRef: ref }))
    }

    return {
      inject: ['slots', 'locale', 'remote', 'remote.credentials', 'remote.session', 'configForms'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-trae2api: dictionaries')
        const quota = new QuotaController()
        const card = new TraeCardController(ctx.configForms.get(SETTINGS_NS), ctx, quota)
        ctx.effect(() => () => { card.dispose() }, 'dsh-trae2api: form')
        // The chip needs each session's model selection; without the model
        // picker's service there is nothing to sit beside, so no chip.
        const noModel = createStore({ current: null })
        ctx.inject(['slots', 'modelDirectories'], (scope) => {
          /** The session's model selection, or an empty one until it is bound. */
          const directoryFor = (sessionId) => {
            try { return scope.modelDirectories.directoryFor(sessionId).store } catch { return noModel }
          }
          scope.slots.inject('conversation.input.right', () => scope.slots.register({
            name: 'conversation.input.right',
            // A list slot: every entry needs its own id, or the registry throws.
            id: 'trae-quota',
            locale: NS,
            inject: sessionId => ({
              hooks: { traeModel: directoryFor(sessionId), traeQuota: quota.store },
              refresh: (force) => { void quota.load(force) },
            }),
          }, QuotaChip))
          // This session's id, for a bug report or a log search. It belongs in
          // the stats row under the composer, where the host keeps its own
          // readings, rather than in the composer bar itself: it is read once
          // in a while, not watched every turn. After the host's `activity`
          // (0) and `usage` (1) entries.
          scope.slots.inject('conversation.composer.dock', () => scope.slots.register({
            name: 'conversation.composer.dock',
            id: 'trae-session',
            order: 2,
            locale: NS,
            // `sessionId` is passed through rather than read off props: the
            // chip is nothing without it, and this is the one place the slot
            // registry is certain to have it.
            inject: sessionId => ({ sessionId, hooks: { traeModel: directoryFor(sessionId) } }),
          }, SessionIdChip))
          // Its own entry rather than part of the chip: the chip is absent on an
          // unlimited or unreadable quota, and the switch still needs saying.
          scope.slots.inject('conversation.input.right', () => scope.slots.register({
            name: 'conversation.input.right',
            id: 'trae-switch',
            // Before the quota chip, where the picker it talks about sits.
            order: -10,
            locale: NS,
            inject: sessionId => ({ hooks: { traeModel: directoryFor(sessionId) } }),
          }, SwitchNotice))
        })
        // Next-step cards above the composer, one per decision the answer left open.
        ctx.effect(() => {
          const style = document.createElement('style')
          style.dataset.plugin = PACKAGE
          style.textContent = CHOICES_CSS
          document.head.appendChild(style)
          return () => { style.remove() }
        }, 'dsh-trae2api: next-step card styles')
        const choices = new SuggestionController()
        ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
          name: 'conversation.input.dock',
          // After the host's todo (0) and queue (20) docks, right above the input.
          id: 'trae-choices',
          order: 30,
          locale: NS,
          inject: sessionId => ({
            hooks: { traeChoices: choices.storeFor(sessionId) },
            load: waitMs => choices.load(sessionId, waitMs),
            clear: () => { choices.clear(sessionId) },
            dismiss: (card) => { choices.dismiss(sessionId, card) },
            close: () => { choices.close(sessionId) },
            take: (card, choice) => choices.take(sessionId, card, choice),
          }),
        }, SuggestionCards))
        ctx.effect(
          () => ctx.remote.$on('credentials/reference-updated', (ref) => { card.refreshCredential(ref) }),
          'dsh-trae2api: credential updates',
        )
        ctx.effect(
          () => ctx.remote.$on('llm/adapters-updated', () => {
            void card.checkStatus()
            if (quota.store.getSnapshot().phase !== 'idle') void quota.load(true)
          }),
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
