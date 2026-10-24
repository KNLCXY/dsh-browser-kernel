# Changelog

本项目从「工作区脚本」长成「profile 级插件」，版本号按功能块递进。较早的条目按系列合并记录，细节以 `git log` 为准。

## 1.0.8

**修掉并发抓多页时的「张冠李戴」。**（1.0.7 只在本机装过、未对外发布，两版的修复合起来正式发一次）

- 根因：`web_digest` 用 `Promise.all` **并发**抓多个链接，而插件只复用**一个**工作标签
  （刻意的，见 `pickTarget`）。并发导航同一个标签 = 互相覆盖：
  - 轻则一个链接直接 `net::ERR_ABORTED`（被另一次导航打断），两个链接只回来一个
  - 重则 A 站读到的是 B 站的 DOM，而且**错误内容会被写进 15 分钟页面缓存**
    （缓存键取的是**请求** URL），之后一直以 `cached: true, ms: 0` 张冠李戴地供应
- 实盘踩到的样子（同一次会话内连续两次调用）：
  ① 两页调用里多出「重定向重复 1 条已合并」（两个不同 URL 抓回来的 final URL 相同）；
  ② 紧接着单页查 `example.com`，标题却是 iana 的「Example Domains」、正文是 iana 那段话、
  耗时 `0.0s`，并且「1257 字符 / 444 摘要 / 8 句取 1 句」与①完全相同 —— 缓存被投毒
- 修复：加一把**浏览器串行闸门**（`withBrowserLock`）。只锁「驱动工作标签」这一件事：
  - HTTP 直连那一档（`stack=official`）照旧并发，不受影响
  - `loginFlow` 自己开新标签（`/json/new`），**不进锁** —— 否则一次登录会把队列堵几分钟
- 新增 `test/test-serial.mjs`：本地起两个内容截然不同的页面，断言**每个 URL 都拿到自己的正文**。
  拿修复前的 lib 跑同一条测试会失败（`ERR_ABORTED` + 只回来 1 页），修复后两页各归各的
- 这是 **1.0.0 起就有的老问题**（1.0.0 第 2486 行同样是 `Promise.all`），不是新引入的

## 1.0.7

**修掉「浏览器卡白框」和「代理端口在监听但其实已经废了」两件事。**

两件事都做了实测取证，不是猜的。

### 一、白框 = 隐藏的内核窗口（`windowsHide` 惹的祸）

- 根因：`launchChrome` 的 `spawn` 选项里带着 `windowsHide: true`。它本意只是「别弹控制台窗口」，
  但在 Windows 上会通过 STARTUPINFO 传 `SW_HIDE`，把程序自己第一次 `ShowWindow` 覆盖掉 ——
  **浏览器窗口从头到尾都是隐藏的**：
  - 隐藏的 Chromium 窗口仍会在桌面上留下一整块**纯白矩形**，尺寸正好等于 `--window-size`（1440x900）
  - 「可视模式」形同虚设：用户看不到窗口，扫码登录那类必须看着窗口做的操作根本没法用
- 取证：同一内核、同样参数，只差 `windowsHide` 各起一个 —— `false` 的那个窗口 `IsWindowVisible=True`，
  `true` 的那个 `False`；再对纯净桌面采样：启动前 `RGB(0,165,247)`（桌面蓝），
  启动一个隐藏窗口后四个采样点全变 `RGB(255,255,255)`，对它发一次 `SW_MINIMIZE` 立刻恢复桌面色
- 修复：去掉 `windowsHide`。msedge / chrome 都是 GUI 子系统程序，本来就不会创建控制台，去掉对谁都无害
- **这不是 1.0 → 1.0.6 的回归**：把 GitHub 上发布的 1.0.0 拉下来逐行对拆，`windowsHide: true`
  在 1.0.0 第 675 行就有（1.0.6 是第 727 行）。1.0.0 → 1.0.6 一共只有 8 处改动，`lib/client.js` 一字未改

### 二、代理「端口在监听」被当成「代理能用」

- 根因：`proxyAlive()` 只做一次 TCP 连接测试。实测 Clash Verge 进程活着、7897 也在监听，
  但所有节点都挂了 —— 对任何网址都返回空。旧逻辑判「代理在线」，于是把浏览器指到
  `--proxy-server=死端口`，每个页面都变成「无法访问此网站」的**空白错误页**
