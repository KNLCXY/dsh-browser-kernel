// 测 web_digest：用假 ctx + 真实网络的 web stub（search 返回固定链接，fetch 真抓）
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const SRC = 'C:/Users/Administrator/Documents/deepseek-harness/default-workspace/plugins/dsh-browser-kernel/lib/index.js';
const TOOLS = 'C:/Users/Administrator/Desktop/DeepSeek Harness/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js';
const OUT = 'C:/Users/Administrator/AppData/Local/Temp/bk-digest.mjs';

const src = readFileSync(SRC, 'utf8').replace(
  "from '@deepseek-ai/dsh-tools'",
  `from '${pathToFileURL(TOOLS).href}'`,
);
writeFileSync(OUT, src, 'utf8');

const mod = await import(pathToFileURL(OUT).href + '?t=' + Date.now());

const SOURCES = [
  { url: 'https://github.com/cinob/dsh-web-search-multi', title: 'dsh-web-search-multi · GitHub' },
  { url: 'https://example.com/', title: 'Example Domain' },
  { url: 'https://this-host-does-not-exist-xyz.invalid/', title: 'Broken link' },
];

const web = {
  async search(request) {
    console.log('  [stub web.search]', JSON.stringify(request));
    return { sources: SOURCES, truncated: false };
  },
  async fetch(request) {
    const res = await fetch(request.url, { signal: AbortSignal.timeout(15000) });
    const contentType = res.headers.get('content-type') || '';
    const content = await res.text();
    const kind = contentType.includes('html') ? 'html' : 'text';
    return { url: request.url, statusCode: res.status, body: { kind, content }, truncated: false };
  },
};

const tools = [];
const ctx = {
  tools: { register: (t) => { tools.push(t); return () => {}; } },
  get: (n) => (n === 'web' ? web : undefined),
  effect: (fn) => { fn(); },
};
mod.apply(ctx, {});
console.log('registered:', tools.map((t) => t.name));

const digest = tools.find((t) => t.name === 'web_digest');
console.log('\n--- web_digest(query) ---');
const t0 = Date.now();
const out = await digest.execute({ query: 'deepseek harness plugin', max_pages: 3, budget_chars: 1200, allow_browser: false }, {});
console.log(digest.output.render({}, out)[0].text);
console.log('\n耗时', ((Date.now() - t0) / 1000).toFixed(1) + 's');

console.log('\n--- web_digest(urls, 单页) ---');
const out2 = await digest.execute({ urls: 'https://example.com/', max_pages: 1, budget_chars: 600, allow_browser: false }, {});
console.log(digest.output.render({}, out2)[0].text);

console.log('\n--- web_digest(urls, 允许升级浏览器) ---');
const out3 = await digest.execute({ urls: 'https://github.com/cinob/dsh-web-search-multi', max_pages: 1, budget_chars: 800, allow_browser: true }, {});
console.log(digest.output.render({}, out3)[0].text);

console.log('\n--- 找不到时的兜底（全部不相关）---');
const out4 = await digest.execute({ query: '量子计算 纠错', max_pages: 3, budget_chars: 800, allow_browser: false }, {});
console.log(digest.output.render({}, out4)[0].text);
