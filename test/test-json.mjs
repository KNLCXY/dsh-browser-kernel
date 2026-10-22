// 测 JSON 直读：把 GameBanana API 的响应喂给 web_digest，看压成多少字
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const SRC = 'C:/Users/Administrator/Documents/deepseek-harness/default-workspace/plugins/dsh-browser-kernel/lib/index.js';
const TOOLS = 'C:/Users/Administrator/Desktop/DeepSeek Harness/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js';
const OUT = 'C:/Users/Administrator/AppData/Local/Temp/bk-json.mjs';
writeFileSync(OUT, readFileSync(SRC, 'utf8').replace("from '@deepseek-ai/dsh-tools'", `from '${pathToFileURL(TOOLS).href}'`), 'utf8');
const mod = await import(pathToFileURL(OUT).href + '?t=' + Date.now());

const API = 'https://gamebanana.com/apiv11/Util/Search/Results?_sSearchString=yyzj&_sModelName=Mod&_nPerpage=15&_nPage=1';

const web = {
  async search() { return { sources: [] }; },
  async fetch(request) {
    const res = await fetch(request.url, { signal: AbortSignal.timeout(20000) });
    const content = await res.text();
    const ct = res.headers.get('content-type') || '';
    return { url: request.url, statusCode: res.status, body: { kind: ct.includes('html') ? 'html' : 'text', content }, truncated: false };
  },
};

const tools = [];
mod.apply({ tools: { register: (t) => tools.push(t) }, get: (n) => (n === 'web' ? web : undefined), effect: (f) => f() }, {});
const digest = tools.find((t) => t.name === 'web_digest');

const out = await digest.execute({ urls: API, max_pages: 1, budget_chars: 1500, allow_browser: false }, {});
const text = digest.output.render({}, out)[0].text;
console.log(text.slice(0, 1600));
console.log('\n--- 原始 JSON 大小 ---');
const raw = await (await fetch(API)).text();
console.log('raw', raw.length, 'chars ≈', Math.round(raw.length / 2.5), 'tokens');
console.log('digest', text.length, 'chars ≈', Math.round(text.length / 2.5), 'tokens');