- 雪上加霜：插件**完全不认识 Chromium 的错误页**（`chrome-error://chromewebdata/`），
  导航到错误页时 CDP 调用是「成功」的，于是错误页被当成正常正文返回，路由缓存 10 分钟内也不作废
- 加上 `PROBE_SLOW_MS = 1200`：这台机器直连 TTFB 普遍超 1.2 秒 → 「直连慢就改走代理」→ 一头撞进死代理
- 修复：
  1. 新增 `proxyUsable()`：端口在监听**且**通过该代理真的发一次 HTTP 请求拿到响应头，才算「能用」
     （两个探针都不通才算死；端口探活缓存 60s、转发测试单独一层缓存，互不拖累）
  2. 路由决策全部改用 `proxyUsable`；`browser_proxy status/test` 把「端口」和「转发」分开报
  3. 认识错误页：`Page.navigate` 的 `errorText` / `chrome-error:` 一律如实报错，并作废该域名路由与代理健康缓存
  4. 代理打不开时**自动退回直连重试一次**（`proxy: always` 是用户显式要求，不擅自改）
- 对照实验（`test/cmp-route.mjs`，起一个「只接受连接、永不响应」的假代理）：
  **1.0.0 和 1.0.6 都把三个测试站点（含直连可达的 example.com）判成「走代理」**，行为一模一样 ——
  所以「1.0 是正常的」是因为那时 Clash 的节点还活着，不是代码变坏了
- 新增 `test/test-deadproxy.mjs`：两个本地假代理做确定性回归 ——
  「只监听不转发」必须判不可用且路由退回直连，「正常回 204」必须判可用

### 其他

- 测试套件整理：有断言的进 `npm test`（rank / failed / route / deadproxy / window），
  只打印结果的挪到 `diag:*`（json / digest / find / offline / cmp）
- 修 `test/test-offline.mjs`：还在用改名前的旧路由 `/_browser-kernel/settings`（一跑就崩），
  并且它末尾的 `reset` 会把用户真实设置洗成默认值 —— 现在跑完自动还原
- `test/test-json.mjs` / `test-digest.mjs` 标注清楚：注入 `web.fetch` 桩的那几段只在
  `settings.stack === 'official'` 时才被使用，实盘默认 `plugin` 时它们测不到 HTTP 直连那一档

## 1.0.6

**代理路由不再把请求交给死代理。**（1.0.5 未单独发布，已并入本版）

- 旧行为：直连探测**抛异常**时无条件判「走代理」。代理端口没人监听时，所有抓取都报
  `ERR_CONNECTION_CLOSED` —— 看起来像「网络坏了」，其实是自己被路由到了死端口上（实测踩到）
- 现在：探测失败时先查代理是否在线 —— **不在线就仍走直连**；读缓存时若缓存说走代理、
  而代理已经不在线，当场作废并重新探测；走代理的抓取失败时，丢掉该域名缓存并重置代理健康状态
- 新增 `test/test-route.mjs`：临时把 proxyUrl 指向必定没人监听的端口（127.0.0.1:1）+ 让探测抛异常，
  断言判定为「直连可用」（跑完自动还原设置文件）

## 1.0.5

- **修**：空白页判定只认 `chrome://newtab`，而 **Edge 的新标签页是 `edge://newtab/`** ——
  于是 Edge 下永远找不到可复用的空白页，每次浏览器重启都新开一个标签（窗口里越攒越多）。
  现在按 `^[a-z-]+://newtab/?$` 判定，Chrome / Edge 都能命中。
- 实测记录：同一次浏览器会话内，第二次抓取确实复用同一个标签（2 个 page：工作标签 + 原始新标签页）；
  跨 DSH 重启的复用要等重启后才生效（宿主半在进程启动时加载，不热更新）。

## 1.0.4

- **改掉 1.0.3 里一个不安全的设计**：那一版按「URL 像搜索页（bing/google/…）」来认领并清理标签。
  但**用户也会在这个窗口里自己搜东西** —— 那样会把用户的标签当成我们的、复用甚至关掉。
  现在只认**我们自己记下的标签 id**（`state.json` 的 `ourTabIds`），绝不按 URL 猜。
