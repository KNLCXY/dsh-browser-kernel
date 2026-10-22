import { loadPlugin } from './_setup.mjs'

// 插件源码里的 '@deepseek-ai/dsh-tools' 会被指到 DSH 里的真实实现；
// 找不到时退化成桩（纯逻辑测试仍可跑）。要显式指定：DSH_TOOLS=/path/to/dsh-tools/lib/index.js
const { mod, toolsPath } = await loadPlugin()
if (!toolsPath) console.warn('⚠️  没找到 DSH 的 @deepseek-ai/dsh-tools，使用桩实现')
console.log('plugin name:', mod.name, '| inject:', mod.inject);

const tools = [];
const ctx = {
  tools: { register: (t) => { tools.push(t); return () => {}; } },
  logger: { info: console.log, warn: console.warn, error: console.error },
};

mod.apply(ctx, {}); // 不传 config：走默认值
console.log('registered:', tools.map((t) => t.name));
const browser = tools.find((t) => t.name === 'browser');
const proxyTool = tools.find((t) => t.name === 'browser_proxy');
console.log('browser keys:', Object.keys(browser));

const show = (label, value) => {
  console.log('\n========== ' + label + ' ==========');
  try {
    const text = browser.output?.render ? browser.output.render({ max_chars: 800 }, value)[0].text : JSON.stringify(value);
    console.log(text.slice(0, 1200));
  } catch (e) {
    console.log('render failed:', e.message, JSON.stringify(value).slice(0, 400));
  }
};

// 1) 强制走代理打开一个被墙的站点（google 首页）
show('browser: google (proxy=always)', await browser.execute({ url: 'https://www.google.com/', proxy: 'always', max_chars: 400 }, {}));

// 2) 自动模式：国内可达站点应判直连
show('browser: bing (proxy=auto)', await browser.execute({ url: 'https://www.bing.com/', proxy: 'auto', wait_ms: 800, max_chars: 400 }, {}));

// 3) eval 动作
show('browser: eval', await browser.execute({ url: 'https://example.com/', action: 'eval', js: 'JSON.stringify({t:document.title, links:document.querySelectorAll("a").length})', proxy: 'auto' }, {}));

// 4) 代理状态 / 探测 / 切换
console.log('\n========== browser_proxy: status ==========');
console.log((await proxyTool.execute({ action: 'status' }, {})).text);

console.log('\n========== browser_proxy: test google ==========');
console.log((await proxyTool.execute({ action: 'test', url: 'google.com' }, {})).text);

console.log('\n========== browser_proxy: set auto ==========');
console.log((await proxyTool.execute({ action: 'set', mode: 'auto' }, {})).text);

console.log('\n========== browser: screenshot ==========');
const shot = await browser.execute({ url: 'https://example.com/', action: 'screenshot', out: 'C:/Users/Administrator/AppData/Local/Temp/bk-shot.png' }, {});
console.log(browser.output.render({}, shot)[0].text);

// 5) 设置页用的 HTTP 路由：用假 webServer 抓注册，再直接打 handler
console.log('\n========== HTTP route: /_browser-kernel/settings ==========');
const { Readable } = await import('node:stream');
const routes = [];
const webServer = { register: (r) => { routes.push(r); return () => {}; } };
const ctx2 = {
  tools: { register: () => () => {} },
  get: (n) => (n === 'webServer' ? webServer : undefined),
  effect: (fn) => { fn(); },
};
mod.apply(ctx2, {});
console.log('registered routes:', routes.map((r) => r.path));

const fakeRes = () => {
  const out = { status: 0, body: '' };
  return {
    out,
    writeHead(status) { out.status = status; },
    end(chunk) { out.body += chunk ? String(chunk) : ''; },
  };
};
const route = routes.find((r) => r.path === '/_browser-kernel/settings');

const getRes = fakeRes();
await route.handler({ method: 'GET' }, getRes);
console.log('GET  →', getRes.out.status, getRes.out.body);

const postRes = fakeRes();
await route.handler(
  { method: 'POST', [Symbol.asyncIterator]: () => Readable.from([Buffer.from(JSON.stringify({ mode: 'never' }))])[Symbol.asyncIterator]() },
  postRes,
);
console.log('POST never →', postRes.out.status, postRes.out.body);

const badRes = fakeRes();
await route.handler(
  { method: 'POST', [Symbol.asyncIterator]: () => Readable.from([Buffer.from(JSON.stringify({ mode: 'bogus' }))])[Symbol.asyncIterator]() },
  badRes,
);
console.log('POST bogus →', badRes.out.status, badRes.out.body);

// 还原成 auto，别把用户设置改成 never
const backRes = fakeRes();
await route.handler(
  { method: 'POST', [Symbol.asyncIterator]: () => Readable.from([Buffer.from(JSON.stringify({ mode: 'auto' }))])[Symbol.asyncIterator]() },
  backRes,
);
console.log('POST auto →', backRes.out.status, backRes.out.body);

// 6) 自定义字段：合法值 / 非法值 / reset
async function postJson(body) {
  const res = fakeRes();
  await route.handler(
    { method: 'POST', [Symbol.asyncIterator]: () => Readable.from([Buffer.from(JSON.stringify(body))])[Symbol.asyncIterator]() },
    res,
  );
  const parsed = (() => { try { return JSON.parse(res.out.body); } catch { return {}; } })();
  return { status: res.out.status, json: parsed };
}

console.log('\n========== 自定义字段校验 ==========');
const custom = await postJson({ proxyUrl: 'http://127.0.0.1:7897', idleMs: 600000, chromePath: 'C:/Users/Administrator/Desktop/ocs-2.9.24-setup-win-x64/resources/bin/chrome/chrome/chrome.exe' });
console.log('合法 patch      →', custom.status, 'idleMs=' + custom.json.idleMs, 'proxyUrl=' + custom.json.proxyUrl);

console.log('坏代理地址      →', (await postJson({ proxyUrl: 'nonsense' })).status, (await postJson({ proxyUrl: 'nonsense' })).json.error);
console.log('空闲太短        →', (await postJson({ idleMs: 1000 })).status, (await postJson({ idleMs: 1000 })).json.error);
console.log('内核路径非 exe  →', (await postJson({ chromePath: 'C:/foo/bar' })).status, (await postJson({ chromePath: 'C:/foo/bar' })).json.error);
console.log('端口越界        →', (await postJson({ port: 80 })).status, (await postJson({ port: 80 })).json.error);
console.log('空 patch        →', (await postJson({})).status, (await postJson({})).json.error);

const back = await postJson({ reset: true });
console.log('reset           →', back.status, 'mode=' + back.json.mode, 'idleMs=' + back.json.idleMs, 'port=' + back.json.port);

