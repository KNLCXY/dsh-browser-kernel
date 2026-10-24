# dsh-websift

**One call, several pages read, one digest back — 80–98% fewer context tokens.**

The engine is a real Chrome (headless, driven over the DevTools Protocol), so JS-rendered pages, real search-result URLs, logged-in sessions and screenshots all work. But what the agent gets is not "another browser tool": it is a pipeline that does **search → fetch → relevance gate → extract** end to end. Full page text stays inside the host process; the model only sees the final digest plus a ledger.

```
web_digest     search or given URLs → fetch → relevance gate → digest (80–98% fewer tokens)
web_find       one real browser search, returns real hrefs (no so.com/link redirect shells)
browser        open a URL and get post-JS content: text / outerHTML / screenshot / eval / login
browser_proxy  inspect / switch / probe the proxy, effective immediately, no restart
```

Why "browser + digest" instead of just a browser: accessibility trees, sidebar takeovers and visual grounding are already done better elsewhere. The trade-off here is **context economy** — five pages cost one paragraph, non-matching pages say so instead of being padded into a fake summary, and a JS shell is escalated to a real browser.

> The project is developed against the Chinese-speaking DSH community; the detailed manual ([README.md](README.md), [docs/MANUAL.md](docs/MANUAL.md)) is in Chinese. This file is the English overview.

## Why

DSH's built-in `web_fetch` is an HTTP fetcher: no JS engine, no cookie jar, and it ignores proxy environment variables. That fails on exactly the pages an agent meets most often:

| Situation | `web_fetch` | this plugin |
|---|---|---|
| SPA / JS-rendered page | "Please enable JavaScript" | real Chrome, runs the JS |
| Search results | redirect wrappers (`so.com/link?m=…`) | the engine's own resolved `href` |
| Login-required content | 401 / login page | `browser({action:"login"})` pops a window, cookie stays in the plugin profile |
| Blocked domain | connection failure | three proxy modes with per-domain probing |
| Reading 5 pages | 5 full texts in context | one `web_digest` call, one digest plus a ledger |
| "What does the page look like?" | — | full-page PNG on disk, only the path is returned |

Design rule: **one call, one result.** Returning a summary after every step means 5 steps = 5× tokens, so search, fetch, filtering and extraction all happen inside the host process.

## Install

```bash
dsh plugin --profile <profile> add github:KNLCXY/dsh-websift
# or, from a checkout / a tarball:
dsh plugin --profile <profile> add "file:/absolute/path/dsh-websift"
```

Restart DSH afterwards — both the host and the client half are assembled at process start.

**The browser path is auto-detected** — leave `chromePath` empty and the plugin probes `DSH_CHROME`,
then installed Chrome / Edge / Brave / Chromium, then a bounded scan of `%LOCALAPPDATA%`, `%APPDATA%`,
`Program Files`, `~/Desktop` and `DSH/resources` (depth 4–5; it also recognises 豆包 / quark / 360 / QQ /
Sogou / UC / Liebao / Vivaldi / Opera, but prefers a real browser).

Only if detection fails, point it at one explicitly:

```jsonc
// ~/.dsh/storages/websift/settings.json
{ "chromePath": "C:/Program Files/Google/Chrome/Application/chrome.exe" }
```