- 行为说明：改动后第一次运行（尚无记录）仍可能新开一个工作标签（优先复用空白页/新标签页）；
  从第二次起固定复用同一个，跨 DSH 重启也不再堆积。

## 1.0.3

- **修「浏览器窗口越攒越乱」**：工作标签页的 id 只存在内存里，DSH 一重启就忘 ——
  而那个标签停在搜索结果页（不是空白页），于是认不出来、再开一个，几次之后窗口里堆满 Bing 搜索页，
  用户看到的就是「每次结束都停在这」。现在 id **落盘**（`~/.dsh/storages/websift/state.json`）跨重启复用，
  并且顺手关掉堆积的同类搜索页（只动我们自己留下的搜索标签，不碰用户手动开的标签）

## 1.0.2

- **修一个「把失败说成正常」的 bug**：一个页面都没取到正文时，`web_digest` 会回「正文本来就短（0 字符）」，
  让人以为内容本来就少。现在明确报「一页正文都没取到（N 个链接全失败）」，并在抬头逐条列出
  **未取到的域名 + 原因**（超时 / 被拦截 / 空正文）。新增 `test/test-failed.mjs` 锁住这个行为
- README 加两张图：能力总览（`docs/images/hero.png`）、一次调用的账本「原文 vs 摘要」（`docs/images/ledger.png`）
- Edge 内核实测记录：整页截图 1401×1845 正常（JS 重页面）；`login` 动作超时路径 25.5s 干净返回、不挂死

## 1.0.1

**发布到 npm**（`npm i dsh-websift` / DSH 插件中心可搜到）。内容与 1.0.0 完全一致，
仅为绕开一个 npm 侧冲突而递增版本号：

- npm 现在的规则是「发布必须 2FA 或带 bypass-2FA 的 token」，而新账号没有包就建不了那种 token
  （表单要求「至少选一个包」，但没有包时列表里根本没有可选项）
- 用 `npm stage publish` 打通的：暂存会为新包名创建占位包 `0.0.0-stage`，账号这才「有包」，
  于是能在 token 表单里选「所有包 + bypass 2FA + 读写」
- 暂存的 1.0.0 因无法批准（批准同样要求已注册的安全密钥）会占住这个版本号，
  所以改发 **1.0.1**

> 教训：npm 目前对「没有硬件安全密钥的新账号」几乎不友好，但 staged publish 留了个后门。

## 1.0.0

**首个正式版**（GitHub 会把它标成 Latest；0.9.x 全部保持预发布）。

从 0.9.0 到 1.0.0 累计的稳定能力：

- 四个工具：`browser`（text / html / eval / screenshot / login）、`web_find`、`web_digest`、`browser_proxy`
- 一次调用多页抓取 + 相关性闸门 + 压缩摘要（实测省 82–98% 上下文）
- 内核自动探测（Chrome / Edge / Brave / Chromium / 应用内置），换机器不用手改
- 三档代理（auto / always / never）+ Clash Verge 可选联动（启动后自动最小化窗口）
- 两套闭环可选：`plugin`（全走浏览器，默认）/ `official`（官方 API 搜索+抓取）
- 所有 CDP 调用带超时，内核卡住不会再拖死整轮（1.0 前最后一次修的，也是最重要的一个）
- 完整改名：路由 `/_websift/*`、存储 `storages/websift`、dock id、清单 id，旧配置自动复制迁移

> 1.0.0 起行为冻结：只修 bug、不再改接口；要动接口就走 2.0。

## 0.9.26

**统一改名**（发布前最后一次，之后不再动）：

- 路由 `/_browser-kernel/*` → `/_websift/*`
- 存储目录 `~/.dsh/storages/browser-kernel` → `~/.dsh/storages/websift`；
  首次运行会把旧设置**复制**过去，**旧目录保留作备份**，配置不会丢
- 输入框 dock id `browser-kernel-toggle` → `websift-toggle`
- `dsh-plugin.json` 的 id `dsh-websift.local` → `dsh-websift`
- 文档/README/ARCHITECTURE 里的路径同步（全仓 33 处，已确认 0 残留）

