// 测 web_find：用真浏览器搜，看返回的是不是真实链接
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const SRC = 'C:/Users/Administrator/Documents/deepseek-harness/default-workspace/plugins/dsh-browser-kernel/lib/index.js';
const TOOLS = 'C:/Users/Administrator/Desktop/DeepSeek Harness/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js';
const OUT = 'C:/Users/Administrator/AppData/Local/Temp/bk-find.mjs';
writeFileSync(OUT, readFileSync(SRC, 'utf8').replace("from '@deepseek-ai/dsh-tools'", `from '${pathToFileURL(TOOLS).href}'`), 'utf8');
const mod = await import(pathToFileURL(OUT).href + '?t=' + Date.now());

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
