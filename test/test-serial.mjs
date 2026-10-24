import { loadPlugin } from './_setup.mjs'
import { createServer } from 'node:http'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * 并发抓多页时的**张冠李戴**（竞态）。
 *
 * 背景：整个插件只复用**一个**工作标签（刻意的，见 pickTarget）。而 web_digest 用
 * `Promise.all` 并发抓多个链接 —— 并发导航同一个标签 = 互相覆盖，于是 A 站读到的可能是
 * B 站的 DOM。更糟的是错误内容会被写进 15 分钟页面缓存（缓存键取的是**请求** URL），
 * 之后一直以 `cached: true, ms: 0` 供应。
 *
 * 实盘踩到的样子（同一次会话内连续两次调用）：
 *   ① 两页调用：`重定向重复 1 条已合并`（两个不同 URL 抓回来的 final URL 相同）
 *   ② 紧接着单页查 example.com：标题是 iana 的「Example Domains」、正文是 iana 那段话，
 *      耗时 `0.0s`，并且「1257 字符 / 444 摘要 / 8 句取 1 句」与①完全相同 —— 缓存被投毒
 *
 * 本测试在本地起两个内容截然不同的页面，断言**每个 URL 都拿到自己的正文**。
 * 想验证这条测试真的能抓到 bug：拿修复前的 lib 跑一遍即可，应当失败 ——
 *   ELECTRON_RUN_AS_NODE=1 <exe> test/test-serial.mjs /path/to/old/lib
 *
 * 需要真浏览器（stack=plugin 走的就是浏览器那一档），本机会临时关掉可视模式，
 * 跑完还原设置并关掉内核。
 */
const SETTINGS = join(homedir(), '.dsh', 'storages', 'websift', 'settings.json')
const original = existsSync(SETTINGS) ? readFileSync(SETTINGS, 'utf8') : null
const base = original ? JSON.parse(original) : {}

const MARK_A = 'MARKER_ALPHA_9f3c'
const MARK_B = 'MARKER_BETA_5d1e'

// 正文要够长：浏览器那一档有「≥200 字才算成功」的门槛，太短会被判成「只拿到 N 字」
const filler = '为了把两个页面明确区分开，正文里反复出现只属于本页的标记词，并且刻意凑足长度，避免被「正文太短」的门槛挡住。'
const para = (mark, title) => `<p>${mark} 这一段只属于 ${title}。${filler}</p>`
const page = (title, mark, other) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head>
<body><h1>${title}</h1>
<p>${mark} 开头这一段只属于 ${title}。另一页的标记词是 ${other}，正常情况下不该出现在本页。</p>
${para(mark, title)}
${para(mark, title)}
${para(mark, title)}
${para(mark, title)}
${para(mark, title)}
</body></html>`

const server = createServer((req, res) => {
  if (req.url.startsWith('/alpha')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(page('ALPHA PAGE', MARK_A, MARK_B))
    return
  }
  if (req.url.startsWith('/beta')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(page('BETA PAGE', MARK_B, MARK_A))
    return
  }
  res.writeHead(404, { 'content-type': 'text/plain' })
  res.end('nope')
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const PORT = server.address().port
const URLS = `http://127.0.0.1:${PORT}/alpha http://127.0.0.1:${PORT}/beta`

writeFileSync(SETTINGS, JSON.stringify({
  ...base,
  stack: 'plugin',
  proxyMode: 'never',      // 本机地址，别让路由决策掺进来
  visible: false,          // 测试用 headless，不往桌面上弹窗
  autoStartClash: false,
}, null, 2), 'utf8')

const libArg = process.argv[2]
const { mod } = await loadPlugin(libArg)
const tools = []
mod.apply({
  tools: { register: (t) => { tools.push(t); return () => {} } },
  get: () => undefined,
  effect: (fn) => { fn() },
}, {})

const check = (name, pass, extra = '') => {
  console.log(`${pass ? '✅' : '❌'} ${name}${extra ? '  ' + extra : ''}`)
  if (!pass) bad++
}
let bad = 0

try {
  const digest = tools.find((t) => t.name === 'web_digest')
  const proxyTool = tools.find((t) => t.name === 'browser_proxy')
  const out = await digest.execute({ urls: URLS, max_pages: 2, budget_chars: 900 }, {})
  const text = digest.output.render({}, out)[0].text
  console.log(text + '\n--- 断言 ---')

  // 每条结果是一段「序号. 标题 — 域名 · … / URL / · 正文」
  const blocks = text.split(/\n(?=\d+\. )/).slice(1)
  const alpha = blocks.find((b) => b.includes('/alpha'))
  const beta = blocks.find((b) => b.includes('/beta'))

  check('两页都取到了', Boolean(alpha) && Boolean(beta),
    `blocks=${blocks.length}`)
  check('/alpha 拿到的是自己的正文', Boolean(alpha) && alpha.includes(MARK_A),
    alpha && alpha.includes(MARK_B) ? '拿到的是 /beta 的内容 ← 串了' : '')
  check('/beta 拿到的是自己的正文', Boolean(beta) && beta.includes(MARK_B),
    beta && beta.includes(MARK_A) ? '拿到的是 /alpha 的内容 ← 串了' : '')
  check('没有出现「重定向重复」合并（竞态指纹）', !text.includes('重定向重复'))

  await proxyTool.execute({ action: 'stop' }, {}).catch(() => {})
} finally {
  if (original !== null) writeFileSync(SETTINGS, original, 'utf8')
  server.close()
}

console.log(bad === 0 ? '\n全部通过' : `\n${bad} 项未通过`)
process.exit(bad === 0 ? 0 : 1)