> 注意：改路由与 dock id 后**必须重启 DSH**，否则旧 client 半会去请求已经不存在的旧路由。

## 0.9.25

- **修整轮挂死的根因**：33 处 CDP 调用都没有超时，内核一卡（实测 Edge 截图）工具调用就永不返回，
  只能重启 DSH。现在 `connect().send()` 统一 30s 超时（`cdpTimeoutMs` 可调），CDP 的 HTTP 端点也加了 `AbortSignal`
- 面板新增「**最小化窗口**」按钮（`POST /_websift/window`）；headless 时会明说「没有窗口可最小化」
- 新增开关 `autoMinimizeOnClash`（默认开）：点「启动 Clash Verge」成功后自动最小化浏览器窗口
- 高级设置补齐 `cdpTimeoutMs` 输入框（此前只能改配置文件）
- 实测：Edge 内核截图正常（1416×808，3.7s）；四条路由与设置读写均符合预期

## 0.9.24

- `browser` 工具每次调用都重新读设置：此前用的是 `apply()` 时的快照，改 `visible` 等参数只能重启 DSH 才生效
- Chrome 启动参数加 `--disable-features=HttpsUpgrades`（后经验证对 Chrome 137 无效，0.9.25 起保留但不依赖它）

## 0.9.23

- 官方 `fetch` / `search` 加超时（20s）：没有超时的话，站点不响应会把整个工具调用拖死

## 0.9.22

- 修 `proxyMode: "never"` 时仍会拉起 Clash 的问题（见 0.9.17 记录）

## 0.9.21

给「使用官方 API」开关加了 ⓘ 提示（悬停显示）：说明打开后搜索/抓取分别走哪个接口、
**为什么不推荐**（摘要与压缩本来就是本插件的活，官方只负责取料；provider 多选时还要先指定一个，
否则报 ambiguous），以及默认关闭。

## 0.9.20

纯 UI 调整，行为不变：设置面板里「插件自带 / 官方 API」从一个双按钮改成**一个开关**
（和其他开关同款，默认关 = 插件自带浏览器）。底层仍是 `stack: plugin | official`。

## 0.9.19

把 0.9.18 的布尔开关换成 **`stack` 两套完整方案**，各走各的、不混搭：

- `plugin`（默认）：搜索用真浏览器，抓正文也用浏览器，**完全不碰 `ctx.web.*`**
  —— 不再有 provider 歧义报错，也不再出现「搜索用插件、抓取用官方」的半吊子状态
- `official`：搜索走 `ctx.web.search`，抓取走 `ctx.web.fetch`，抓取失败才回退浏览器
- 设置面板改成两个按钮（插件自带 / 官方 API）；`GET/POST /_websift/settings` 用 `stack` 字段
- 兼容 0.9.18 的 `builtinSearch` 布尔值：只有没写 `stack` 时才按旧值映射
- 浏览器抓取补上 JSON 识别：Chrome 把 JSON 原样渲染成文本时同样压成紧凑行，保住「JSON 直读」的收益
- 实测：plugin 模式 `web.search` 0 次 / `web.fetch` 0 次；official 模式各 1 次

## 0.9.18

新增设置项 **`builtinSearch`（默认关）**：把 DSH 内置的搜索 provider 变成可选。

- 关（默认）：`web_digest` 直接走浏览器搜索，不再调用 `ctx.web.search()` —— 结果头里那句
  `multiple usable web providers are registered …` 不会再出现
- 开：先试 `ctx.web.search()`，失败再回退浏览器，并把真实原因如实写进备注
- 设置面板「高级设置」多一个开关；`GET/POST /_websift/settings` 都支持该字段
- 实测：关 → provider 调用 0 次、输出无报错；开 → 调用 1 次、报错如实出现在备注

## 0.9.17

- 修：`proxyMode: "never"`（一律直连）时不再自动启动 Clash Verge —— 之前会无视该模式照样拉起

## 0.9.16

新增 **Clash Verge** 联动（可选依赖，不打包）：

