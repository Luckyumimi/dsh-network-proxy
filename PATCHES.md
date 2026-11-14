# dsh-network-proxy — 兼容性改造记录

上游：https://github.com/kriskite/dsh-network-proxy
锁定上游 commit：`4cc265a2115cffdcfbf4f74257243b12a98ac9e0`

| 版本 | 适配目标 | 状态 |
| --- | --- | --- |
| 1.0.1 | DSH Desktop 2.0.10（`@deepseek-ai/dsh` 0.1.5-rc.2） | 已失效，见下 |
| **2.0.0** | **`@deepseek-ai/dsh` 0.2.2-rc.3**（schemastery 3.19.0 / undici 7.29.1 / Node 24.21） | 当前 |

## 为什么 1.0.1 在 0.2.x 上直接崩溃

1.0.1 建立在三个 API 上，它们在 0.2.x 里**全部不存在**：

| 1.0.1 依赖 | 0.2.2-rc.3 现状 |
| --- | --- |
| `import { settingsNamespace } from '@deepseek-ai/dsh-settings'` | 该包导出只剩 `SettingsForms` / `SettingsConflictError` / `redactSecrets`；`settingsNamespace` 已删除 |
| `ctx.settings.register(ns, schema, { applies:'live', validate })` | `SettingsForms` 上没有任何 `register`，服务端也无法自行注册命名空间 |
| `scope.get()` / `scope.watch(...)` | 随 `register` 一并移除 |

实际报错（宿主加载时）：

```
network-proxy (dsh-network-proxy): failed to import:
SyntaxError: The requested module '@deepseek-ai/dsh-settings'
does not provide an export named 'settingsNamespace'
```

即整条 import 语句就失败，插件点从未激活（profile 里该行 `fiberPhase: null`）。

## 2.0.0 的迁移

### 服务端 `index.js`

1. **改为导出 volatile `Config`**。0.2.x 的可编辑字段由插件自己声明，Settings 从
   `entry.fiber.runtime.Config` 取 schema，用 `volatileForm()` 过滤出带
   `volatile` 元数据的叶子生成表单：

   ```js
   export const Config = z.object({
     mode: z.union([...]).default('system').volatile(),
     url: z.string().default('').volatile(),
   })
   ```

   实测 `Config.toJSON()` 中 `mode`/`url` 均带 `"volatile":true`，`volatileForm()`
   能产出表单，`projectForm()` 能正确投影 `{ mode, url }`。

2. **`apply(ctx, config)` 读 volatile 引用**。字段是 `Volatile<T>` 引用，必须
   `config.mode.get()`，**不能解构**。

3. **热更新改用 `loader/volatile-update`**。Loader 对"只有 volatile 字段变化"的
   更新不重挂插件，而是把新值提交进运行中的引用，再向所属 fiber 发该事件（带变更
   路径）。这取代了旧的 `scope.watch()`，因此切换代理**不会重建插件**、不会打断在途请求。
   监听处对 `paths` 做了防御：空数组或首段为 `mode`/`url` 才重装（去掉路径判断会让
   任何无关字段的更新也重装 dispatcher）。

4. **`ctx.settings.configure({ auto: false })`**。插件自带设置行，必须关掉自动生成
   表单，否则设置页会出现两张重复的配置界面。这也是官方 `ui-theme` 的做法。

5. **只关闭自己创建的 dispatcher**。0.2.2-rc.3 仍会由 `@deepseek-ai/dsh-http-proxy`
   安装启动期代理策略，其 `proxyRouteFor()` 可能仍把那个 dispatcher 交给 web-fetch
   的 proxied 路由；关掉会影响 `web_fetch`。现在用 `ownDispatcher` 记录自己创建的
   那一个，切换时只回收上一个自己的。

6. **校验移到 `activate()` 内**。`validate` 选项没有了：manual 模式的非法 URL 记
   warn 并回退到 system，而不是让上一个错误路由继续生效。

7. **卸载时恢复环境变量并回收 dispatcher**，通过 `ctx.effect` 的 disposer 执行。

### 客户端 `client.js`

1.0.1 手写的整套取数逻辑全部删除：

