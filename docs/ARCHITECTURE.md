# 架构

一个 DSH 插件由两半组成：**宿主半**（`lib/index.js`，Node 进程里，注册工具和 HTTP 路由）和 **client 半**（`lib/client.js`，Web GUI 里，注册设置面板）。两半在 DSH 进程启动时各组装一次，改动后必须重启。

```
                       ┌──────────────────────────── DSH 进程 ────────────────────────────┐
                       │                                                                  │
  agent ──tool call──▶ │  lib/index.js                                                    │
                       │   ├─ browser / web_find / web_digest / browser_proxy             │
                       │   ├─ 代理路由（routeCache / probe / proxyAlive）                  │
                       │   ├─ 摘要管线（抓取 → 闸门 → 抽取 → 打包）                        │
                       │   └─ HTTP 路由 /_browser-kernel/settings                          │
                       │                    │                          ▲                  │
                       └────────────────────┼──────────────────────────┼──────────────────┘
                                            │ CDP (WebSocket)          │ fetch
                                            ▼                          │
                              ┌──────────────────────┐      ┌──────────┴─────────┐
                              │ 本机 Chrome 内核      │      │ Web GUI (lib/client.js)│
                              │ headless + 调试端口   │      │ 设置面板 / 输入框开关  │
                              └──────────────────────┘      └────────────────────┘
```

## 宿主半

### 注册

```js
export const name = 'dsh-browser-kernel'
export const inject = ['tools', 'webServer']

export function apply (ctx, config) {
  // 1. settings = DEFAULTS ← 插件配置 ← ~/.dsh/storages/browser-kernel/settings.json
  // 2. 注册四个工具：ctx.tools.register(defineTool({...}))
  // 3. 注册设置路由（必须在 ctx.effect 里，且工厂要返回 disposer）
  ctx.effect(() => ctx.get('webServer').register({
    kind: 'exact', path: '/_browser-kernel/settings', handler,
  }))
}
```

> 踩过的坑：`ctx.effect` 要传「返回 disposer 的工厂」。直接传 `webServer.register()` 的返回值，路由会当场自我注销。

### CDP 客户端

不引 Playwright / Puppeteer —— 只用 Node 22+ 内置的 `WebSocket` 和 `fetch`，零运行时依赖。

1. 确保内核在跑：`GET /json/version` 探活；不在就 `spawn(chromePath, args)`
2. 启动参数：`--headless=new`（可视模式去掉）、`--no-sandbox`、`--disable-gpu`、
   `--user-data-dir=<profileDir>`、`--remote-debugging-port=<port>`，
   需要代理时加 `--proxy-server=<proxyUrl>`
3. `GET /json/list` 找页面目标 → 连 `webSocketDebuggerUrl`
4. 消息按自增 `id` 配 Promise，每个调用带超时；`Page.enable` / `Runtime.enable` 后
   用 `Page.navigate` + 轮询 `readyState` + `wait_ms` 等页面稳定
5. 取正文/HTML/截图都是 `Runtime.evaluate`（截图走 `Page.captureScreenshot`）

**标签页复用**：记住第一次用的 `workTargetId`，之后都复用它。否则每次调用新开标签、取完就关，可视窗口里会不停闪 `about:blank`。取完**不关**标签页。

**空闲回收**：`idleMs`（默认 5 分钟）没有调用就关掉内核；下次调用按新参数重新拉起（3–6 秒）。改 `chromePath` / `port` 会立即关掉旧实例。

### 代理路由

```
域名 → ① 命中 proxySites？ ── 是 → 走代理（不探测）
       ② proxyMode = always / never？ ── 是 → 按设置
       ③ HEAD 直连探测，TTFB > probeTimeoutMs(2500ms)？ ── 是 → 走代理
       ④ 直连页面加载 > slowVisitMs(8000ms) → 记住该域名走代理
       ⑤ 代理端口 net.connect 300ms 不通 → 回落直连
```

结果进 `routeCache`（10 分钟）。浏览器走的是 `--proxy-server`，不是系统代理 —— 所以 Clash 的系统代理开关关着也能用，反之亦然。

### 摘要管线

```
query/urls
   │
   ├─ normalizeQuery()          去指令壳、拆别名（lib/rank.js）
   ├─ 搜索                        ctx.web.search()，或 web_find 的浏览器搜索
   ├─ rankSearchResults()        标题×查询词重合、丢低质标题
   ├─ normalizeUrl() + 去重      同一站点只取一条
   ├─ 缓存命中？                 15 分钟 / 60 条
   ├─ 抓取                       ctx.web.fetch() → 失败/空壳 → 真浏览器
   ├─ 正文清洗                   去脚本/样式/导航噪声
   ├─ 相关性闸门                 命中 ≥2 词或 ≥30%（strict 更严）
   │                             └─ 全不命中 → 返回候选链接，不硬凑
   └─ extractSmart()             按正文字数分档，句打分 → 相邻句合并 → 跨页去重 → 按预算打包
```

**打分** = 查询词命中 + 段落感 − 短行惩罚；带单位的数字走豁免（查参数时数字就是答案）。
**分档**：短/中 1200，长 3000（前/中/后三段按命中加权分配），超长 4000。
**不调模型**：全在宿主进程里做，所以除了最终摘要没有任何 token 成本。

### 登录状态机

```
action:"login"
   → 强制 visible（还原最小化、Page.bringToFront）
   → 注入确认条 LOGIN_BAR_JS（「✅ 我已登录」/「✕」），每轮轮询都重注入
   → 每 loginPollMs(1500ms) 检查：
        window.__bkLoginDone === true        → 成功（用户点了确认）
        否则 wait_js（调用方给了才看）        → 成功
        否则 wait_until 选择器出现            → 成功
        否则「已离开登录页」且不在 sessions|verify 上 → 连续 loginStreak(3) 次 → 成功
   → loginTimeoutS(180s) 超时 → 报「还停在登录页」，标签页保留
```

**从不主动关标签页**，也不读你的密码。cookie 落在插件自己的 `profileDir`。

## client 半

```js
window.__ModuleLoader__.load({
  id: 'dsh-browser-kernel',
  factory: (require) => {
    const React = require('react')
    exports.inject = ['slots']
    exports.apply = (ctx) => {
      ctx.slots.inject('settings.section', () => ctx.slots.register({ ... }, Panel))
      ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({ ... }, DockToggle))
    }
  },
})
```

- **设置面板**：`GET/POST /_browser-kernel/settings`，宿主侧校验（代理地址协议、30–21600 秒、`.exe`），非法直接 400
- **输入框三档开关**：关 / 按需 / 强制。**关**是唯一有硬约束的一档 —— 宿主直接拦下三个工具，不启动内核、不联网

## 配置优先级

```
DEFAULTS（lib/index.js）
   ↑ 被 cordis.patch.yml 的 config 覆盖（出厂默认）
   ↑ 被 ~/.dsh/storages/browser-kernel/settings.json 覆盖（运行时，工具/面板写入）
```

所以 `cordis.patch.yml` 里的值只是出厂值；真正生效的是 settings.json。两者都在会话之间保留。