or **Settings → 浏览器代理 → 自定义 → 内核路径**. Any Chromium that accepts `--remote-debugging-port` works (Chrome, Edge, Brave, OCS's bundled build…). Adjust `proxyUrl` / `proxySites` if you don't run Clash on `127.0.0.1:7897`.

## Tools

### `browser`

| Param | Default | Notes |
|---|---|---|
| `url` | required | full URL with scheme |
| `action` | `text` | `text` / `html` / `eval` / `screenshot` / `login` |
| `js` | — | expression for `action=eval` |
| `wait_ms` | `600` | extra wait after `readyState`; 1500–3000 for SPAs |
| `max_chars` | `4000` | text cap |
| `proxy` | from settings | per-call override: `auto` / `always` / `never` |
| `full_page` | `true` | full-page screenshot |
| `out` | `~/.dsh/storages/websift/shots/` | screenshot path |
| `actions` | — | JSON array (≤12) of `{click}`, `{wait}`, `{scroll}`, `{type:{selector,text}}` executed before extracting — batch work, one summary |
| `wait_until` | — | for `login`: selector that means success |
| `timeout_s` | `180` | `login` timeout (20–600) |

`action:"login"` forces a visible window, injects a 「✅ 我已登录 / ✕」bar into the page and waits for **you** to log in (QR, password, OTP — the plugin never sees your password). Cookies stay in the plugin's own profile; the tab is never closed.

### `web_find`

| Param | Default | Notes |
|---|---|---|
| `query` | required | chatty phrasing is reduced to keywords |
| `engine` | `auto` | Bing → Google → Baidu fallback, or pin one (`bing` / `google` / `baidu` / `360`) |
| `aliases` | — | up to 4 comma-separated variants, each searched |
| `limit` | `8` | 3–15 |
| `proxy` | from settings | per-call override |

Returns a fixed three-part answer — **adopted / dropped / dig deeper** — with titles and real URLs, and drops junk titles (homepages, bare domains, symbol soup).

### `web_digest`

| Param | Default | Notes |
|---|---|---|
| `query` | — | optional when `urls` is given |
| `urls` | — | comma/space separated, skips search |
| `max_pages` | `3` | 1–6, one page per site for source diversity |
| `budget_chars` | `3000` | 600–20000 |
| `allow_browser` | `true` | escalate to the real browser when HTTP fails |
| `strict` | `false` | stricter title/body relevance gate |
| `links_only` | `false` | return ranked links only |

Pipeline (all in-process, **no model calls**, so zero extra tokens):

1. **Query cleanup** — strips "please search for…", splits aliases
2. **Dedupe + cache** — normalized URLs, 15 min TTL, 60 entries
3. **Fetch** — `ctx.web.fetch()` first, then the real browser (direct → proxy fallback)
4. **Relevance gate** — a page counts only if the query terms actually appear (≥2 terms or ≥30%); non-matching pages are listed and skipped, and **if nothing matches it returns candidate links instead of inventing a digest**
5. **Extraction** — sentence scoring (term hits + paragraph feel − short-line penalty), adjacent sentences merged into paragraphs, cross-page dedupe, packed to budget

Every answer starts with a ledger, e.g. `pages 2/3 ok · body 7735 chars → digest 869 chars (89% saved) · ~3094 → 348 tokens`.

It is **extractive, not abstractive**: it picks original sentences, so it cannot hallucinate, but it can read a little choppy. Numbers with units (km, kg, MB, ms, %, …) are exempt from the relevance gate, because when you ask for a figure, the figure *is* the answer.

### `browser_proxy`

`status` / `set` / `test` / `stop`, with `mode: auto|always|never`. Writes to `~/.dsh/storages/websift/settings.json`, which takes precedence over the plugin config and applies immediately.

## Proxy modes

| Mode | Behaviour |
|---|---|
| `auto` (default) | per-domain HEAD probe (2.5 s): direct if reachable, proxy otherwise; cached 10 min |
| `always` | everything through the proxy |
| `never` | everything direct |

A single global switch doesn't work in both directions at once: domestic sites are slower through the proxy, while blocked domains get DNS-poisoned when direct. The browser is proxied via the `--proxy-server` launch flag, not the system proxy — so the plugin can use a proxy while the rest of the machine stays direct.

## Token evidence

Long-page budget was chosen from a three-run benchmark (32k-character Python docs):

| Budget | tokens | probe recall | cost per recall point |
|---|---|---|---|
| 1200 (old, global) | 461 | 28% | 16.5 |
| 2000 | 708 | 33% | 21.5 |
| **3000** | **1165** | **61%** | **19.1** |
| 4000 | 1535 | 67% | 22.9 |

3000 is the knee: +25% budget buys only +6 pp. Tiers: short (≤3k chars) 1200, mid (3–15k) 1200, long (15–50k) 3000 split across head/middle/tail by term hits, huge (>50k) 4000. Measured compression: GitHub repo page 7,579 → 759 chars (90%); two-page search 7,735 → 869 (89%).

## Constraints

- **`--no-sandbox` is required** when the kernel lives under a restricted directory (Chromium's sandbox can't read its own executable there).
- **~16 processes / ~700 MB** while alive; auto-closes after 5 idle minutes, relaunches in 3–6 s.
- **Separate cookie jar** — it does not reuse your daily Chrome profile; log in once via `action:"login"`.
- **`navigator.webdriver` is now false** (0.9.8 adds `--disable-blink-features=AutomationControlled`), so editors such as GitHub's file editor render normally.
- Zero runtime dependencies: CDP over Node's built-in `WebSocket`. No Playwright, no Puppeteer.

## Docs

- [README.md](README.md) — full Chinese manual (tool reference, every config key, troubleshooting)
- [docs/MANUAL.md](docs/MANUAL.md) — the long-form manual
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — internals: CDP lifecycle, proxy routing, digest stages, login state machine
- [CHANGELOG.md](CHANGELOG.md), [CONTRIBUTING.md](CONTRIBUTING.md)

## License

[MIT](LICENSE) © KNLCXY. Not affiliated with Google or DeepSeek.
