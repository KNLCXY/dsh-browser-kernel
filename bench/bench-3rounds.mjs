// 短/中/长 × 旧版/新版 × 3 轮
//
// 精度怎么量：从页面「前 1/3、中 1/3、后 1/3」各抽 2 个确实出现过的词当「探针」，
// 看摘要里还能不能找到它们。头重脚轻的抽取会漏掉中后段，这个指标能直接看出来。
import { dirname, join as pathJoin } from 'node:path';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SRC = fileURLToPath(new URL('../lib/index.js', import.meta.url));
const TOOLS = process.env.DSH_TOOLS || 'C:/Users/Administrator/Desktop/DeepSeek Harness/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js';
const TOOLS_IMPORT = existsSync(TOOLS) ? `from '${pathToFileURL(TOOLS).href}'` : "from 'data:text/javascript,export const defineTool = (d) => d'";
const OUT = 'C:/Users/Administrator/AppData/Local/Temp/bk-bench3.mjs';
writeFileSync(OUT, readFileSync(SRC, 'utf8').replace("from '@deepseek-ai/dsh-tools'", TOOLS_IMPORT), 'utf8');
writeFileSync(pathJoin(dirname(OUT), 'rank.js'), readFileSync(pathJoin(dirname(SRC), 'rank.js'), 'utf8'), 'utf8');
const mod = await import(pathToFileURL(OUT).href + '?t=' + Date.now());
const { stripHtml, pickSentences, splitSentences, queryTerms } = mod.__bench;

const BUDGET = 1200;
const PAGES = [
  { bucket: '短', name: 'example.com', url: 'https://example.com/' },
  { bucket: '短', name: 'httpbin/html', url: 'https://httpbin.org/html' },
  { bucket: '中', name: 'clashindex', url: 'https://clashindex.com/zh-CN/blog/articles/tun-vs-system-proxy.html' },
  { bucket: '长', name: 'py-urllib', url: 'https://docs.python.org/zh-cn/3/library/urllib.request.html' },
  { bucket: '长', name: 'mdn-http', url: 'https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Guides/Overview' },
];

const cache = new Map();
async function loadText(url) {
  if (cache.has(url)) return cache.get(url);
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(25000), headers: { 'user-agent': 'Mozilla/5.0' } });
      const text = stripHtml(await res.text());
      cache.set(url, text);
      return text;
    } catch (error) {
      lastError = error;
      await new Promise((r) => setTimeout(r, 800));
    }
  }
  console.log(`  ⚠️ 抓取失败 ${url}: ${lastError && lastError.message}`);
  cache.set(url, '');
  return '';
}

// ---- 探针抽取：每个三分之一里挑 2 个确实出现的词 ----
function rng(seed) { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }
function tokensOf(text) {
  const out = new Set();
  for (const m of text.matchAll(/[\u4e00-\u9fff]{2}|[A-Za-z][A-Za-z0-9_-]{4,}/g)) out.add(m[0].toLowerCase());
  return [...out];
}
function markersFor(text, seed) {
  const rand = rng(seed);
  const third = Math.floor(text.length / 3);
  const picks = [];
  for (let part = 0; part < 3; part++) {
    const slice = text.slice(part * third, (part + 1) * third).toLowerCase();
    const cands = tokensOf(slice).filter((t) => (slice.split(t).length - 1) >= 2);
    const chosen = [];
    for (let i = 0; i < 2 && cands.length; i++) {
      const idx = Math.floor(rand() * cands.length);
      chosen.push(cands.splice(idx, 1)[0]);
    }
    picks.push(...chosen.map((t) => ({ term: t, part })));
  }
  return picks;
}

// ---- 两版策略 ----
const oldVersion = (text, terms, budget) => pickSentences(text, terms, budget).picked.map((p) => p.text).join(' ');

