# Changelog

本项目从「工作区脚本」长成「profile 级插件」，版本号按功能块递进。较早的条目按系列合并记录，细节以 `git log` 为准。

## 0.9.25

- **修整轮挂死的根因**：33 处 CDP 调用都没有超时，内核一卡（实测 Edge 截图）工具调用就永不返回，
  只能重启 DSH。现在 `connect().send()` 统一 30s 超时（`cdpTimeoutMs` 可调），CDP 的 HTTP 端点也加了 `AbortSignal`
- 面板新增「**最小化窗口**」按钮（`POST /_browser-kernel/window`）；headless 时会明说「没有窗口可最小化」
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
- 设置面板改成两个按钮（插件自带 / 官方 API）；`GET/POST /_browser-kernel/settings` 用 `stack` 字段
- 兼容 0.9.18 的 `builtinSearch` 布尔值：只有没写 `stack` 时才按旧值映射
- 浏览器抓取补上 JSON 识别：Chrome 把 JSON 原样渲染成文本时同样压成紧凑行，保住「JSON 直读」的收益
- 实测：plugin 模式 `web.search` 0 次 / `web.fetch` 0 次；official 模式各 1 次

## 0.9.18

新增设置项 **`builtinSearch`（默认关）**：把 DSH 内置的搜索 provider 变成可选。

- 关（默认）：`web_digest` 直接走浏览器搜索，不再调用 `ctx.web.search()` —— 结果头里那句
  `multiple usable web providers are registered …` 不会再出现
- 开：先试 `ctx.web.search()`，失败再回退浏览器，并把真实原因如实写进备注
- 设置面板「高级设置」多一个开关；`GET/POST /_browser-kernel/settings` 都支持该字段
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
- 新增宿主路由 `GET /_browser-kernel/chrome-candidates`（只回真正存在的路径）
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
