# Changelog

本项目从「工作区脚本」长成「profile 级插件」，版本号按功能块递进。较早的条目按系列合并记录，细节以 `git log` 为准。

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
