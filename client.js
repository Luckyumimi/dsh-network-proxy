// dsh-network-proxy — web client half.
// Upstream source: https://github.com/kriskite/dsh-network-proxy
// Pinned upstream commit: 4cc265a2115cffdcfbf4f74257243b12a98ac9e0
//
// v2.0.0 — DSH 0.2.2-rc.3 (`@deepseek-ai/dsh` 0.2.2-rc.3) port.
//
// What 1.0.1 did here is gone: no `@deepseek-ai/dsh-client-runtime` import, no
// hand-rolled `ctx.remote.settings.describe()/mutate()` calls, no manual
// revision fencing, no inlined snapshot store. On 0.2.x the settings domain
// publishes one shared describe mirror and hands out a `ConfigForm` per Host
// plugin entry:
//
//   ctx.configForms.get(entryId) -> { getSnapshot, subscribe, set, unset, mutate }
//
// The form already carries the accepted values, the revision fence, the
// writable flag, write ordering, and the recovery read after a refused write.
// This file therefore only draws the row and calls `form.set(...)`.
//
// The slot contract is unchanged: one row in `settings.general.item`.
window.__ModuleLoader__.load({
  id: 'dsh-network-proxy',
  factory: (require) => {
    const module = { exports: {} }
    const React = require('react')

    const NS = 'settings.networkProxy'
    /** Host plugin entry id this row edits (the id in cordis.patch.yml). */
    const SETTINGS_ENTRY_ID = 'network-proxy'
    const MODES = ['system', 'manual', 'direct']

    const styles = `
      .dshNetworkProxyRow{border-bottom:1px solid var(--dsw-alias-border-l2);display:flex;flex-direction:column;gap:14px;padding:16px 0}
      .dshNetworkProxyHeader{display:flex;align-items:flex-start;gap:24px}
      .dshNetworkProxyCopy{display:flex;flex:1;min-width:0;flex-direction:column;gap:4px}
      .dshNetworkProxyTitle{color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px}
      .dshNetworkProxyDesc,.dshNetworkProxyStatus{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
      .dshNetworkProxyStatus[data-error=true]{color:var(--dsw-alias-state-error-primary)}
      .dshNetworkProxyModes{display:grid;grid-template-columns:repeat(3,minmax(72px,1fr));flex:none;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:2px;background:var(--dsw-alias-bg-module-platform)}
      .dshNetworkProxyMode{height:30px;padding:0 10px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;cursor:pointer;white-space:nowrap}
      .dshNetworkProxyMode:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
      .dshNetworkProxyMode[data-active=true]{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);box-shadow:var(--dsw-shadow-lv1)}
      .dshNetworkProxyMode:disabled{cursor:default;opacity:.6}
      .dshNetworkProxyManual{display:flex;align-items:center;gap:8px;padding-left:0}
      .dshNetworkProxyInput{box-sizing:border-box;flex:1;min-width:0;height:36px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-input);color:var(--dsw-alias-label-primary);padding:0 11px;font:inherit;font-size:13px;outline:none}
      .dshNetworkProxyInput:focus{border-color:var(--dsw-alias-border-primary)}
      .dshNetworkProxyApply{height:36px;border:0;border-radius:8px;padding:0 14px;background:var(--dsw-alias-interactive-bg-primary);color:var(--dsw-alias-label-on-primary);font:inherit;font-size:13px;cursor:pointer}
      .dshNetworkProxyApply:disabled{cursor:default;opacity:.55}
      @media(max-width:680px){.dshNetworkProxyHeader{flex-direction:column;gap:12px}.dshNetworkProxyModes{width:100%}.dshNetworkProxyManual{align-items:stretch;flex-direction:column}.dshNetworkProxyApply{align-self:flex-end}}
    `

    function ensureStyles() {
      if (document.querySelector('style[data-plugin-css="dsh-network-proxy"]')) return
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-network-proxy'
      tag.dataset.pluginCss = 'dsh-network-proxy'
      tag.textContent = styles
      document.head.appendChild(tag)
    }

    const zh = {
      title: '网络代理',
      description: '配置 DeepSeek Assistant 访问网络的方式，修改后立即生效',
      system: '跟随系统',
      manual: '手动代理',
      direct: '直连',
      placeholder: 'http://127.0.0.1:7890',
      apply: '应用',
      saving: '正在应用...',
      ready: '已生效',
      unavailable: '网络代理设置不可用',
      invalidUrl: '代理地址需以 http:// 或 https:// 开头',
    }
    const en = {
      title: 'Network proxy',
      description: 'Configure how DeepSeek Assistant accesses the network; changes apply immediately',
      system: 'Follow system',
      manual: 'Manual proxy',
      direct: 'Direct',
      placeholder: 'http://127.0.0.1:7890',
      apply: 'Apply',
      saving: 'Applying...',
      ready: 'Active',
      unavailable: 'Network proxy settings are unavailable',
      invalidUrl: 'The proxy URL must start with http:// or https://',
    }

    /** Client-side mirror of the two volatile fields the Host entry declares. */
    function readValue(snapshot) {
      const value = snapshot.value ?? {}
      return {
        mode: typeof value.mode === 'string' ? value.mode : 'system',
        url: typeof value.url === 'string' ? value.url : '',
      }
    }

    function NetworkProxyRow({ form, t }) {
      const snapshot = React.useSyncExternalStore(
        (listener) => form.subscribe(listener),
        () => form.getSnapshot(),
        () => form.getSnapshot(),
      )
      const { mode, url: savedUrl } = readValue(snapshot)
      // Seeded from the snapshot so the first paint already shows the stored URL;
      // the effect below only re-adopts it when the Host answer changes.
      const [draft, setDraft] = React.useState(savedUrl)
      const [error, setError] = React.useState(null)

      React.useEffect(() => { setDraft(savedUrl) }, [savedUrl])

      // `unavailable` means this Host serves no such entry: the row is not ours
      // to render, and a dead control would be worse than nothing.
      if (snapshot.status === 'unavailable') return null

      const loading = snapshot.status === 'loading'
      const pending = loading || snapshot.revision === undefined
      const disabled = pending || !snapshot.writable
      const trimmed = draft.trim()
      const invalid = trimmed !== '' && !/^https?:\/\/\S+$/i.test(trimmed)
      const status = error || (loading ? t('saving') : snapshot.status === 'ready' ? t('ready') : '')

      const choose = async (next) => {
        if (next === mode || disabled) return
        setError(null)
        const accepted = await form.set('mode', next)
        if (!accepted) setError(t('unavailable'))
      }

      const submit = async (event) => {
        event.preventDefault()
        if (disabled || invalid || trimmed === '') return
        setError(null)
        // One mutation so mode and URL can never land in different revisions.
        const accepted = await form.mutate([
          { op: 'set', path: ['url'], value: trimmed },
          { op: 'set', path: ['mode'], value: 'manual' },
        ])
        if (!accepted) setError(t('unavailable'))
      }

      return React.createElement('div', { className: 'dshNetworkProxyRow' },
        React.createElement('div', { className: 'dshNetworkProxyHeader' },
          React.createElement('div', { className: 'dshNetworkProxyCopy' },
            React.createElement('div', { className: 'dshNetworkProxyTitle' }, t('title')),
            React.createElement('div', { className: 'dshNetworkProxyDesc' }, t('description')),
            status && React.createElement('div', {
              className: 'dshNetworkProxyStatus',
              'data-error': Boolean(error),
              role: error ? 'alert' : undefined,
            }, status),
          ),
          React.createElement('div', { className: 'dshNetworkProxyModes', role: 'radiogroup', 'aria-label': t('title') },
            MODES.map((candidate) => React.createElement('button', {
              key: candidate,
              type: 'button',
              role: 'radio',
              'aria-checked': mode === candidate,
              'data-active': mode === candidate,
              className: 'dshNetworkProxyMode',
              disabled,
              onClick: () => { choose(candidate) },
            }, t(candidate))),
          ),
        ),
        mode === 'manual' && React.createElement('form', {
          className: 'dshNetworkProxyManual',
          onSubmit: submit,
        },
          React.createElement('input', {
            className: 'dshNetworkProxyInput',
            type: 'url',
            value: draft,
            placeholder: t('placeholder'),
            disabled,
            required: true,
            pattern: 'https?://.*',
            'aria-label': t('manual'),
            'aria-invalid': invalid || undefined,
            onChange: (event) => { setDraft(event.target.value); setError(null) },
          }),
          React.createElement('button', {
            className: 'dshNetworkProxyApply',
            type: 'submit',
            disabled: disabled || trimmed === '' || invalid || trimmed === savedUrl,
          }, t('apply')),
        ),
        mode === 'manual' && invalid && React.createElement('div', {
          className: 'dshNetworkProxyStatus',
          'data-error': true,
          role: 'alert',
        }, t('invalidUrl')),
      )
    }

    const inject = ['slots', 'locale', 'configForms']

    function apply(ctx) {
      ensureStyles()
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'network-proxy: dictionaries')
      const t = ctx.locale.bind(NS)
      // One shared form for this Host entry; it owns write ordering, the revision
      // fence, and the recovery read after a refused write.
      const form = ctx.configForms.get(SETTINGS_ENTRY_ID)
      ctx.slots.inject('settings.general.item', () => ctx.slots.register({
        name: 'settings.general.item',
        id: 'network-proxy',
        order: -10,
        locale: NS,
        inject: () => ({ form }),
      }, NetworkProxyRow))
    }

    module.exports.apply = apply
    module.exports.inject = inject
    return module.exports
  },
})