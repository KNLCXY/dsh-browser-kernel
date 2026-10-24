# README 配图的源文件

`docs/images/*.png` 不是手绘的，是用**真浏览器渲染 HTML 再整页截图**得到的。改图流程：

1. 改这里的 `hero.html` / `ledger.html`（纯 HTML+CSS，无依赖）
2. 用本机浏览器打开它，整页截图（`full_page`），存回 `docs/images/`
   - 本机可用 DSH 的 `browser` 工具：
     `browser({ url: "file:///<...>/hero.html", action: "screenshot", full_page: true, out: "<repo>/docs/images/hero.png" })`
3. 截图尺寸 = 浏览器视口（本机约 **1416×808**）；所以页面用 `min-height:100vh` + `margin-top:auto`
   把页脚顶到底部，避免底部出现空带
4. `docs/` 在 `package.json` 的 `files` 白名单里，所以图会随 npm 包一起分发；`artwork/` 不在白名单，
   只留在 git 里当源文件

两张图的用途：

| 文件 | 用在哪 |
|---|---|
| `hero.png` | README 顶部（能力总览：一次调用读多页 / 真实搜索链接 / JS·登录态·截图 + 三个数字） |
| `ledger.png` | `### web_digest` 小节（一次调用的账本：抓回的正文 vs 返回的摘要） |

数字口径：`82–98%` 是多次实测的压缩区间；账本图里的 `12000 → 940（92%）` 是代表性样例，
不是某一次具体抓取的记录——改成你自己的实测值时，请顺带在 CHANGELOG 里记一笔来源。