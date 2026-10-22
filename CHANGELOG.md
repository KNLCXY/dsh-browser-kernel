# Changelog

本项目从「工作区脚本」长成「profile 级插件」，版本号按功能块递进。较早的条目按系列合并记录，细节以 `git log` 为准。

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
