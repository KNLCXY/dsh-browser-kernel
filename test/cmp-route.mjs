// 对照实验：把 proxyUrl 指向一个「只接受 TCP 连接、永远不回数据」的假代理
// （= 实测到的 Clash 状态：端口在监听，但转发能力为零），
// 看不同版本会把这个请求路由到哪去。
//
// 用法: ELECTRON_RUN_AS_NODE=1 <exe> cmp-route.mjs <lib 目录> <标签>
import { createServer } from 'node:net'
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const LIB = process.argv[2]
const LABEL = process.argv[3] || LIB
const SETTINGS = join(homedir(), '.dsh', 'storages', 'websift', 'settings.json')
const original = existsSync(SETTINGS) ? readFileSync(SETTINGS, 'utf8') : null

const TOOLS_GUESS = 'C:/Users/Administrator/Desktop/DeepSeek Harness/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js'
const STUB = "from 'data:text/javascript,export const defineTool = (d) => d'"

// 假代理：接受连接后**什么都不做**（不回响应、不关闭）
const fake = createServer((socket) => { socket.on('error', () => {}) })
await new Promise((r) => fake.listen(0, '127.0.0.1', r))
const port = fake.address().port
const FAKE_PROXY = `http://127.0.0.1:${port}`

async function loadPlugin(libDir) {
  const dir = mkdtempSync(join(tmpdir(), 'cmp-'))
  for (const f of readdirSync(libDir)) {
    if (!f.endsWith('.js')) continue
    const code = readFileSync(join(libDir, f), 'utf8').replace(
      /from '@deepseek-ai\/dsh-tools'/,
      existsSync(TOOLS_GUESS) ? `from ${JSON.stringify(pathToFileURL(TOOLS_GUESS).href)}` : STUB,
    )
    writeFileSync(join(dir, f), code, 'utf8')
  }
  return import(pathToFileURL(join(dir, 'index.js')).href + '?t=' + Date.now())
}

const base = original ? JSON.parse(original) : {}
writeFileSync(SETTINGS, JSON.stringify({
  ...base,
  proxyUrl: FAKE_PROXY,
  proxyMode: 'auto',
  autoStartClash: false,
  proxySites: 'github.com, githubusercontent.com, google.com, youtube.com, x.com, twitter.com',
}, null, 2), 'utf8')

const URLLIST = ['https://example.com/', 'https://www.google.com/', 'https://github.com/']

try {
  const mod = await loadPlugin(LIB)
  const tools = []
  mod.apply({
    tools: { register: (t) => { tools.push(t); return () => {} } },
    get: () => undefined,
    effect: (fn) => { fn() },
  }, {})
  const proxyTool = tools.find((t) => t.name === 'browser_proxy')
  console.log(`\n########## ${LABEL} ##########`)
  console.log(`假代理 ${FAKE_PROXY}（接受连接，永不响应）\n`)
  for (const url of URLLIST) {
    const out = await proxyTool.execute({ action: 'test', url }, {})
    const text = proxyTool.output.render({}, out)[0].text
    const first = String(text).split('\n')[0]
    console.log(`  ${first}`)
  }
} finally {
  if (original !== null) writeFileSync(SETTINGS, original, 'utf8')
  fake.close()
}