// ⚠️ 手动诊断脚本（没有断言）。它注入 web.fetch 桩，想测的是「HTTP 直连 + JSON 压缩」那一档，
// 但插件只在 `settings.stack === 'official'` 时才走官方 fetch：实盘设置是 `stack: "plugin"`
// 时这条链路会被整段跳过，配合 allow_browser:false 只会得到「一页正文都没取到」。
// 要真的测 JSON 压缩，先把设置里的 stack 改成 official。
import { loadPlugin } from './_setup.mjs'

// 插件源码里的 '@deepseek-ai/dsh-tools' 会被指到 DSH 里的真实实现；
// 找不到时退化成桩（纯逻辑测试仍可跑）。要显式指定：DSH_TOOLS=/path/to/dsh-tools/lib/index.js
const { mod, toolsPath } = await loadPlugin()
if (!toolsPath) console.warn('⚠️  没找到 DSH 的 @deepseek-ai/dsh-tools，使用桩实现')
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