| 1.0.1 | 2.0.0 |
| --- | --- |
| `ctx.remote.settings.describe()` 手动取 namespace | `ctx.configForms.get('network-proxy')` |
| 自己维护 `revision`、乐观锁、`generation` | form 内部处理 |
| `ctx.remote.settings.mutate(ns, ops, rev)` | `form.set(field, value)` / `form.mutate(ops)` |
| 自己订阅 `settings/document-updated` 刷新 | form snapshot 跟随共享 mirror 更新 |
| 内联 `createSnapshotStore` | `React.useSyncExternalStore(form.subscribe, form.getSnapshot)` |
| `inject: ['slots','locale','remote','remote.settings']` | `inject: ['slots','locale','configForms']` |

改 mode 与 URL 时用一次 `form.mutate([...])`，避免两个字段落在不同 revision 上。

### `package.json`

- `dsh.client.inject` 需要 `@deepseek-ai/dsh-api-remotes`（`remote`/`configForms`
  的传输）、`@deepseek-ai/dsh-client-locale`、`@deepseek-ai/dsh-client-ui-settings`
  （声明 `settings.general.item` 插槽类型）。
- peer 放宽为 `@deepseek-ai/dsh-settings >=0.2.0-rc.2`、`@deepseek-ai/schemastery ~3.19.0`；
  后者必须对齐，`.volatile()` 的 schema 输出类型在 3.19 才稳定。
- 新增 `engines.dsh: ">=0.2.0-rc.2"`。0.2.1-alpha.3 起兼容性检查**先读 `engines.dsh`**，
  命中就不再看 peer；写错范围会被直接拒绝安装。

## 离线实测（未触碰运行中的 Host）

用真实 `undici` + 假 ctx 直接调用 `apply()`，跑通全链路：

| 场景 | 全局 dispatcher | proxy 环境变量 |
| --- | --- | --- |
| 初始 manual | `ProxyAgent` | 已设置 |
| 切 direct | `Agent` | 已清空 |
| 切 system | `EnvHttpProxyAgent` | 按继承恢复 |
| manual + `ftp://` | 回退 system（`EnvHttpProxyAgent`） | 恢复继承值，warn 一次 |
| 卸载 | —— | 恢复到进程启动时的值 |

schema/U��证侧另测：`Config({})` 两个字段都返回 volatile 引用（`get()` →
`'system'` / `''`）；`validateSettings` 正确拒绝空前缀、`ftp://`、非 URL 三种输入。

## 部署方式（与 profile 其它本地插件一致）

本仓库是**独立源码目录**，不经 pnpm 从 git 拉取，因此不会被 `pnpm install` 覆盖。
在 `$DSH_HOME/profiles/<name>/package.json` 里把该依赖改成本地 link：

```json
"dsh-network-proxy": "link:<本仓库绝对路径>"
```

再执行一次 profile 的安装（`pnpm install`）即可。仓库里的 `deploy-to-profile.ps1`
会把这一步做好：

```powershell
pwsh -File .\deploy-to-profile.ps1 -Install
```

> 注意：`node_modules/dsh-network-proxy` 由 pnpm 管理。若 profile 里保留
> `github:kriskite/dsh-network-proxy` 这类托管声明，任何一次安装/启停都会把该目录
> 还原成上游 1.0.1，本地改动丢失。这正是本次改造中途目录被还原的原因；
> 改用 `link:` 后不再发生。

### 本仓库自身的依赖解析

`index.js` 只 import 两个运行时依赖：`undici` 与 `@deepseek-ai/schemastery`。
以 `link:` 方式接入时，它们从 profile 的 `node_modules` 解析，通常无需为本仓库
单独安装。若你的解析器需要本仓库自己有 `node_modules`，两种做法任选：

- 软链到 profile：`cmd /c mklink /J node_modules "%USERPROFILE%\.dsh\profiles\<name>\node_modules"`
- 或在本仓库 `npm install --omit=dev`（会装 undici；schemastery 是 peer）。

## 仍需注意

- Windows 的 `system` 模式读注册表 `Internet Settings`；只支持显式代理，检测到
  `AutoConfigURL`（PAC）会提示改用手动代理。
- 启动期那个 dispatcher 从不关闭，每次切换会留下一个自己的旧 dispatcher（一次一个）。
- 本插件解析到 profile 内的 undici 7.29.1；Node 24 内建 `fetch` 读 legacy 全局符号，
  `setGlobalDispatcher` 会同时写两代符号，因此对 `fetch` 与 undici 请求均生效。