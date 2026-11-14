// dsh-network-proxy — server half.
// Upstream source: https://github.com/kriskite/dsh-network-proxy
// Pinned upstream commit: 4cc265a2115cffdcfbf4f74257243b12a98ac9e0
//
// v2.0.0 — DSH 0.2.2-rc.3 (`@deepseek-ai/dsh` 0.2.2-rc.3) port.
//
// The 0.2.x settings model replaced the imperative seam this plugin was written
// against. `settingsNamespace()` and `ctx.settings.register(ns, schema,
// { applies: 'live' })` no longer exist in @deepseek-ai/dsh-settings, and
// neither does the returned scope's `watch()`. A plugin now declares its
// editable fields by exporting a schemastery `Config` whose leaves are marked
// `.volatile()`. Settings projects those leaves into a configuration form, the
// Loader applies a volatile-only change WITHOUT remounting the plugin, and the
// owning fiber receives `loader/volatile-update` with the changed paths so it
// can react in place. That is the mechanism used here: `Config` replaces the
// old registration, and the event listener replaces `scope.watch()`.
//
// Still load-bearing from 1.0.1: a dispatcher this plugin does not own is never
// closed. `@deepseek-ai/dsh-http-proxy` installs a boot-time proxy policy whose
// `proxyRouteFor()` may keep handing its dispatcher to the web-fetch tool even
// after another dispatcher is installed globally, so closing that one would
// break proxied fetch routes.
import { execFileSync } from 'node:child_process'
import z from '@deepseek-ai/schemastery'
import {
  Agent,
  EnvHttpProxyAgent,
  ProxyAgent,
  setGlobalDispatcher,
} from 'undici'

const PROXY_ENV_NAMES = [
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'all_proxy',
  'no_proxy',
]
const inheritedProxyEnvironment = Object.fromEntries(
  PROXY_ENV_NAMES.map((name) => [name, process.env[name]]),
)

/**
 * Live-editable proxy configuration.
 *
 * `mode` and `url` are `.volatile()` so the settings form shows them and a
 * change is committed into the running plugin instead of remounting it. Both
 * are read through `.get()`; never destructure the config object.
 */
export const Config = z.object({
  mode: z
    .union([
      z.const('system').description('Follow the operating system proxy'),
      z.const('manual').description('Use the proxy URL below'),
      z.const('direct').description('Connect directly, ignoring every proxy'),
    ])
    .default('system')
    .description('How DeepSeek Assistant reaches the network')
    .volatile(),
  url: z
    .string()
    .default('')
    .description('Manual proxy URL, for example http://127.0.0.1:7890')
    .volatile(),
})

/**
 * Reject a manual proxy URL that no undici agent could use.
 * @param value resolved configuration section.
 * @throws {Error} when manual mode carries a missing or non-HTTP(S) URL.
 */
function validateSettings(value) {
  if (value.mode !== 'manual') return
  let url
  try {
    url = new URL(value.url)
  } catch {
    throw new Error('Manual proxy must be a valid HTTP or HTTPS URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Manual proxy supports only HTTP and HTTPS URLs')
  }
}

function restoreInheritedProxyEnvironment() {
  for (const name of PROXY_ENV_NAMES) {
    const value = inheritedProxyEnvironment[name]
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
}

function setManualProxyEnvironment(url) {
  for (const name of PROXY_ENV_NAMES) delete process.env[name]
  process.env.HTTP_PROXY = url
  process.env.HTTPS_PROXY = url
  process.env.http_proxy = url
  process.env.https_proxy = url
  const noProxy = inheritedProxyEnvironment.NO_PROXY ?? inheritedProxyEnvironment.no_proxy
  if (noProxy !== undefined) {
    process.env.NO_PROXY = noProxy
    process.env.no_proxy = noProxy
  }
}

function clearProxyEnvironment() {
  for (const name of PROXY_ENV_NAMES) delete process.env[name]
}

function normalizeProxyUrl(value) {
  if (!value) return undefined
  return /^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `http://${value}`
}

function parseWindowsProxyServer(value) {
  const entries = String(value ?? '').split(';').map((entry) => entry.trim()).filter(Boolean)
  if (!entries.length) return {}
  const named = Object.fromEntries(entries.flatMap((entry) => {
    const separator = entry.indexOf('=')
    return separator < 0 ? [] : [[entry.slice(0, separator).toLowerCase(), entry.slice(separator + 1)]]
  }))
  const fallback = entries.find((entry) => !entry.includes('='))
  return {
    httpProxy: normalizeProxyUrl(named.http ?? fallback),
    httpsProxy: normalizeProxyUrl(named.https ?? named.http ?? fallback),
  }
}

function readWindowsSystemProxy() {
  const script = [
    "$p=Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';",
    '[pscustomobject]@{',
    'ProxyEnable=[int]$p.ProxyEnable;',
    'ProxyServer=[string]$p.ProxyServer;',
    'ProxyOverride=[string]$p.ProxyOverride;',
    'AutoConfigURL=[string]$p.AutoConfigURL',
    '}|ConvertTo-Json -Compress',
  ].join('')
  const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    windowsHide: true,
  })
  const config = JSON.parse(output)
  if (!config.ProxyEnable) {
    if (config.AutoConfigURL) throw new Error('Windows PAC proxy is not supported; use Manual proxy')
    return {}
  }
  const proxies = parseWindowsProxyServer(config.ProxyServer)
  if (!proxies.httpProxy && !proxies.httpsProxy) {
    throw new Error('Windows system proxy is enabled but no proxy server is configured')
  }
  return {
    ...proxies,
    noProxy: String(config.ProxyOverride ?? '')
      .split(';')
      .map((entry) => entry.trim())
      .filter((entry) => entry && entry !== '<local>')
      .join(','),
  }
}