/** 新版：按句子数切块，每块单独分配预算再合并，避免中后段永远竞争不过开头。 */
function newVersion(text, terms, budget) {
  const sentences = splitSentences(text);
  if (!sentences.length) return text.slice(0, budget);
  const chunks = Math.max(1, Math.min(12, Math.round(sentences.length / 60)));
  if (chunks === 1) return pickSentences(text, terms, budget).picked.map((p) => p.text).join(' ');
  const per = Math.floor(budget / chunks);
  const size = Math.ceil(sentences.length / chunks);
  const out = [];
  for (let i = 0; i < sentences.length; i += size) {
    const slice = sentences.slice(i, i + size).map((s) => s.text).join('\n');
    out.push(pickSentences(slice, terms, per).picked.map((p) => p.text).join(' '));
  }
  return out.filter(Boolean).join(' ');
}

const tokens = (s) => Math.round(s.length / 2.5);

const records = [];
for (const p of PAGES) {
  const text = await loadText(p.url);
  if (text.length < 500) { console.log(`\n=== ${p.bucket} · ${p.name} · 跳过（${text.length} 字符，太短无法取样）===`); continue; }
  const terms = queryTerms(p.name);
  const roundRows = [];
  for (let round = 1; round <= 3; round++) {
    const markers = markersFor(text, 7919 * round + p.name.length);
    const row = { round };
    for (const [label, fn] of [['旧版', oldVersion], ['新版', newVersion]]) {
      const out = fn(text, terms, BUDGET);
      const low = out.toLowerCase();
      const hit = markers.filter((m) => low.includes(m.term)).length;
      const byPart = [0, 1, 2].map((part) => {
        const ms = markers.filter((m) => m.part === part);
        return ms.length ? ms.filter((m) => low.includes(m.term)).length / ms.length : 0;
      });
      row[label] = { tok: tokens(out), recall: markers.length ? hit / markers.length : 0, byPart };
    }
    roundRows.push(row);
  }
  const sum = (label, key) => roundRows.reduce((a, r) => a + r[label][key], 0) / roundRows.length;
  const avgPart = (label, part) => roundRows.reduce((a, r) => a + r[label].byPart[part], 0) / roundRows.length;
  console.log(`\n=== ${p.bucket} · ${p.name} · ${text.length} 字符 ===`);
  for (const label of ['旧版', '新版']) {
    console.log(
      `  ${label}: ${Math.round(sum(label, 'tok'))} tok · 探针召回 ${(sum(label, 'recall') * 100).toFixed(0)}%` +
      ` · 前/中/后 ${[0, 1, 2].map((i) => (avgPart(label, i) * 100).toFixed(0) + '%').join('/')}`,
    );
    records.push({
      bucket: p.bucket, page: p.name, version: label,
      tok: sum(label, 'tok'), recall: sum(label, 'recall'),
      parts: [0, 1, 2].map((i) => avgPart(label, i)),
    });
  }
}

console.log('\n================ 汇总（按桶、3 轮平均） ================');
console.log('桶   版本   平均 tokens   探针召回   前/中/后   性价比');
for (const bucket of ['短', '中', '长']) {
  for (const version of ['旧版', '新版']) {
    const rows = records.filter((r) => r.bucket === bucket && r.version === version);
    if (!rows.length) continue;
    const tok = rows.reduce((a, r) => a + r.tok, 0) / rows.length;
    const rec = rows.reduce((a, r) => a + r.recall, 0) / rows.length;
    const parts = [0, 1, 2].map((i) => rows.reduce((a, r) => a + r.parts[i], 0) / rows.length);
    const ratio = rec / Math.max(1, tok) * 1000;
    console.log(
      `${bucket}   ${version}   ${String(Math.round(tok)).padStart(9)}   ${(rec * 100).toFixed(0).padStart(6)}%   ` +
      `${parts.map((v) => (v * 100).toFixed(0) + '%').join('/').padStart(8)}   ${ratio.toFixed(2)}`,
    );
  }
}
