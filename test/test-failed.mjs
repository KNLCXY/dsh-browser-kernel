import { loadPlugin } from './_setup.mjs'

// 所有页面都取不到正文时，必须如实说「没取到」，不能伪装成「正文本来就短」。
const { mod } = await loadPlugin()

const web = {
  async search() { return { sources: [], truncated: false } },
  async fetch(request) { throw new Error(`模拟失败：${request.url}`) },
}

const tools = []
const ctx = {
  tools: { register: (t) => { tools.push(t); return () => {}; } },
  get: (n) => (n === 'web' ? web : undefined),
  effect: (fn) => { fn() },
}
mod.apply(ctx, {})

const digest = tools.find((t) => t.name === 'web_digest')
const out = await digest.execute(
  { urls: 'https://a.invalid/ https://b.invalid/', allow_browser: false, budget_chars: 600 },
  {},
)
const text = digest.output.render({}, out)[0].text
console.log(text)
console.log('\n--- 断言 ---')

const checks = [
  ['说出「一页正文都没取到」', text.includes('一页正文都没取到')],
  ['列出未取到的域名', text.includes('未取到：') && text.includes('a.invalid')],
  ['不再出现误导的「正文本来就短」', !text.includes('正文本来就短')],
]
let bad = 0
for (const [name, pass] of checks) {
  console.log(`${pass ? '✅' : '❌'} ${name}`)
  if (!pass) bad++
}
console.log(bad === 0 ? '\n全部通过' : `\n${bad} 项未通过`)
process.exit(bad === 0 ? 0 : 1)