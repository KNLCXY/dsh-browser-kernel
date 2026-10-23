# dsh-websift 使用说明书

> 版本 **0.9.17** · 适用 DSH `0.2.1-rc.2` · 作者：KNLCXY
> 一句话：给 DSH 装一个**真浏览器**，并把它抓到的内容**压到只剩有用的部分**再交给模型。

---

## 目录

1. [它解决什么问题](#1-它解决什么问题)
2. [安装与卸载](#2-安装与卸载)
3. [四个工具](#3-四个工具)
4. [设置项全表](#4-设置项全表)
5. [实现原理](#5-实现原理)
6. [常见任务配方](#6-常见任务配方)
7. [故障排查](#7-故障排查)
8. [已知限制](#8-已知限制)
9. [版本演进](#9-版本演进)
10. [维护与二次开发](#10-维护与二次开发)

---

## 1. 它解决什么问题

DSH 自带的 `web_fetch` 有三个硬伤：

| 问题 | 后果 |
|---|---|
| 走 Node 原生 fetch，不认代理 | 被墙站点直接失败；DNS 被投毒时被判 SSRF 拒绝 |
| 返回整页正文 | 一篇 3 万字文章 ≈ 1.2 万 token，一次对话就烧光 |
| 不执行 JS | SPA、懒加载、需要登录的页面全是空壳 |

本插件对应解决：

- **真浏览器**：headless Chrome（本机是 OCS Desktop 自带的 Chrome 137），完整执行 JS
- **代理路由**：按站点自动决定直连还是走代理，能记住“慢站”
- **压缩**：抓完正文后做相关性闸门 + 抽句 + 去重，实测省 **76–98%** 字符
- **登录**：弹出可见窗口让用户自己登，cookie 持久化
- **交互**：批量点击/滚动/填表，翻页和懒加载也能拿

---

## 2. 安装与卸载

### 安装（本机）

```bash
dsh plugin --profile desktop add "file:<本项目绝对路径>"
```

装完**必须重启 DSH**——插件的宿主半和客户端半都是在进程启动时装配的。

### 换机器要改两处

| 项 | 默认值 | 说明 |
|---|---|---|
| `chromePath` | 空（= 自动探测） | 一般不用填；探测不到时写自己的 chrome.exe 绝对路径 |
| `proxyUrl` | `http://127.0.0.1:7897` | Clash 的混合端口，没有代理就留空 |

两处都能在 **设置 → 浏览器内核** 里改，不用动文件。

### 卸载

```bash
dsh plugin --profile desktop remove dsh-websift
```

浏览器进程会在空闲 5 分钟后自行退出；想立刻清掉：`browser_proxy({ action: "stop" })`。

---

## 3. 四个工具

### 3.1 `web_find` —— 搜索，给真实链接

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `query` | string | 必填 | 搜索词 |
| `aliases` | string | 空 | 别名，逗号分隔，最多 4 个。每个别名各搜一轮再合并。不传时也会从 query 里自动拆（逗号 / 又名 / 括号），最多再搜 2 个 |
| `engine` | string | `auto` | `auto` / `bing` / `google` / `baidu` / `360` |
| `limit` | number | 8 | 3–15 条 |
| `proxy` | string | 继承设置 | `auto` / `always` / `never` |

行为：

- 搜之前先洗 query：去掉「帮我搜一下」「是什么」「的相关资料」这类指令壳。`搜索引擎原理` 这种以「搜索」开头的真词不会被误切
- 自动别名：`狩野樱、樱佬`、`A又名B`、`名字（英文）`。垂直表目前只有 `贝果计划 = Operation Bagel`（在 `lib/rank.js` 的 `VERTICAL_ALIASES` 里加）
- 没手写 aliases 时，自动别名最多再搜 **2** 轮，避免一次查找变四次
- `auto` 先 Bing → **采用**少于 3 条换 Google → 再换百度
- **同站最多留 2 条**，再按标题与查询词的字面重合排序
- 低质标题弃用：首页 / 仅域名 / 符号堆砌 / 过短。零重合的留在列表底部并标「弱相关」，不直接扔掉（否则专有名词一切错就空了）
- 按完整 URL 去重
- 返回的是 DOM 里解析出的**真实地址**，不是 `so.com/link?m=…` 这类跳转壳

示例：

```
web_find({ query: "帮我搜一下 yyzj mod", aliases: "狩野樱,樱佬,saye." })
```

输出：

```
[web_find] 原查询：帮我搜一下 yyzj mod
清洗：yyzj mod
别名：指定 狩野樱 / 樱佬 / saye.
引擎 bing · 出口 直连 · 合计 6.2s · 采用 6 · 弃用 2（低质标题 2）

1. ★ 标题 · 重合 80% · 匹配「yyzj mod/狩野樱」
   https://...

弃用：
- 首页（低质标题）

建议深挖：标 ★ 的链接交给 web_digest({ urls })，不要再连搜。
```

### 3.2 `web_digest` —— 抓正文并压缩（最常用）

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `query` | string | — | 搜索词；和 find 共用同一套清洗。给了 `urls` 时可省略 |
| `urls` | string | — | 直接给链接，逗号或空格分隔。给了就**不搜索** |
| `max_pages` | number | 3 | 1–6。一个主题推荐 2–3，不要连调加页 |
| `budget_chars` | number | 3000 | 600–20000。要参数/数字时用 4000 |
| `allow_browser` | boolean | true | HTTP 抓不到时是否升级到浏览器 |
| `strict` | boolean | false | 标题与查询词零重合的链接不抓；正文须 ≥3 词或 ≥45%，且至少含一个核心词 |
| `links_only` | boolean | false | 只返回排好序的链接，不抓正文。选定后再用 `urls` 深挖 |

执行管道（详见第 5 节）：

```
清洗 query → 搜索 → 标题重合排序 / 低质标题弃用 → URL 规范化去重 → 缓存
  → 抓取（HTTP 重试 → 浏览器兜底） → JSON 直读 / HTML 去噪
  → 相关性闸门 → 抽句 → 跨页去重 → 固定头（命中/跳过/弃用）
```

三种结局：

| 情况 | 返回 |
|---|---|
| 有命中 | 抬头（命中/跳过/重复）+「采用」分条 + 压缩比 |
| 一页都没命中 | **不硬凑**，返回「建议 url」 |
| strict 下标题全不重合 | **不抓页面**，直接给建议 url |
| 全部失败 | 说明失败原因（HTTP 状态、超时、空壳） |

示例：

```
web_digest({ query: "东风41 射程", max_pages: 2 })
web_digest({ query: "东风41 射程 参数", budget_chars: 4000, strict: true })
web_digest({ query: "东风41 射程", links_only: true })
web_digest({ urls: "https://a.com/x, https://b.com/y", budget_chars: 1500 })
```

输出头：

```
[web_digest] 查询：东风41 射程
命中 2/3 · 跳过 1 · 跨页重复 3
正文 43,070 字符 → 摘要 1,215 字符（压缩 97%）· 约 17,228 → 486 tokens
弃用：example.com（查询词不足）

采用：
1. ...
```

推荐用法（少连调）：一个主题一次 `max_pages: 2~3`、`budget_chars: 3000`。先挑链接就 `links_only`，再对选中的 url 深挖。不要换个说法再搜一轮。摘要仍是原句拼接，**不调用模型重写**。

### 3.3 `browser` —— 单页操作

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `url` | string | 必填 | |
| `action` | string | `text` | `text` / `html` / `eval` / `screenshot` / **`login`** |
| `js` | string | — | `action=eval` 时执行 |
| `wait_ms` | number | 600 | 页面就绪后再等多久 |
| `max_chars` | number | 4000 | 返回文本上限 |
| `proxy` | string | 继承 | 覆盖代理模式 |
| `actions` | string | — | **批量动作**，JSON 数组，见下 |
| `full_page` / `out` | — | — | 截图用 |

#### `actions`（批量操作）

一次调用里最多 12 个动作，**只在最后返回一份结果**：

```json
[
  { "click": "a.morelink" },
  { "wait": 800 },
  { "scroll": "bottom" },
  { "type": { "selector": "#q", "text": "hello" } }
]
```

- `click` 可以是 CSS 选择器，也可以是**按钮文字**（按 `innerText` 精确匹配）
- `scroll` 支持 `bottom` 或像素值
- `wait` 毫秒
- 某个动作找不到目标就**立即停止**，并在抬头写明失败：

```
动作 1/2：#1 点「a.morelink」✓ · #2 点「#不存在」✗
⚠ 有动作失败，后面的没再执行：#
```

#### `action=login`（登录引导）

```js
browser({
  action: "login",
  url: "https://github.com/login",
  wait_js: '!!(document.querySelector("meta[name=user-login]")||{}).content',
  timeout_s: 180
})
```

流程：

1. 强制切到**可见模式**，弹出浏览器窗口
2. 页面底部注入一个浮条：`登录完成后点右边 → [✅ 我已登录] ✕`
3. 你扫码 / 输密码 / 过二次验证（**密码不经过模型**）
4. 三种判定，先到先得：
   - 你点了「✅ 我已登录」（**最可靠**）
   - `wait_js` 表达式返回真（最精确，推荐）
   - `wait_until` 选择器出现
5. 超时不关窗口，你可以继续操作

几点说明：

- 给了 `wait_js` 就**只认它**，其余启发式全部让位（吃过误判的亏）
- 没给判定条件时，兜底规则是「连续 3 次检测到离开登录页」
- 登录态写进插件自己的 profile，**重启不丢**

### 3.4 `browser_proxy` —— 代理与浏览器状态

| action | 作用 |
|---|---|
| `status` | 当前模式、地址、浏览器是否运行、可视/安静模式 |
| `set` + `mode` | `auto` / `always` / `never`，立即生效 |
| `test` + `url` | 探测某个域名会走直连还是代理（结果缓存 10 分钟） |
| `stop` | 立即关闭浏览器 |

---

## 4. 设置项全表

位置：**设置 → 浏览器内核**。全部有默认值，默认值就是实测调好的结果。

### 4.1 主模块

| 字段 | 默认 | 范围 | 说明 |
|---|---|---|---|
| `showDock` | 开 | — | 输入框右上角是否显示「关 / 按需 / 强制」 |
| `visible` | 关 | — | 可视化浏览器（窗口真的出现） |
| `quiet` | 开 | — | 安静模式：可视窗口启动后**最小化**，不抢焦点；登录时自动还原 |
| `chromePath` | OCS Chrome | — | 内核路径 |
| `idleMs` | 300000 | 30s–6h | 空闲多久关浏览器 |

### 4.2 分支 · 代理

| 字段 | 默认 | 说明 |
|---|---|---|
| `proxyMode` | `auto` | auto / always / never |
| `proxyUrl` | `http://127.0.0.1:7897` | 代理地址 |
| `proxySites` | github.com, githubusercontent.com, google.com, youtube.com, x.com, twitter.com, gamebanana.com | **强制走代理的站点**，逗号或换行分隔，子域自动命中 |

### 4.3 分支 · 网页摘要

| 字段 | 默认 | 范围 | 说明 |
|---|---|---|---|
| `budgetChars` | 3000 | 600–20000 | 一次摘要的总字符预算（多页平分） |
| `longBudget` | 3000 | 800–8000 | 长页单页预算 |

### 4.4 高级设置（一般不用动）

**分级阈值**（按正文字数决定用哪档参数）：

| 字段 | 默认 |
|---|---|
| `shortMaxChars` | 3000 |
| `midMaxChars` | 15000 |
| `hugeMaxChars` | 50000 |

**分级预算**：

| 字段 | 默认 | 依据 |
|---|---|---|
| `shortBudget` | 1200 | 短页给多了没意义 |
| `midBudget` | 1200 | 同上 |
| `longBudget` | **3000** | 32k 字文档实测：1200 → 召回 28%，3000 → **61%** |
| `hugeBudget` | 4000 | 再多给 25% 只多 6 个点，不划算 |

**行为**：

| 字段 | 默认 | 说明 |
|---|---|---|
| `factExempt` | 开 | 事实句豁免：带单位的数字/版本号不会被门槛删掉 |
| `cacheTtlMin` | 15 | 页面缓存有效期 |
| `cacheMax` | 60 | 缓存条数 |
| `routeTtlMin` | 10 | 路由判断缓存 |
| `probeTimeoutMs` | 2500 | 直连探测超时 |
| `slowVisitMs` | 8000 | 整页超过这个时长 → 记住该站走代理 |
| `pageWaitMs` | 45000 | 页面等待上限 |
| `waitMs` | 600 | 默认额外等待 |
| `loginPollMs` | 1500 | 登录轮询间隔 |
| `loginStreak` | 3 | 自动判定需要连续几次成立 |
| `loginTimeoutS` | 180 | 登录默认超时 |

### 4.5 输入框的三档（按会话）

| 档 | 行为 | 硬约束？ |
|---|---|---|
| **关** | 三个工具一律返回「已被关闭」，**不启动内核、不联网** | ✅ 宿主拦截 |
| **按需** | 正常，由模型自己判断 | — |
| **强制** | 正常，且**每次结果末尾**附一句「涉及网络的内容必须实际抓取核实」 | ❌ 软提醒 |

存法：`settings.json` 的 `sessionUsage: { "<会话id>": "off" }`，只记改过的会话。
拿不到会话 id 时退回全局 `usage`。

---

## 5. 实现原理

### 5.1 分层图

```
模型
 │  调用工具
 ▼
┌──────────────────────────────────────────────┐
│ 工具层  web_find / web_digest / browser /    │
│        browser_proxy（defineTool 注册）       │
├──────────────────────────────────────────────┤
│ 管道层  URL 规范化 · 缓存 · 抓取 · 闸门 · 抽句 │
├──────────────────────────────────────────────┤
│ 浏览器层  spawn Chrome · CDP(WebSocket) ·     │
│          标签复用 · 动作执行 · 登录           │
├──────────────────────────────────────────────┤
│ 决策层  代理路由 · 慢站记忆 · 使用模式         │
└──────────────────────────────────────────────┘
 │
 ▼
Chrome（独立 profile）+ 页面
```

### 5.2 浏览器运行时

| 能力 | 实现 |
|---|---|
| 启动 | `child_process.spawn(chrome.exe, args, {detached:true})` |
| 参数 | `--headless=new`（可视模式不传）、`--no-sandbox`（必需）、`--user-data-dir=<temp>`、`--remote-debugging-port=9333`、`--disable-extensions`、`--mute-audio` |
| 控制 | **CDP over WebSocket**，用 Node 24 内置的 `WebSocket`，**零依赖** |
| 就绪判断 | 轮询 `document.readyState` + `body.innerText.length`，每 250ms |
| 提前收 | 非截图模式下，`interactive` 且有 200 字就收，不等图片字体 |
| 标签复用 | 记住 `workTargetId`，下次直接用同一个标签（不新建、不关闭） |
| 空闲关闭 | `setTimeout` 到点后 CDP `Browser.close` |
| 端口冲突 | 换端口或先 `stop` |

为什么必须 `--no-sandbox`：内核在 Desktop 目录下，Chromium 沙箱读不到自己的可执行文件，报 `Sandbox cannot access executable (0x5)`。

### 5.3 代理决策

```
        命中 proxySites？
        ├─ 是 → 代理（若代理端口活着）
        └─ 否 → 直连 HEAD 探测
                  ├─ TTFB ≤ 1.2s → 直连
                  ├─ TTFB > 1.2s → 代理（弱网/海外站）
                  └─ 超时/失败   → 代理
        整页耗时 > 8s 且走的是直连 → 记住「该站走代理」，下次直接走
```

- 探测结果缓存 10 分钟（`routeTtlMin`）
- 代理存活用 `net.connect` 检查，300ms 超时，结果缓存 60 秒
- **站点匹配**：`github.com` 同时命中 `gist.github.com`、`api.github.com`

实测依据：GameBanana 直连 22–24 秒，走代理 8–11 秒；GitHub 直连不通。

### 5.4 抓取管道

```
urls / 搜索结果
   ↓ normalizeUrl：去 #锚点、去 utm_/spm/from/ref、去 www、参数排序
   ↓ 按规范化 URL 去重（同一篇以两种形态出现只抓一次）
   ↓ 缓存命中？→ 直接返回（ms:0）
   ↓ readPage：
      ① ctx.web.fetch（DSH 自带，有 SSRF 防护、30s 超时、5MB 上限）
         失败重试 1 次（间隔 400ms）
      ② 仍失败 / 空壳 / 4xx → 升级真浏览器 action=text
      ③ 识别 JSON：最大的对象数组，每条取 ≤6 个短字段，最多 20 行
      ④ HTML：先删 script/style/nav/header/footer/aside/form，
              再删「链接占比 >60% 的 <li>」菜单项
   ↓ 写入缓存（TTL 15 分钟，LRU 60 条）
```

空壳判定：HTML 超过 8000 字符但抽出的正文不足 300 字——典型 SPA。

JSON 直读实测：GameBanana API 原始 16,501 字符（≈6,600 token）→ 979 字符（≈392 token），**省 94%**。

### 5.5 摘要算法

**① 分句**：按 `\n` 切块（<20 字丢弃），再按 `。！？!?;；` 切句。

**② 查询词**：英文按词，中文二字滑窗（没有分词器）。

**③ 相关性闸门**（页面级）：

```js
relevant = 给了 urls || 没查询词 || 命中词数 >= 2 || 命中率 >= 0.3
```

不相关的页面直接跳过并在头部**报出来**，不参与摘要。

**④ 打分**（句子级）：

```
score = 命中词数 × 3
      + 段落感（有句号/够长）× 1.5
      + 长度 × min(1.5, len/200)
      + 事实句 × 1.6          ← 带单位的数字、版本号
      + 句末标点 × 0.8
      − 短行（<45 字）× 1.2
      + 开头三句 × 0.5
```

**⑤ 事实句豁免**（关键修正）：

`最大射程约14000公里` 这种句子是视频标题/图注，**没有句号**，会被「只从段落里挑」的规则排除。实测东风-41 的射程数字就是这样丢的。

修法两层：
- 候选池放行事实句：`pool = 段落句 ∪ 事实句`
- 硬门槛放行事实句

事实句正则只认「量」不认「日期/金额」，否则 `2025年阅兵`、`30亿成本` 会把噪音放回来：

```js
/\d+(?:\.\d+)?\s*(?:公里|千米|km|米|马赫|吨|kg|MB|GB|TB|ms|%)/i
```

**⑥ 硬门槛**：句子必须含标题里的型号或标题词（防百科「相关推荐」污染），但**事实句豁免**。过滤后不足 5 句则放弃门槛。

**⑦ 分档预算**：

| 正文字数 | 单页预算 | 抽取方式 |
|---|---|---|
| ≤3000 | 1200 | 全局打分 |
| ≤15000 | 1200 | 全局打分 |
| ≤50000 | 3000 | 前/中/后三段按命中加权 |
| >50000 | 4000 | 同上 |

**⑧ 去重**：

- 句内近似去重：去标点后比对前 80 字
- 跨页去重：全局 Set，比对前 60 字，命中就丢并在头部报「跨页重复 N 句已合并」
- 预算地板：`score < 1.2` 就收手，不硬凑满预算

**⑨ 段落还原**：相邻句子（原始 index 连续）合并成一段——一行一句读起来是碎的。

### 5.6 登录实现

```
ensureChrome(visible=true)
  → 新建标签 → 打开登录页
  → 每 poll 一次：
      · 重新注入浮条（页面跳转后旧 DOM 会没）
      · 读 window.__bkLoginDone / __bkLoginCancel
      · 执行 wait_js / wait_until
      · 判断是否「离开登录页且不是 sessions/verify 中间页」
  → 连续 N 次成立才算成功
```

踩过的坑：

| 坑 | 现象 | 修法 |
|---|---|---|
| cookie 变多当成功 | GitHub 匿名访问也种 cookie | 去掉该信号 |
| 离开登录页当成功 | 停在「设备验证」页 | 排除 `sessions`/`verify` |
| 登录完关标签 | 用户正在填验证码，页面被抽走 | 登录模式不关标签 |
| 单次判定 | 页面跳转瞬间假成立 | 连续 3 次 |

### 5.7 三档使用模式

| 层 | 实现 |
|---|---|
| 存储 | `settings.json` 的 `sessionUsage[sessionId]`，缺省用全局 `usage` |
| 判定 | `execute(args, exec)` 里取 `exec.agent.id`，查会话表 |
| 拦截 | `off` → 直接返回 `OFF_TEXT`，不 `ensureChrome`、不联网 |
| 提醒 | `force` → 结果末尾追加 `FORCE_TAIL` |

### 5.8 界面

| 位置 | 实现 |
|---|---|
| 设置页 | 客户端模块 `ctx.slots.register({ name: "settings.section" })` |
| 输入框开关 | `ctx.slots.register({ name: "conversation.input.dock" })` |
| 读写 | `webServer.register({ kind: "exact", path: "/_browser-kernel/settings" })` |
| 校验 | `sanitizePatch`：白名单字段 + 范围检查，非法返回 400 |
| 持久化 | `~/.dsh/storages/browser-kernel/settings.json` |

---

## 6. 常见任务配方

### 6.1 查一个主题（最省）

```
web_digest({ query: "关键词", max_pages: 2, budget_chars: 3000 })
```

人话也能传（「帮我查一下……是什么」），会先洗成核心词。一个主题一次就够，不要连调。

### 6.2 读某一个链接

```
web_digest({ urls: "https://..." })
```

### 6.3 要精确数字/参数

```
web_digest({ query: "东风41 射程 参数", budget_chars: 4000, strict: true })
```

事实句豁免会保住带单位的数字。`strict` 少抓标题对不上的脏页。

### 6.4 拿真实链接（不要摘要）

```
web_find({ query: "...", limit: 10 })
web_digest({ query: "...", links_only: true })
```

选定后再 `web_digest({ urls: "https://..." })`，不要换说法再搜。

### 6.5 翻页 / 懒加载

```
browser({
  url: "https://news.ycombinator.com/news",
  actions: [{ click: "a.morelink" }, { wait: 1200 }],
  action: "text"
})
```

### 6.6 要登录的站

```
browser({ action: "login", url: "https://github.com/login",
          wait_js: '!!(document.querySelector("meta[name=user-login]")||{}).content' })
```

登录后再用 `web_digest` / `browser`，自动带 cookie。

### 6.7 页面要滚动才加载

```
browser({ url: "...", actions: [{ scroll: "bottom" }, { wait: 1500 }, { scroll: "bottom" }], action: "text" })
```

### 6.8 看页面长什么样

```
browser({ url: "...", action: "screenshot" })
```

返回图片路径，用 `read_image` 看。**截图不占上下文 token**。

---

## 7. 故障排查

| 症状 | 原因 | 处理 |
|---|---|---|
| `浏览器没起来（15s 内 CDP 端口无响应）` | chromePath 错 / 沙箱拒绝 | 检查路径；确认命令里带 `--no-sandbox` |
| 一直返回空壳 | 页面是 SPA 但浏览器没起来 | 看 `browser_proxy({action:"status"})` 是否 running |
| 被墙站点打不开 | 命中不了 proxySites 且探测判直连 | 把域名加进「强制走代理的站点」 |
| 摘要明显缺内容 | 硬门槛太狠 | 调大 `budgetChars`；或先用 `browser action=text` 看全文 |
| 摘要里全是噪音 | 页面结构特殊 | 用 `web_digest({ urls })` 走 hurl 单页；或 `browser` 手动取段落 |
| 登录明明成功却报失败 | 判定条件不匹配 | 加 `wait_js`（最可靠）或直接点页面上的「✅ 我已登录」 |
| 设置页空白 | 客户端代码抛错（历史上出现过 `sid is not defined`） | 看浏览器控制台；重启后仍空白就回滚版本 |
| 可视窗口反复弹 | 旧版本每次新建标签 | 0.9.3+ 已修（复用同一标签 + 安静模式最小化） |
| 装了不生效 | 没重启 | 宿主和客户端都必须重启 |

---

## 8. 已知限制

| 限制 | 说明 |
|---|---|
| 无登录态继承 | 用的是**独立 profile**，不碰你日常浏览器；要登录得走 `action=login` |
| 摘要不是重写 | 抽的是原句，句子之间可能跳跃，不是通顺的综述 |
| 中文不分词 | 闸门仍用二字滑窗，专有名词可能切错。排序用的是整词，不把滑窗当同等权重 |
| 无语义改写 | 只去指令壳、拆别名、查一张很小的垂直表。同义词、意图理解不做 |
| 无站点适配器 | 不针对某个站写解析器；有 API 的站（GameBanana、GitHub）直接打 API 更快 |
| 单标签串行 | 不做多标签并发（只提速，不影响质量） |
| 不做增量 | 不比对页面是否更新，每个 URL 都从头抓 |
| 内存占用 | 一次约 16 进程 / 700MB，空闲 5 分钟自动关 |

---

## 9. 版本演进

| 版本 | 关键变化 |
|---|---|
| 0.1–0.2 | 浏览器工具 + 设置面板 |
| 0.3 | 设置项可视化（代理地址/空闲/内核路径可改） |
| 0.4 | `web_digest`（抓取 + 压缩） |
| 0.5 | 相关性闸门 + 不命中给候选链接 |
| 0.6 | `web_find`（替代多源搜索插件） |
| 0.7.0–0.7.2 | 分级预算（长页 3000）；A/B 定硬门槛 |
| 0.7.3 | 数值豁免、URL 缓存、预算地板 |
| 0.7.4 | 同站 2 条、慢站记忆、延迟路由 |
| 0.7.5 | JSON 直读（−94%）、跨页去重、别名并发 |
| 0.7.6 | 设置页树形化 + 可视化开关 |
| 0.7.7–0.8.2 | 登录流程（按钮 + 判定收紧）、强制代理站点 |
| 0.8.3–0.8.5 | 输入框三档（关/按需/强制） |
| 0.9.0–0.9.1 | 全部参数入设置；批量点击/滚动 |
| 0.9.2 | 三档按会话隔离 |
| 0.9.3 | 修复 about:blank（复用同一标签） |
| 0.9.4–0.9.6 | 修复设置页空白；安静模式（最小化不抢焦点） |
| 0.9.7 | 搜前 query 清洗；标题重合排序 + 低质标题弃用；`strict` / `links_only`；返回固定成采用/弃用/建议 url。不引入模型摘要 |
| 0.9.8 | 加 `--disable-blink-features=AutomationControlled`，修 headless 下 `navigator.webdriver=true` 导致 GitHub 编辑器整块不渲染 |
| 0.9.9 | URL 去重修复：`^www.` 转义、非根尾斜杠、抓后按最终 URL 再合一次（重定向/跟踪参数/锚点三形态） |
| 0.9.10 | 跟踪参数收窄（`from`/`source` 不再当跟踪参数）；`web_find` 合并挪到排序之前，名额可补足 |
| 0.9.11 | 定位改为「一次调用读完，只回一段摘要，省 80–98% token」；浏览器降为底层实现 |
| 0.9.12 | 内核路径自动探测（`DSH_CHROME` → 系统浏览器 → 应用内置），换机器不用手改 |
| 0.9.13 | 面板「自动探测」按钮 + 候选内核路由；补齐调试端口输入；设置项覆盖审计 |
| 0.9.14 | 可视化/安静窗口逻辑重写：可视化开则常驻不自动关，安静只决定置前与否 |
| 0.9.15 | 探测重写：多根目录 + 有界 BFS + Chromium 特征校验（`icudtl.dat` / `*.pak`） |
| 0.9.16 | Clash Verge 联动（可选）：端口不通时自动启动，面板加状态卡片与开关 |
| 0.9.17 | `proxyMode: "never"` 时不再自动启动 Clash |

---

## 10. 维护与二次开发

### 文件布局

```
plugins/dsh-websift/
├── lib/
│   ├── index.js      宿主：4 个工具、路由、抓取与摘要算法
│   ├── rank.js       搜前清洗、别名、标题重排（find / digest 共用）
│   └── client.js     客户端：设置面板、输入框开关
├── cordis.patch.yml  插件条目与默认参数
├── dsh-plugin.json   插件名片（标题/简介/图标）
├── locale/           中英文案
├── docs/icon.png     图标
├── presets/          测试与基准脚本
└── package.json
```

### 改代码的固定流程

```bash
# 1. 改 lib/index.js、lib/rank.js 或 lib/client.js
# 2. bump 版本（pnpm 对 file: 依赖不变更版本会 "Already up to date"）
# 3. 重新安装
dsh plugin --profile desktop remove dsh-websift
dsh plugin --profile desktop add "file:<路径>"
# 4. 重启 DSH
```

### 自测脚本（不碰 DSH 就能跑）

```bash
ELECTRON_RUN_AS_NODE=1 "…/DeepSeek Harness.exe" test-digest.mjs   # 摘要管道
ELECTRON_RUN_AS_NODE=1 "…/DeepSeek Harness.exe" test-json.mjs     # JSON 直读
ELECTRON_RUN_AS_NODE=1 "…/DeepSeek Harness.exe" test-rank.mjs      # 清洗 / 排序（不需要浏览器，Node 也能跑）
ELECTRON_RUN_AS_NODE=1 "…/DeepSeek Harness.exe" test-find.mjs     # 搜索
ELECTRON_RUN_AS_NODE=1 "…/DeepSeek Harness.exe" reg-fact.mjs      # 事实句豁免回归
```

### 加新功能的评审标准

任何改动先过三条，任一不过就不做：

1. **会不会大幅增加 token？** —— 别按“每步一份摘要”做，要批量 + 只返回最终状态
2. **会不会上下文不连贯？** —— 分页内容要合并成一份
3. **会不会准确性不足？** —— 引入误判就必须加校验或不做

---

*本文档对应 0.9.7。改代码后记得同步更新「版本演进」和「设置项全表」。*
