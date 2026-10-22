import { loadPlugin } from './_setup.mjs'

// 插件源码里的 '@deepseek-ai/dsh-tools' 会被指到 DSH 里的真实实现；
// 找不到时退化成桩（纯逻辑测试仍可跑）。要显式指定：DSH_TOOLS=/path/to/dsh-tools/lib/index.js
const { mod, toolsPath } = await loadPlugin()
if (!toolsPath) console.warn('⚠️  没找到 DSH 的 @deepseek-ai/dsh-tools，使用桩实现')
const tools = [];
mod.apply({
  tools: { register: (t) => tools.push(t) },
  get: () => undefined,
  effect: (f) => f(),
}, {});
console.log('tools:', tools.map((t) => t.name).join(', '));

const find = tools.find((t) => t.name === 'web_find');
for (const q of ['clash verge tun 模式 系统代理 区别']) {
  console.log('\n===== ' + q + ' =====');
  const out = await find.execute({ query: q, limit: 6 }, {});
  console.log(out.text);
}