- 代理端口不通时，自动启动 Clash Verge 并等端口就绪（最多 20s，30s 冷却防重复点）
- 设置面板新增「Clash Verge（可选依赖）」卡片：运行状态、程序路径、**启动按钮**、自动启动开关
- 设置项新增 `clashPath`（留空 = 自动找）与 `autoStartClash`（默认开）
- `browser_proxy` 新增动作 `clash`（看状态）与 `clash-start`（启动）
- 界面、README、插件卡片都标注了 Clash Verge 的仓库与作者

## 0.9.15

自动探测重写：从「3 个固定目录 + 只下一层」换成「多根目录 + 有界 BFS + Chromium 特征校验」。

- 扫描根目录：`DSH/resources`、`%LOCALAPPDATA%`、`%LOCALAPPDATA%\Programs`、`%APPDATA%`、
  `%ProgramFiles%`、`%ProgramFiles(x86)%`、`~/Desktop`；深度 4–5、目录数上限 4000
- 认识的可执行文件：chrome / chromium / msedge / brave / vivaldi / opera / **doubao（豆包）** /
  **quark（夸克）** / 360se / QQBrowser / SogouExplorer / UCBrowser / liebao / yandex
- **校验**：所在目录必须有 `icudtl.dat` 或 `*.pak`，避免把同名 exe 当内核
- 排序：标准浏览器优先（chrome → edge → brave → chromium → 其他），应用内置排最后
- 实测：本机扫到 3 个（Chrome / Edge / 豆包），耗时 ~250ms
- 注意：豆包、夸克这类是 **Electron 应用**，能暴露 CDP 但可能只打开它自己的界面，
  不一定能当浏览器用；优先选标准浏览器

## 0.9.14

修可视化 / 安静的窗口逻辑（两者只看「可视化」开关，安静只决定要不要置前）：

- **可视化开**：窗口常驻、**不再空闲自动关闭**（要回收就 `browser_proxy({action:"stop"})`）
- **可视化开 + 安静关**：每次操作把窗口还原并 `bringToFront`，能实时看到点哪、翻到哪
- **可视化开 + 安静开**：启动尽量最小化（`--start-minimized`）、全程不置前；登录时才还原并置前
- 窗口状态实测：安静开 → `minimized`，安静关 → `normal`，headless → 不涉及

## 0.9.13

- 设置面板加「**自动探测**」：点一下列出本机所有可用内核（Chrome / Edge / Brave /
  应用自带 / `DSH_CHROME`），点一个就填进路径；另有「留空 / 用自动」一键回到自动探测
- 新增宿主路由 `GET /_websift/chrome-candidates`（只回真正存在的路径）
- 面板补齐「调试端口」输入（1024–65535，改完会重启内核）
- 设置项覆盖审计：`visible` / `quiet` / `factExempt` / `showDock` / `proxyMode` / 预算与缓存
  等全部可在面板改；只有 `profileDir` / `outputDir` 故意不暴露（前者是浏览器 profile，
  后者决定 settings.json 的位置，改它们会把配置拆成两份）

## 0.9.12

- **内核路径自动探测**：`chromePath` 留空、写成 `auto`、或指向一个不存在的文件时，按
  `DSH_CHROME` → 系统 Chrome/Edge/Brave/Chromium → 应用自带内核（`resources/bin/chrome/…`）
  的顺序找，结果缓存；状态行会标「（自动探测）」
- 起不来时的报错分两种：有路径但启动失败（提示去设置里改）vs 根本没找到内核（提示装一个或设 `DSH_CHROME`）
- 换机器不再需要先手改配置

## 0.9.11

只改定位，不改行为。

- 卖点从「装一颗真浏览器」换成「**一次调用读完三页，只回一段摘要，省 80–98% token**」，
  浏览器降为底层实现（生态里更强的浏览器插件已经很多，差异化在省上下文）
- 同步改 `package.json` / `dsh-plugin.json` / `locale/*` / README 中英文首段 / GitHub topics

## 0.9.10

收掉 0.9.9 的两个尾巴：

- `TRACKING_PARAM_RE` 去掉 `from` / `source` / `sourcetype`：这些参数在部分站点是**内容选择器**
  （`?from=page2`、`?source=pdf`），当作跟踪参数删掉会让两个不同页面撞成同一个 key，
  去重时就变成「少给一条」。只保留 `utm_` / `spm` / `fbclid` / `gclid` / `share_` / `ref`
