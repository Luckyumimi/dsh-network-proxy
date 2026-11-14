# dsh-network-proxy

[DeepSeek Assistant](https://github.com/deepseek-ai/deepseek-harness)（DSH）的网络代理
管理插件。在设置页加一行开关，把 DSH 的出口网络切换为 **跟随系统 / 手动代理 / 直连**，
修改后即时生效。

> **2.0.0 是 DSH 0.2.x 的移植版。** 0.2.x 重写了设置体系，本插件原本依赖的
> `settingsNamespace()` 与 `ctx.settings.register()` 已从 `@deepseek-ai/dsh-settings`
> 移除，上游 1.0.1 在新版上会在 import 阶段直接失败。逐条改动见 [PATCHES.md](./PATCHES.md)。

Fork 自 [kriskite/dsh-network-proxy](https://github.com/kriskite/dsh-network-proxy)。

English: [README.md](./README.md)。

## ✨ 功能特性

- **三种模式**
  - `system` 跟随系统：读取操作系统代理（Windows 读注册表 `Internet Settings`；
    其他平台读环境变量 `HTTP(S)_PROXY`）。
  - `manual` 手动代理：填写一个 HTTP/HTTPS 代理地址，如 `http://127.0.0.1:7890`。
  - `direct` 直连：清空代理环境变量，强制直连。
- **即时生效且不重挂插件**：字段声明为 `.volatile()`，切换只更新运行中的引用，
  插件不重启，在途请求不受影响。
- **覆盖 `fetch` 与 undici**：接管 [`undici`](https://github.com/nodejs/undici) 的全局
  dispatcher（`ProxyAgent` / `EnvHttpProxyAgent`）。
- **Windows 代理字符串解析**：正确处理 `ProxyServer` 的 `http=...;https=...` 写法，
  并把 `ProxyOverride` 映射为 `NO_PROXY`。
- **安全回退**：手动模式填了非法 URL 时记一条 warn 并回退到跟随系统，不会把错误路由
  留在全局。
- **双语界面**：内置中英文案，跟随 DSH 语言环境切换。

## 📦 系统要求

| 依赖 | 版本 |
| --- | --- |
| Node.js | >= 20.18.1（由 `undici@7` 要求） |
| DeepSeek Assistant | >= `0.2.0-rc.2`；2.0.0 适配 `@deepseek-ai/dsh` 0.2.2-rc.3 |
| `@deepseek-ai/dsh-settings` | `>= 0.2.0-rc.2` |
| `@deepseek-ai/schemastery` | `~3.19.0` |

## 🚀 安装

本仓库是源码形式的插件，推荐用 `link:` 接入 profile —— 这样才能避免 `pnpm install`
把本地改造换成上游发布版：

```json
// $DSH_HOME/profiles/<name>/package.json
"dependencies": {
  "dsh-network-proxy": "link:<本仓库绝对路径>"
}
```

然后在该 profile 目录执行 `pnpm install`，重启 DSH。

仓库内脚本可一步完成（会先备份 profile 清单）：

```powershell
pwsh -File .\deploy-to-profile.ps1 -Install          # 改声明 + 安装 + 核对
pwsh -File .\deploy-to-profile.ps1                   # 只改声明
pwsh -File .\deploy-to-profile.ps1 -Profile web      # 指定 profile
```

插件通过 `cordis.patch.yml` 注入 `network-proxy` 插件点，并在客户端
`settings.general.item` 插槽注册「网络代理」设置行。

## ⚙️ 配置项

两个字段都在 `network-proxy` 条目下，可在设置页实时修改：

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `mode` | `system` \| `manual` \| `direct` | `system` | DSH 访问网络的方式 |
| `url` | `string` | `""` | 手动模式下的代理地址（须为 `http(s)://`） |

也可直接写进 `cordis.patch.yml`：

```yaml
- id: network-proxy
  name: dsh-network-proxy
  config:
    mode: manual
    url: http://127.0.0.1:7890
```

## 🧪 离线验证

无构建步骤，直接用 Node 校验 schema 与校验函数：

```bash
node --input-type=module -e "
import { Config, validateSettings } from './index.js';
const j = JSON.stringify(Config.toJSON());
console.log('volatile 字段数:', (j.match(/\"volatile\":true/g) || []).length); // 2
console.log('默认模式:', Config({}).mode.get());                              // system
validateSettings({ mode: 'manual', url: 'http://127.0.0.1:7890' });
"
```

## 📁 目录结构

```
dsh-network-proxy/
├── index.js               # 服务端：volatile Config、dispatcher 管理、代理环境变量
├── client.js              # Web 客户端：基于 ctx.configForms 的设置行
├── cordis.patch.yml       # 插件条目注入
├── deploy-to-profile.ps1  # 接入 profile（link: + 安装 + 核对）
├── PATCHES.md             # 0.2.x 改造明细与实测记录
├── README.md              # English README
├── package.json
└── LICENSE
```

## FAQ

**Q: 为什么手动模式拒绝我的地址？**
A: 必须以 `http://` 或 `https://` 开头；其它形式会回退到跟随系统并记一条 warn。

**Q: 直连模式会改系统代理吗？**
A: 不会，只清理 DSH 读取的环境变量。

**Q: Windows 下支持 PAC 自动代理脚本吗？**
A: 不支持。检测到 `AutoConfigURL` 时会提示改用手动代理。

**Q: 改完模式要重启吗？**
A: 不用。字段是 volatile 的，Loader 把新值提交进运行中的插件并发
`loader/volatile-update`，dispatcher 当场重装。

## 📄 License

[MIT](./LICENSE) — 原始作品 © 2026 Kirskite。