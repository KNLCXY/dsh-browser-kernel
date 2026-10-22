// 同一页面：直连 vs 走代理，整页加载差多少
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = String.raw`C:\Users\Administrator\Desktop\ocs-2.9.24-setup-win-x64\resources\bin\chrome\chrome\chrome.exe`;
const URL_ = 'https://gamebanana.com/search?_sSearchString=yyzj';

async function up(port) { try { const r = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1200) }); return r.ok } catch { return false } }
async function ensure(port, proxy) {
  if (await up(port)) return;
  const args = ['--headless=new', '--no-sandbox', '--disable-gpu', `--user-data-dir=C:\\Users\\Administrator\\AppData\\Local\\Temp\\p${port}`, `--remote-debugging-port=${port}`, 'about:blank'];
  if (proxy) args.unshift(`--proxy-server=${proxy}`);
  const { spawn } = await import('node:child_process');
  spawn(CHROME, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  for (let i = 0; i < 40 && !(await up(port)); i++) await sleep(500);
}
function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl); const pending = new Map(); let id = 0;
    ws.addEventListener('open', () => resolve(api));
    ws.addEventListener('error', () => reject(new Error('ws')));
    ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id === undefined) return; const p = pending.get(m.id); if (!p) return; pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); });
    const api = {
      send(method, params = {}) { const mid = ++id; return new Promise((res, rej) => { pending.set(mid, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id: mid, method, params })); }); },
      close() { try { ws.close(); } catch {} },
    };
  });
}
async function measure(port) {
  const base = `http://127.0.0.1:${port}`;
  const t = await fetch(base + '/json/new?about:blank', { method: 'PUT' }).then((r) => r.json());
  const cdp = await connect(t.webSocketDebuggerUrl);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  const t0 = Date.now();
  await cdp.send('Page.navigate', { url: URL_ });
  let ready = '';
  for (let i = 0; i < 240; i++) {
    const r = await cdp.send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true });
    ready = r.result?.value || '';
    if (ready === 'complete') break;
    await sleep(250);
  }
  const ms = Date.now() - t0;
  cdp.close();
  await fetch(`${base}/json/close/${t.id}`).catch(() => {});
  return { ms, ready };
}

await ensure(9333, null);
await ensure(9344, 'http://127.0.0.1:7897');
for (const [label, port] of [['直连', 9333], ['代理', 9344], ['直连', 9333], ['代理', 9344]]) {
  const r = await measure(port);
  console.log(`${label}  ${(r.ms / 1000).toFixed(1)}s  readyState=${r.ready}`);
}
