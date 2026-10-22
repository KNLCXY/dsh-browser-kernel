// 定参数：旧版（全局 1200） vs 新版分级（长页 2000/3000/4000），3 轮
import { dirname, join as pathJoin } from 'node:path';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SRC = fileURLToPath(new URL('../lib/index.js', import.meta.url));
const TOOLS = process.env.DSH_TOOLS || 'C:/Users/Administrator/Desktop/DeepSeek Harness/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js';
const TOOLS_IMPORT = existsSync(TOOLS) ? `from '${pathToFileURL(TOOLS).href}'` : "from 'data:text/javascript,export const defineTool = (d) => d'";
const OUT = 'C:/Users/Administrator/AppData/Local/Temp/bk-final.mjs';
writeFileSync(OUT, readFileSync(SRC, 'utf8').replace("from '@deepseek-ai/dsh-tools'", TOOLS_IMPORT), 'utf8');
writeFileSync(pathJoin(dirname(OUT), 'rank.js'), readFileSync(pathJoin(dirname(SRC), 'rank.js'), 'utf8'), 'utf8');
const mod = await import(pathToFileURL(OUT).href + '?t=' + Date.now());
const { stripHtml, pickSentences, queryTerms, extractSmart, EXTRACT_POLICY } = mod.__bench;

const PAGES = [
  { bucket: '短', name: 'clashindex', url: 'https://clashindex.com/zh-CN/blog/articles/tun-vs-system-proxy.html' },
  { bucket: '中', name: 'httpbin/html', url: 'https://httpbin.org/html' },
  { bucket: '中', name: 'mdn-http', url: 'https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Guides/Overview' },
  { bucket: '长', name: 'py-urllib', url: 'https://docs.python.org/zh-cn/3/library/urllib.request.html' },
];

const cache = new Map();
async function loadText(url) {
  if (cache.has(url)) return cache.get(url);
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(25000), headers: { 'user-agent': 'Mozilla/5.0' } });
      const text = stripHtml(await res.text());
      cache.set(url, text);
      return text;
    } catch { await new Promise((r) => setTimeout(r, 700)); }
  }
  cache.set(url, '');
  return '';
}

const tokens = (s) => Math.round(s.length / 2.5);
const join = (picked) => picked.map((p) => p.text).join(' ');

const VARIANTS = {
  '旧版 全局1200': (text, terms) => join(pickSentences(text, terms, 1200).picked),
  '新版 长2000': (text, terms) => join(extractSmart(text, terms, { ...EXTRACT_POLICY, longBudget: 2000 }).picked),
  '新版 长3000': (text, terms) => join(extractSmart(text, terms, { ...EXTRACT_POLICY, longBudget: 3000 }).picked),
  '新版 长4000': (text, terms) => join(extractSmart(text, terms, { ...EXTRACT_POLICY, longBudget: 4000 }).picked),
};

function rng(seed) { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }
function markersFor(text, seed) {
  const rand = rng(seed);
  const third = Math.floor(text.length / 3);
  const picks = [];
  for (let part = 0; part < 3; part++) {
    const slice = text.slice(part * third, (part + 1) * third).toLowerCase();
    const cands = [...new Set([...slice.matchAll(/[\u4e00-\u9fff]{2}|[A-Za-z][A-Za-z0-9_-]{4,}/g)].map((m) => m[0].toLowerCase()))]
      .filter((t) => slice.split(t).length - 1 >= 2);
    for (let i = 0; i < 2 && cands.length; i++) picks.push({ term: cands.splice(Math.floor(rand() * cands.length), 1)[0], part });
  }
  return picks;
}

const records = [];
for (const p of PAGES) {
  const text = await loadText(p.url);
  if (text.length < 500) { console.log(`\n=== ${p.bucket} · ${p.name} · 抓取失败，跳过 ===`); continue; }
  const terms = queryTerms(p.name);
  console.log(`\n=== ${p.bucket} · ${p.name} · ${text.length} 字符 ===`);
  const rows = [];
  for (let round = 1; round <= 3; round++) {
    const markers = markersFor(text, 7919 * round + p.name.length);
    const row = {};
    for (const [label, fn] of Object.entries(VARIANTS)) {
      const out = fn(text, terms);
      const low = out.toLowerCase();
      row[label] = {
        tok: tokens(out),
        recall: markers.filter((m) => low.includes(m.term)).length / Math.max(1, markers.length),
        parts: [0, 1, 2].map((part) => {
          const ms = markers.filter((m) => m.part === part);
          return ms.length ? ms.filter((m) => low.includes(m.term)).length / ms.length : 0;
        }),
      };
    }
    rows.push(row);
  }
  for (const label of Object.keys(VARIANTS)) {
    const avg = (key) => rows.reduce((a, r) => a + r[label][key], 0) / rows.length;
    const parts = [0, 1, 2].map((i) => rows.reduce((a, r) => a + r[label].parts[i], 0) / rows.length);
    console.log(
      `  ${label.padEnd(12)} ${String(Math.round(avg('tok'))).padStart(5)} tok · 召回 ${(avg('recall') * 100).toFixed(0).padStart(3)}%` +
      ` · 前/中/后 ${parts.map((v) => (v * 100).toFixed(0) + '%').join('/')}`,
    );
    records.push({ bucket: p.bucket, version: label, tok: avg('tok'), recall: avg('recall') });
  }
}

console.log('\n============ 汇总（按桶平均） ============');
console.log('桶   版本           tokens   召回');
for (const bucket of ['短', '中', '长']) {
  for (const label of Object.keys(VARIANTS)) {
    const rows = records.filter((r) => r.bucket === bucket && r.version === label);
    if (!rows.length) continue;
    const tok = rows.reduce((a, r) => a + r.tok, 0) / rows.length;
    const rec = rows.reduce((a, r) => a + r.recall, 0) / rows.length;
    console.log(`${bucket}   ${label.padEnd(12)} ${String(Math.round(tok)).padStart(7)}   ${(rec * 100).toFixed(0).padStart(3)}%`);
  }
}
