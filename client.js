// dsh-network-proxy — web client half.
// Upstream source: https://github.com/kriskite/dsh-network-proxy
// Pinned upstream commit: 4cc265a2115cffdcfbf4f74257243b12a98ac9e0
//
// v2.0.1 — DSH 0.2.x client port.
//
// What 1.0.1 did here is gone: no `@deepseek-ai/dsh-client-runtime` import, no
// hand-rolled `ctx.remote.settings.describe()/mutate()` calls, no manual revision
// fencing, no inlined snapshot store. On 0.2.x the settings domain publishes one
// shared describe mirror and hands out a `ConfigForm` per Host plugin entry:
//
//   ctx.configForms.get(entryId) -> { getSnapshot, subscribe, set, unset, mutate }
//
// The form already carries the accepted values, the revision fence, the writable
// flag, write ordering, and the recovery read after a refused write.
//
// The row is registered as its own `settings.section` so it gets a first-class
// entry in the settings navigation, rather than hiding among the General items.
window.__ModuleLoader__.load({
  id: 'dsh-network-proxy',
  factory: (require) => {
    const module = { exports: {} }
    const React = require('react')
    const { useSyncExternalStore, useEffect, useState } = React

    const NS = 'settings.networkProxy'
    /** Host plugin entry id this section edits (the `id` in cordis.patch.yml). */
    const SETTINGS_ENTRY_ID = 'network-proxy'
    const MODES = ['system', 'manual', 'direct']

    const zh = {
      nav: '网络代理',
      title: '网络代理',
      description: '配置 DeepSeek Assistant 访问网络的方式，修改后立即生效',
      system: '跟随系统',
      manual: '手动代理',
      direct: '直连',
      placeholder: 'http://127.0.0.1:7890',
      apply: '应用',
      saving: '正在应用…',
      ready: '已生效',
      loading: '正在读取配置…',
      unavailable: '配置未就绪：宿主没有提供 network-proxy 这个配置项。请确认插件已随 profile 加载，然后重启。',
      readonly: '当前配置文档只读，无法在此修改。',
      invalidUrl: '代理地址需以 http:// 或 https:// 开头',
      rejected: '宿主拒绝了这次修改',
      systemHint: '读取操作系统代理设置（Windows 读注册表 Internet Settings）',
      manualHint: '所有请求都走下面这个 HTTP/HTTPS 代理',
      directHint: '忽略一切代理，直接连接',
    }
    const en = {
      nav: 'Network proxy',
      title: 'Network proxy',
      description: 'Configure how DeepSeek Assistant accesses the network; changes apply immediately',
      system: 'Follow system',
      manual: 'Manual proxy',
      direct: 'Direct',
      placeholder: 'http://127.0.0.1:7890',
      apply: 'Apply',
      saving: 'Applying…',
      ready: 'Active',
      loading: 'Reading configuration…',
      unavailable: 'Configuration is unavailable: the Host serves no network-proxy entry. Make sure the plugin is in the profile, then restart.',
      readonly: 'The settings document is read-only; it cannot be edited here.',
      invalidUrl: 'The proxy URL must start with http:// or https://',
      rejected: 'The Host refused the change',
      systemHint: 'Use the operating system proxy (Windows: registry Internet Settings)',
      manualHint: 'Send every request through this HTTP/HTTPS proxy',
      directHint: 'Ignore all proxies and connect directly',
    }

    const styles = `
      .dshNpSection{display:flex;flex-direction:column;gap:16px;max-width:760px;padding:4px 0 24px}
      .dshNpHeading{display:flex;flex-direction:column;gap:4px}
      .dshNpTitle{color:var(--dsw-alias-label-primary);font-size:16px;line-height:24px;font-weight:600}
      .dshNpDesc{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
      .dshNpCard{display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-2);overflow:hidden}
      .dshNpOption{display:flex;align-items:flex-start;gap:12px;padding:14px 16px;border:0;border-bottom:1px solid var(--dsw-alias-border-l2);background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;width:100%}
      .dshNpOption:last-child{border-bottom:0}
      .dshNpOption:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
      .dshNpOption:disabled{cursor:default;opacity:.6}
      .dshNpRadio{flex:none;box-sizing:border-box;width:16px;height:16px;margin-top:3px;border:1.5px solid var(--dsw-alias-border-l3);border-radius:50%;position:relative}
      .dshNpOption[data-active=true] .dshNpRadio{border-color:var(--dsw-alias-interactive-bg-primary)}
      .dshNpOption[data-active=true] .dshNpRadio::after{content:"";position:absolute;inset:3px;border-radius:50%;background:var(--dsw-alias-interactive-bg-primary)}
      .dshNpOptionText{display:flex;flex-direction:column;gap:2px;min-width:0}
      .dshNpOptionLabel{color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}
      .dshNpOptionHint{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
      .dshNpManual{display:flex;flex-direction:column;gap:8px;padding:14px 16px;background:var(--dsw-alias-bg-module-platform);border-top:1px solid var(--dsw-alias-border-l2)}
      .dshNpManualRow{display:flex;gap:8px;align-items:center}
      .dshNpInput{box-sizing:border-box;flex:1;min-width:0;height:34px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-input);color:var(--dsw-alias-label-primary);padding:0 10px;font:inherit;font-size:13px;outline:none}
      .dshNpInput:focus{border-color:var(--dsw-alias-border-primary)}
      .dshNpInput[aria-invalid=true]{border-color:var(--dsw-alias-state-error-primary)}
      .dshNpApply{flex:none;height:34px;border:0;border-radius:8px;padding:0 14px;background:var(--dsw-alias-interactive-bg-primary);color:var(--dsw-alias-label-on-primary);font:inherit;font-size:13px;cursor:pointer}
      .dshNpApply:disabled{cursor:default;opacity:.55}
      .dshNpStatus{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
      .dshNpStatus[data-tone=error]{color:var(--dsw-alias-state-error-primary)}
      .dshNpStatus[data-tone=ok]{color:var(--dsw-alias-state-success-primary)}
    `

    function ensureStyles() {
      if (typeof document === 'undefined') return
      if (document.querySelector('style[data-plugin-css="dsh-network-proxy"]')) return
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-network-proxy'
      tag.dataset.pluginCss = 'dsh-network-proxy'
      tag.textContent = styles
      document.head.appendChild(tag)
    }

    /** Client-side mirror of the two volatile fields the Host entry declares. */
    function readValue(snapshot) {
      const value = snapshot.value ?? {}
      return {
        mode: typeof value.mode === 'string' ? value.mode : 'system',
        url: typeof value.url === 'string' ? value.url : '',
      }
    }

    function NetworkProxySection({ form, t }) {
      const snapshot = useSyncExternalStore(
        (listener) => form.subscribe(listener),
        () => form.getSnapshot(),
        () => form.getSnapshot(),
      )
      const { mode, url: savedUrl } = readValue(snapshot)
      // Seeded from the snapshot so the first paint already shows the stored URL.
      const [draft, setDraft] = useState(savedUrl)
      const [error, setError] = useState(null)

      useEffect(() => { setDraft(savedUrl) }, [savedUrl])

      const pending = snapshot.status === 'loading' || snapshot.revision === undefined
      const disabled = pending || !snapshot.writable
      const trimmed = draft.trim()
      const invalid = trimmed !== '' && !/^https?:\/\/\S+$/i.test(trimmed)

      // Never silently disappear: an unavailable form is a real condition the
      // user needs to see, because it means the Host serves no such entry.
      if (snapshot.status === 'unavailable') {
        return React.createElement('div', { className: 'dshNpSection' },
          React.createElement('div', { className: 'dshNpHeading' },
            React.createElement('div', { className: 'dshNpTitle' }, t('title')),
          ),
          React.createElement('div', { className: 'dshNpStatus', 'data-tone': 'error', role: 'alert' }, t('unavailable')),
        )
      }

      const choose = async (next) => {
        if (next === mode || disabled) return
        setError(null)
        const accepted = await form.set('mode', next)
        if (!accepted) setError(t('rejected'))
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
        if (!accepted) setError(t('rejected'))
      }

      const statusText = error
        || (snapshot.status === 'loading' ? t('loading')
          : !snapshot.writable ? t('readonly')
            : t('ready'))
      const tone = error || !snapshot.writable ? 'error' : 'ok'

      return React.createElement('div', { className: 'dshNpSection' },
        React.createElement('div', { className: 'dshNpHeading' },
          React.createElement('div', { className: 'dshNpTitle' }, t('title')),
          React.createElement('div', { className: 'dshNpDesc' }, t('description')),
        ),
        React.createElement('div', { className: 'dshNpCard', role: 'radiogroup', 'aria-label': t('title') },
          MODES.map((candidate) => React.createElement('button', {
            key: candidate,
            type: 'button',
            role: 'radio',
            'aria-checked': mode === candidate,
            'data-active': mode === candidate,
            className: 'dshNpOption',
            disabled,
            onClick: () => { choose(candidate) },
          },
            React.createElement('span', { className: 'dshNpRadio' }),
            React.createElement('span', { className: 'dshNpOptionText' },
              React.createElement('span', { className: 'dshNpOptionLabel' }, t(candidate)),
              React.createElement('span', { className: 'dshNpOptionHint' }, t(`${candidate}Hint`)),
            ),
          )),
          mode === 'manual' && React.createElement('form', {
            className: 'dshNpManual',
            onSubmit: submit,
          },
            React.createElement('div', { className: 'dshNpManualRow' },
              React.createElement('input', {
                className: 'dshNpInput',
                type: 'url',
                value: draft,
                placeholder: t('placeholder'),
                disabled,
                pattern: 'https?://.*',
                'aria-label': t('manual'),
                'aria-invalid': invalid || undefined,
                onChange: (event) => { setDraft(event.target.value); setError(null) },
              }),
              React.createElement('button', {
                className: 'dshNpApply',
                type: 'submit',
                disabled: disabled || trimmed === '' || invalid || trimmed === savedUrl,
              }, t('apply')),
            ),
            invalid
              ? React.createElement('div', { className: 'dshNpStatus', 'data-tone': 'error', role: 'alert' }, t('invalidUrl'))
              : React.createElement('div', { className: 'dshNpStatus' }, t('ready')),
          ),
        ),
        React.createElement('div', { className: 'dshNpStatus', 'data-tone': tone, role: error ? 'alert' : undefined }, statusText),
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
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'network-proxy',
        order: 220,
        label: () => t('nav'),
        locale: NS,
        inject: () => ({ form }),
      }, NetworkProxySection))
    }

    module.exports.apply = apply
    module.exports.inject = inject
    return module.exports
  },
})