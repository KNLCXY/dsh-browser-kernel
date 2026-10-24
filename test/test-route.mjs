import { loadPlugin } from './_setup.mjs'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * 路由决策的安全性：**探测失败时不能把请求塞给一个已经死掉的代理**。
 *
 * 实测过的坏情况：代理端口没人监听 + 直连探测偶发失败 → 旧代码无条件判「走代理」，
 * 于是所有抓取都报 ERR_CONNECTION_CLOSED，看起来像「网络坏了」，其实是自己被路由到死端口上了。
 *
 * 为了确定性，本测试会**临时**把设置里的 proxyUrl 指到一个必定没人监听的端口（127.0.0.1:1），
 * 跑完在 finally 里原样还原。
 */
const DEAD_PROXY = 'http://127.0.0.1:1'
const SETTINGS = join(homedir(), '.dsh', 'storages', 'websift', 'settings.json')
const original = existsSync(SETTINGS) ? readFileSync(SETTINGS, 'utf8') : null

function writeSettings(patch) {
  const base = original ? JSON.parse(original) : {}
  writeFileSync(SETTINGS, JSON.stringify({ ...base, ...patch }, null, 2), 'utf8')
}
function restore() {
  if (original === null) return
  writeFileSync(SETTINGS, original, 'utf8')
}

let pass = false
try {
  writeSettings({ proxyUrl: DEAD_PROXY, proxyMode: 'auto', autoStartClash: false })

  const { mod } = await loadPlugin()
  // 让直连探测抛异常：这正是旧代码把请求交给死代理的那条分支
  globalThis.fetch = async () => { throw new Error('probe failed (this test)') }

  const tools = []
  const ctx = {
    tools: { register: (t) => { tools.push(t); return () => {} } },
    get: () => undefined,
    effect: (fn) => { fn() },
  }
  mod.apply(ctx, {})

  const proxyTool = tools.find((t) => t.name === 'browser_proxy')
  if (!proxyTool) throw new Error('没找到 browser_proxy 工具')

  const out = await proxyTool.execute({ action: 'test', url: 'https://example.com/' }, {})
  const text = proxyTool.output.render({}, out)[0].text
  console.log(text.trim())
  console.log(`\n代理地址（测试注入）: ${DEAD_PROXY} —— 必定没人监听`)
  console.log(`判定结果: ${text.includes('走代理') ? '走代理 ❌' : '直连 ✅'}`)
  pass = !text.includes('走代理')
} finally {
  restore()
}

console.log(
  pass
    ? '\n✅ 通过：代理不在线时，即使直连探测失败也不会走代理'
    : '\n❌ 失败：代理不在线却仍被判成走代理',
)
process.exit(pass ? 0 : 1)