- `web_find` 的合并**挪到排序之前**：先合并再取前 `limit` 条，合并掉的名额能被候补结果补上
  （之前是排在后面合，8 条里合掉 3 条就只剩 5 条）

## 0.9.9

- 修 URL 去重（审计里的 P0）：
  - `normalizeUrl()` 的 `^www.` 补上转义（`.` 原本匹配任意字符），并去掉非根路径的尾斜杠
  - `web_find` 命中池按规范化 URL 再合一次，输出不再出现「同一篇占 3 条」
  - `web_digest` 抓完再按**最终 URL** 合一次：站内跳转 / 跟踪参数 / 带锚点的三种形态
    常常重定向到同一篇正文，只在抓之前去重挡不住（实测同一页出现 3 次）
- 合并数量会写进返回头的备注（`重复链接 N 条已合并` / `重定向重复 N 条已合并`）

## 0.9.8

- 启动参数加 `--disable-blink-features=AutomationControlled`：headless 下
  `navigator.webdriver === true`，GitHub 的文件编辑器、部分在线编辑器会**整块拒绝渲染**
  （页面只剩 "Files main" 骨架）。加上这个开关后实测正常，登录态与 cookie 不受影响

## 0.9.7

- 新增 `lib/rank.js`：`web_find` / `web_digest` 共用搜前清洗与结果重排
  - `normalizeQuery()` 去掉「帮我搜一下 / 是什么」这类指令壳，拆别名（逗号、又名、括号）
  - `rankSearchResults()` 按「标题与查询词的字面重合 × 标题质量」重排，丢弃首页、纯域名、符号堆砌
  - 竖排/垂直站点的别名表（`VERTICAL_ALIASES`）
- `web_digest` 新增 `strict`（更严的相关性闸门）与 `links_only`（只给排好序的链接）

## 0.9.6

- 可视模式新增 `quiet`（默认开）：窗口启动后最小化，不抢焦点；`action:"login"` 时自动还原并 `Page.bringToFront`

## 0.9.5

- 修复设置面板整块空白：client 半把 `?session=…` 拼进了 **Panel** 的加载逻辑，`sid` 未定义导致 `settings.section` 插槽崩溃。挪回 DockToggle

## 0.9.3

- 复用同一个工作标签页（`workTargetId`），不再每次新开又关——可视窗口里反复闪 `about:blank` 的问题消失
- 不再主动关闭标签页；`/json/list` 加重试

## 0.9.2

- `usage`（关 / 按需 / 强制）按会话记忆：键是 `exec.agent.id`，回落到全局设置

## 0.8.2

- `action:"login"` 会往页面注入「✅ 我已登录 / ✕」确认条，用户点一下才算成功；
  cookie 数量变化、「离开登录页」这类信号全部弃用（GitHub 的匿名 cookie 会造成 3 次误判），
  改为「连续 3 次确认」+ 排除 `sessions|verify` 页

## 0.7.x

- 分档预算定稿：短/中 1200，长 3000，超长 4000（3000 是召回拐点，见 README 基准表）
- 摘要开头加账本：页面成功率 / 压缩比 / token 估算
- 数值豁免（带单位的数字绕过相关性闸门）
- 跨页去重、相邻句合并成段

## 0.7.0

- `web_digest` 按正文字数分级给预算（短 / 中 / 长 / 超长）

## 0.4.0

- 新增 `web_digest`：搜索 → 抓正文 → 相关性闸门 → 抽取式摘要，一次调用，不调模型

## 0.3.0

- 设置页可自定义代理地址 / 空闲关闭秒数 / 内核路径，宿主侧校验（非法值 400）

## 0.2.0

- 设置页上线（`settings.section` 插槽），三种代理模式点选即生效

## 0.1.0

- 首个可用版本：`browser`（text / html / eval / screenshot）、`browser_proxy`（status / set / test / stop）
- 自建 CDP 客户端（Node 内置 `WebSocket`，零运行时依赖）
- 三档代理 + 按域名直连探测 + 路由缓存
