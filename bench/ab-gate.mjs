// A/B：硬门槛(0.7.2) vs 软门槛(0.7.3)，在真实的百科页面上比
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const SRC = 'C:/Users/Administrator/Documents/deepseek-harness/default-workspace/plugins/dsh-browser-kernel/lib/index.js';
const TOOLS = 'C:/Users/Administrator/Desktop/DeepSeek Harness/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js';
const OUT = 'C:/Users/Administrator/AppData/Local/Temp/bk-ab.mjs';
const CHROME = String.raw`C:\Users\Administrator\Desktop\ocs-2.9.24-setup-win-x64\resources\bin\chrome\chrome\chrome.exe`;

writeFileSync(OUT, readFileSync(SRC, 'utf8').replace("from '@deepseek-ai/dsh-tools'", `from '${pathToFileURL(TOOLS).href}'`), 'utf8');
const mod = await import(pathToFileURL(OUT).href + '?t=' + Date.now());
const { splitSentences, pickSentences, queryTerms, extractSmart } = mod.__bench;

// ---- 用真浏览器取正文（百科对纯 HTTP 返回 403）----
const base = 'http://127.0.0.1:9333';
async function up() { try { const r = await fetch(base + '/json/version', { signal: AbortSignal.timeout(1200) }); return r.ok } catch { return false } }
if (!(await up())) {
  const { spawn } = await import('node:child_process');
  spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--user-data-dir=C:\\Users\\Administrator\\AppData\\Local\\Temp\\ab-profile', '--remote-debugging-port=9333', 'about:blank'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  for (let i = 0; i < 40 && !(await up()); i++) await new Promise((r) => setTimeout(r, 500));
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
async function pageText(url, file) {
  if (existsSync(file)) return readFileSync(file, 'utf8');
  const t = await fetch(base + '/json/new?about:blank', { method: 'PUT' }).then((r) => r.json());
  const cdp = await connect(t.webSocketDebuggerUrl);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Page.navigate', { url });
  await new Promise((r) => setTimeout(r, 4000));
  const r = await cdp.send('Runtime.evaluate', { expression: 'document.body.innerText', returnByValue: true });
  cdp.close();
  await fetch(`${base}/json/close/${t.id}`).catch(() => {});
  const text = String(r.result?.value || '');
  writeFileSync(file, text, 'utf8');
  return text;
}

const CASES = [
  {
    name: '东风-41（短）',
    url: 'https://baike.baidu.com/item/%E4%B8%9C%E9%A3%8E-41%E6%B4%B2%E9%99%85%E6%88%98%E7%95%A5%E6%A0%B8%E5%AF%BC%E5%BC%B9/23783870',
    file: 'C:/Users/Administrator/AppData/Local/Temp/baike-df41.txt',
    query: '东风41 导弹类型 射程 洲际',
    title: '东风-41洲际战略核导弹_百度百科',
    budget: 1500,
    noise: ['东风-61', '东风-17', '东风-26'],
    answer: ['弹道导弹', '洲际'],
  },
  {
    name: 'PLC（长）',
    url: 'https://baike.baidu.com/item/%E5%8F%AF%E7%BC%96%E7%A8%8B%E9%80%BB%E8%BE%91%E6%8E%A7%E5%88%B6%E5%99%A8/84414',
    file: 'C:/Users/Administrator/AppData/Local/Temp/baike-plc.txt',
    query: 'PLC 中文全称 替代 继电器 梯形图',
    title: '可编程逻辑控制器（以微处理器为核心的一种通用工业自动控制装置）_百度百科',
    budget: 2000,
    noise: ['水压', 'Y-△', '降压启动'],
    answer: ['继电器', '梯形图'],
  },
];

const tokens = (s) => Math.round(s.length / 2.5);

/** 硬门槛版（0.7.2）：先过滤，再抽取 */
function hardGate(text, terms, title, budget) {
  const marks = String(title).match(/[A-Za-z]{2,}|\d{2,}/g) || [];
  const titleTerms = String(title).replace(/[（(][^）)]*[）)]/g, ' ').replace(/百度百科/g, ' ').split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2).slice(0, 4);
  let body = text;
  if (marks.length || titleTerms.length) {
    const all = splitSentences(text);
    const kept = all.filter((s) => {
      const low = s.text.toLowerCase();
      if (marks.length) return marks.some((m) => low.includes(String(m).toLowerCase()));
      return titleTerms.some((w) => low.includes(String(w).toLowerCase()));
    });
    if (kept.length >= 5) body = kept.map((s) => s.text).join('\n');
  }
  return pickSentences(body, terms, budget).picked.map((p) => p.text).join(' ');
}

console.log('case'.padEnd(14), '版本'.padEnd(8), 'tokens'.padStart(7), '噪音'.padStart(6), '答案'.padStart(6));
for (const c of CASES) {
  const text = await pageText(c.url, c.file);
  if (text.length < 500) { console.log(c.name, '抓取失败'); continue; }
  const terms = queryTerms(c.query);
  const marks = String(c.title).match(/[A-Za-z]{2,}|\d{2,}/g) || [];
  const titleTerms = String(c.title).replace(/[（(][^）)]*[）)]/g, ' ').replace(/百度百科/g, ' ').split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2).slice(0, 4);

  const hard = hardGate(text, terms, c.title, c.budget);
  const soft = extractSmart(text, terms, { ...mod.__bench.EXTRACT_POLICY, shortBudget: c.budget, midBudget: c.budget, longBudget: c.budget, hugeBudget: c.budget }, { distinctive: marks, titleTerms })
    .picked.map((p) => p.text).join(' ');

  for (const [label, out] of [['硬门槛', hard], ['软门槛', soft]]) {
    const noise = c.noise.filter((n) => out.includes(n)).length;
    const ans = c.answer.filter((a) => out.includes(a)).length;
    console.log(c.name.padEnd(14), label.padEnd(8), String(tokens(out)).padStart(7), `${noise}/${c.noise.length}`.padStart(6), `${ans}/${c.answer.length}`.padStart(6));
  }
}