function systemProxyOptions() {
  if (process.platform === 'win32') return readWindowsSystemProxy()
  return {
    httpProxy: inheritedProxyEnvironment.HTTP_PROXY ?? inheritedProxyEnvironment.http_proxy,
    httpsProxy: inheritedProxyEnvironment.HTTPS_PROXY ?? inheritedProxyEnvironment.https_proxy,
    noProxy: inheritedProxyEnvironment.NO_PROXY ?? inheritedProxyEnvironment.no_proxy,
  }
}

function dispatcherFor(value) {
  if (value.mode === 'direct') return new Agent()
  if (value.mode === 'manual') return new ProxyAgent(value.url)
  const options = systemProxyOptions()
  if (!options.httpProxy && !options.httpsProxy) return new Agent()
  return new EnvHttpProxyAgent(options)
}

function applyProxyEnvironment(value) {
  if (value.mode === 'system') restoreInheritedProxyEnvironment()
  else if (value.mode === 'manual') setManualProxyEnvironment(value.url)
  else clearProxyEnvironment()
}

function closeQuietly(dispatcher) {
  if (dispatcher === undefined || dispatcher === null) return
  try {
    const pending = dispatcher.close?.()
    // undici returns a promise; a rejection here is not actionable.
    if (pending && typeof pending.catch === 'function') pending.catch(() => {})
  } catch {
    // A dispatcher that already closed must not break a mode switch.
  }
}

/**
 * Mount the proxy controller.
 *
 * Reads the resolved volatile configuration once at activation, re-applies it on
 * every `loader/volatile-update`, and restores the inherited environment when
 * the plugin unloads.
 * @param ctx plugin context.
 * @param config resolved plugin configuration carrying volatile references.
 */
export function apply(ctx, config) {
  // This plugin owns its own settings row in the Web client, so the generic
  // schema-derived page must not be rendered beside it.
  ctx.inject(['settings'], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
  })

  /** Read the current section through the volatile references. */
  const readConfig = () => ({
    mode: config?.mode?.get?.() ?? 'system',
    url: config?.url?.get?.() ?? '',
  })

  /** The dispatcher this plugin installed, if any. Never the boot-time one. */
  let ownDispatcher

  const install = (value) => {
    applyProxyEnvironment(value)
    const nextDispatcher = dispatcherFor(value)
    setGlobalDispatcher(nextDispatcher)
    const previous = ownDispatcher
    ownDispatcher = nextDispatcher
    closeQuietly(previous)
  }

  const activate = () => {
    const value = readConfig()
    try {
      validateSettings(value)
      install(value)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      ctx.logger.warn(`network-proxy: ${message}`)
      // A rejected section must not leave the previous route armed: fall back to
      // following the system proxy instead.
      if (value.mode !== 'system') {
        try {
          install({ mode: 'system', url: '' })
        } catch (fallbackError) {
          const reason = fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
          ctx.logger.warn(`network-proxy: system proxy fallback failed: ${reason}`)
        }
      }
    }
  }

  activate()

  // A volatile-only config change keeps this plugin mounted and hands the owning
  // fiber the changed paths; the references already carry the new values.
  ctx.on('loader/volatile-update', (paths) => {
    if (!paths || paths.some((path) => path.length === 0 || path[0] === 'mode' || path[0] === 'url')) {
      activate()
    }
  })

  ctx.effect(() => () => {
    // Leaving the plugin unloaded with its proxy still installed would strand
    // every later fetch on a dispatcher nothing owns.
    restoreInheritedProxyEnvironment()
    closeQuietly(ownDispatcher)
    ownDispatcher = undefined
  }, 'network-proxy: teardown')
}

export default apply
export { parseWindowsProxyServer, readWindowsSystemProxy, validateSettings }