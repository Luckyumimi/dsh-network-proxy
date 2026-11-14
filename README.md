# dsh-network-proxy

Network proxy manager for [DeepSeek Assistant](https://github.com/deepseek-ai/deepseek-harness) (DSH).
Adds a settings row that switches DSH's outbound network between **follow system /
manual proxy / direct**, applied live.

> **v2.0.0 is the DSH 0.2.x port.** The 0.2.x settings model replaced the
> imperative seam this plugin was originally written against; `settingsNamespace()`
> and `ctx.settings.register()` no longer exist in `@deepseek-ai/dsh-settings`, so
> upstream 1.0.1 fails at import time on current releases. Every migration step is
> documented in [PATCHES.md](./PATCHES.md).

Fork of [kriskite/dsh-network-proxy](https://github.com/kriskite/dsh-network-proxy).

中文说明见 [README.zh.md](./README.zh.md)。

## Features

- **Three modes**
  - `system` — read the OS proxy (Windows: registry `Internet Settings`; elsewhere
    `HTTP(S)_PROXY` from the environment).
  - `manual` — one HTTP/HTTPS proxy URL, e.g. `http://127.0.0.1:7890`.
  - `direct` — clear the proxy environment and connect straight out.
- **Applies live without remounting the plugin.** The fields are declared
  `.volatile()`, so a change is committed into the running plugin; in-flight
  requests are not interrupted.
- **Covers `fetch` and undici.** Installs the global dispatcher from
  [`undici`](https://github.com/nodejs/undici) (`ProxyAgent` / `EnvHttpProxyAgent`).
- **Windows proxy string parsing** — handles `ProxyServer` written as
  `http=...;https=...` and maps `ProxyOverride` onto `NO_PROXY`.
- **Safe fallback** — an invalid manual URL logs one warning and falls back to
  following the system proxy instead of leaving a broken route installed.
- **Bilingual UI** (Chinese / English), following the DSH locale.

## Requirements

| Dependency | Version |
| --- | --- |
| Node.js | >= 20.18.1 (required by `undici@7`) |
| DeepSeek Assistant | >= `0.2.0-rc.2`; 2.0.0 is tested against `@deepseek-ai/dsh` 0.2.2-rc.3 |
| `@deepseek-ai/dsh-settings` | `>= 0.2.0-rc.2` |
| `@deepseek-ai/schemastery` | `~3.19.0` |

## Install

This is a source-form plugin, so wire it into a profile with `link:` — that is what
keeps `pnpm install` from replacing your checkout with a published snapshot:

```json
// $DSH_HOME/profiles/<name>/package.json
"dependencies": {
  "dsh-network-proxy": "link:<absolute path to this repository>"
}
```

Then run `pnpm install` in that profile directory and restart DSH.

The bundled script does all of it (and backs up the profile manifest first):

```powershell
pwsh -File .\deploy-to-profile.ps1 -Install          # edit manifest + install + verify
pwsh -File .\deploy-to-profile.ps1                   # edit manifest only
pwsh -File .\deploy-to-profile.ps1 -Profile web      # pick a profile
```

The plugin inserts the `network-proxy` entry through `cordis.patch.yml` and
registers a "Network proxy" row into the client `settings.general.item` slot.

## Configuration

Both fields live on the `network-proxy` profile entry and are editable from the
settings page:

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `mode` | `system` \| `manual` \| `direct` | `system` | How DSH reaches the network |
| `url` | `string` | `""` | Proxy URL for manual mode (must be `http(s)://`) |

They can also be written directly in `cordis.patch.yml`:

```yaml
- id: network-proxy
  name: dsh-network-proxy
  config:
    mode: manual
    url: http://127.0.0.1:7890
```

## Verify offline

No build step; check the schema and the validator with plain Node:

```bash
node --input-type=module -e "
import { Config, validateSettings } from './index.js';
const j = JSON.stringify(Config.toJSON());
console.log('volatile leaves:', (j.match(/\"volatile\":true/g) || []).length); // 2
console.log('default mode:', Config({}).mode.get());                          // system
validateSettings({ mode: 'manual', url: 'http://127.0.0.1:7890' });
"
```

## Layout

```
dsh-network-proxy/
├── index.js               # server half: volatile Config, dispatcher, proxy env
├── client.js              # web client: settings row over ctx.configForms
├── cordis.patch.yml       # plugin entry insertion
├── deploy-to-profile.ps1  # link: into a profile, install, verify
├── PATCHES.md             # what changed for 0.2.x, and the measurements
├── README.zh.md           # Chinese README
├── package.json
└── LICENSE
```

## FAQ

**Why does manual mode reject my URL?**
It must start with `http://` or `https://`; anything else logs a warning and falls
back to following the system proxy.

**Does direct mode change my OS proxy?**
No — it only clears the environment variables DSH reads.

**Are PAC scripts supported on Windows?**
No. An `AutoConfigURL` is reported, and manual mode is suggested instead.

**Do I need to restart after switching modes?**
No. The fields are volatile, so the Loader commits the new values into the running
plugin and emits `loader/volatile-update`; the dispatcher is reinstalled in place.

## License

[MIT](./LICENSE) — original work © 2026 Kirskite.
