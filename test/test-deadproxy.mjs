import { loadPlugin } from './_setup.mjs'
import { createServer } from 'node:net'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * 「端口在监听」≠「代理能用」。
 *
 * 实测过的坏情况：Clash Verge 进程活着、7897 也在监听，但所有节点都挂了 ——
 * 代理对任何网址都返回空。旧代码只做 TCP 连接测试，于是判「代理在线」，
 * 把浏览器指到 `--proxy-server=死端口`，每个页面都变成「无法访问此网站」的白屏，
 * 可视模式下就是桌面上一个卡住的白框（用户实际报过）。
 *
 * 本测试用两个本地假代理做确定性验证，不依赖外网、不依赖真实 Clash：
 *   A 只接受连接、永不响应  → 必须判「不可用」，路由不能选代理
 *   B 正常回一个 204        → 必须判「能真的转发」
 *
 * 为了确定性，会**临时**改写设置里的 proxyUrl，跑完在 finally 里原样还原。
 */
const SETTINGS = join(homedir(), '.dsh', 'storages', 'websift', 'settings.json')
const original = existsSync(SETTINGS) ? readFileSync(SETTINGS, 'utf8') : null
const base = original ? JSON.parse(original) : {}

function useProxy (url) {
  writeFileSync(SETTINGS, JSON.stringify({
    ...base,
    proxyUrl: url,
    proxyMode: 'auto',
    autoStartClash: false,
  }, null, 2), 'utf8')
}

function server (onData) {
  const s = createServer((socket) => {
    socket.on('error', () => {})
    if (onData) socket.once('data', () => onData(socket))
  })
  return new Promise((resolve) => s.listen(0, '127.0.0.1', () => resolve(s)))
}

async function ask (proxyUrl) {
  useProxy(proxyUrl)
  const { mod } = await loadPlugin()
  const tools = []
  mod.apply({
    tools: { register: (t) => { tools.push(t); return () => {} } },
    get: () => undefined,
    effect: (fn) => { fn() },
  }, {})
  const tool = tools.find((t) => t.name === 'browser_proxy')
  const out = await tool.execute({ action: 'test', url: 'https://example.com/' }, {})
  return tool.output.render({}, out)[0].text
}

let bad = 0
const check = (name, pass, extra = '') => {
  console.log(`${pass ? '✅' : '❌'} ${name}${extra ? '  ' + extra : ''}`)
  if (!pass) bad++
}

const dead = await server(null)                                  // A：接受连接，永不响应
const live = await server((socket) => {                          // B：像正常 HTTP 代理那样回一个 204
  socket.end('HTTP/1.1 204 No Content\r\nContent-Length: 0\r\nConnection: close\r\n\r\n')
})

try {
  const a = await ask(`http://127.0.0.1:${dead.address().port}`)
  console.log('--- A：端口在监听、转发不通 ---')
  console.log(a + '\n')
  check('判为「转发不通」', a.includes('转发不通'), '')
  check('不把请求路由到代理', !a.includes('走代理'), a.split('\n')[0])
  check('路由退回直连', /→ \*\*直连\*\*/.test(a), '')

  const b = await ask(`http://127.0.0.1:${live.address().port}`)
  console.log('--- B：能真的转发 ---')
  console.log(b + '\n')
  check('判为「能真的转发」', b.includes('能真的转发'), '')
  check('不误报为不通', !b.includes('转发不通'), '')
} finally {
  if (original !== null) writeFileSync(SETTINGS, original, 'utf8')
  dead.close()
  live.close()
}

console.log(bad === 0 ? '\n全部通过' : `\n${bad} 项未通过`)
process.exit(bad === 0 ? 0 : 1)