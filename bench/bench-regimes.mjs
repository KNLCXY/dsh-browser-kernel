// 分级参数：短 / 中 / 长 各用一套参数，和「一刀切 1200 预算」对比
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const SRC = 'C:/Users/Administrator/Documents/deepseek-harness/default-workspace/plugins/dsh-browser-kernel/lib/index.js';
const TOOLS = 'C:/Users/Administrator/Desktop/DeepSeek Harness/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js';
const OUT = 'C:/Users/Administrator/AppData/Local/Temp/bk-regime.mjs';
writeFileSync(OUT, readFileSync(SRC, 'utf8').replace("from '@deepseek-ai/dsh-tools'", `from '${pathToFileURL(TOOLS).href}'`), 'utf8');
const mod = await import(pathToFileURL(OUT).href + '?t=' + Date.now());
const { stripHtml, pickSentences, splitSentences, queryTerms } = mod.__bench;

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
    } catch {
      await new Promise((r) => setTimeout(r, 700));
    }
  }
  cache.set(url, '');
  return '';
}

// ---- 分级参数 ----
function regime(len) {
  if (len <= 3000) return { mode: 'full', budget: len, label: '全文' };
  if (len <= 15000) return { mode: 'global', budget: 1200, label: '全局 1200' };
  return { mode: 'coverage', budget: 3000, label: '覆盖 3000' };
}

const tokens = (s) => Math.round(s.length / 2.5);
const join = (picked) => picked.map((p) => p.text).join(' ');

/** 一刀切：永远 1200 预算、全局打分（= 现在的 0.6.0） */
const fixed = (text, terms) => join(pickSentences(text, terms, 1200).picked);

/** 分级：短给全文，中走全局，长按「每段命中数」分配预算，保证中后段不被饿死 */
function graded(text, terms) {
  const plan = regime(text.length);
  if (plan.mode === 'full') return text;
  if (plan.mode === 'global') return join(pickSentences(text, terms, plan.budget).picked);

  const sentences = splitSentences(text);
  if (!sentences.length) return text.slice(0, plan.budget);
  const third = Math.ceil(sentences.length / 3);
  const parts = [0, 1, 2].map((i) => sentences.slice(i * third, (i + 1) * third));
  const weights = parts.map((part) => {
    const slice = part.map((s) => s.text).join(' ').toLowerCase();
    let hits = 0;
    for (const t of terms) if (slice.includes(t)) hits++;
    return hits + 0.35; // 没命中的段也留一点，避免整段消失
  });
  const total = weights.reduce((a, b) => a + b, 0);
  const out = parts.map((part, i) => {
    const slice = part.map((s) => s.text).join('\n');
    return join(pickSentences(slice, terms, Math.floor(plan.budget * weights[i] / total)).picked);
  });
  return out.filter(Boolean).join(' ');
}

function rng(seed) { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }
function markersFor(text, seed) {
  const rand = rng(seed);
  const third = Math.floor(text.length / 3);
  const picks = [];
  for (let part = 0; part < 3; part++) {
    const slice = text.slice(part * third, (part + 1) * third).toLowerCase();
    const cands = [...new Set([...slice.matchAll(/[\u4e00-\u9fff]{2}|[A-Za-z][A-Za-z0-9_-]{4,}/g)].map((m) => m[0].toLowerCase()))]
      .filter((t) => slice.split(t).length - 1 >= 2);
    for (let i = 0; i < 2 && cands.length; i++) {
      picks.push({ term: cands.splice(Math.floor(rand() * cands.length), 1)[0], part });
    }
  }
  return picks;
}

const records = [];
for (const p of PAGES) {
  const text = await loadText(p.url);
  if (text.length < 500) { console.log(`\n=== ${p.bucket} · ${p.name} · 跳过（抓取失败）===`); continue; }
  const terms = queryTerms(p.name);
  const plan = regime(text.length);
  console.log(`\n=== ${p.bucket} · ${p.name} · ${text.length} 字符 → 分级方案「${plan.label}」 ===`);
  const rows = [];
  for (let round = 1; round <= 3; round++) {
    const markers = markersFor(text, 7919 * round + p.name.length);
    const row = {};
    for (const [label, fn] of [['一刀切', fixed], ['分级', graded]]) {
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
  const avg = (label, key) => rows.reduce((a, r) => a + r[label][key], 0) / rows.length;
  for (const label of ['一刀切', '分级']) {
    const parts = [0, 1, 2].map((i) => rows.reduce((a, r) => a + r[label].parts[i], 0) / rows.length);
    console.log(
      `  ${label.padEnd(4)} ${String(Math.round(avg(label, 'tok'))).padStart(5)} tok · 召回 ${(avg(label, 'recall') * 100).toFixed(0).padStart(3)}%` +
      ` · 前/中/后 ${parts.map((v) => (v * 100).toFixed(0) + '%').join('/')}`,
    );
    records.push({ bucket: p.bucket, version: label, tok: avg(label, 'tok'), recall: avg(label, 'recall') });
  }
}

console.log('\n============ 汇总（按桶） ============');
console.log('桶   版本      tokens   召回   每点召回成本(tok/pp)');
for (const bucket of ['短', '中', '长']) {
  for (const version of ['一刀切', '分级']) {
    const rows = records.filter((r) => r.bucket === bucket && r.version === version);
    if (!rows.length) continue;
    const tok = rows.reduce((a, r) => a + r.tok, 0) / rows.length;
    const rec = rows.reduce((a, r) => a + r.recall, 0) / rows.length;
    console.log(`${bucket}   ${version.padEnd(4)} ${String(Math.round(tok)).padStart(8)}   ${(rec * 100).toFixed(0).padStart(3)}%   ${(tok / Math.max(1, rec * 100)).toFixed(1)}`);
  }
}
