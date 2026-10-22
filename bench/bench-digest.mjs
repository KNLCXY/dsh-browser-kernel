// 压缩策略对比：同样 1200 字符预算下，谁保住的事实更多。
// 精度定义：每篇文章预置 6–8 个「必须出现的关键事实」，看摘要里命中几个。
import { dirname, join as pathJoin } from 'node:path';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SRC = fileURLToPath(new URL('../lib/index.js', import.meta.url));
const TOOLS = process.env.DSH_TOOLS || 'C:/Users/Administrator/Desktop/DeepSeek Harness/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js';
const TOOLS_IMPORT = existsSync(TOOLS) ? `from '${pathToFileURL(TOOLS).href}'` : "from 'data:text/javascript,export const defineTool = (d) => d'";
const OUT = 'C:/Users/Administrator/AppData/Local/Temp/bk-bench.mjs';
writeFileSync(OUT, readFileSync(SRC, 'utf8').replace("from '@deepseek-ai/dsh-tools'", TOOLS_IMPORT), 'utf8');
writeFileSync(pathJoin(dirname(OUT), 'rank.js'), readFileSync(pathJoin(dirname(SRC), 'rank.js'), 'utf8'), 'utf8');
const mod = await import(pathToFileURL(OUT).href + '?t=' + Date.now());
const { stripHtml, pickSentences, splitSentences, queryTerms } = mod.__bench;

const BUDGET = 1200;
const CASES = [
  {
    url: 'https://clashindex.com/zh-CN/blog/articles/tun-vs-system-proxy.html',
    query: 'clash tun 模式 系统代理 区别',
    facts: ['虚拟网卡', '应用层', '网络层', 'DNS', '系统代理', 'TUN'],
  },
  {
    url: 'https://docs.python.org/zh-cn/3/library/urllib.request.html',
    query: 'python urllib proxy 代理',
    facts: ['ProxyHandler', 'http_proxy', '环境变量', '代理', 'urllib'],
  },
  {
    url: 'https://github.com/cinob/dsh-web-search-multi',
    query: 'dsh web search 插件',
    facts: ['Bing', '百度', 'Tavily', '插件', 'DeepSeek'],
  },
];

// ---- 策略实现 ----
const tokens = (s) => Math.round(s.length / 2.5);

function headTail(text, budget) {
  const sentences = splitSentences(text).map((s) => s.text);
  if (!sentences.length) return text.slice(0, budget);
  const half = Math.floor(budget * 0.55);
  let head = '';
  for (const s of sentences) { if (head.length + s.length > half) break; head += s + ' '; }
  let tail = '';
  for (let i = sentences.length - 1; i >= 0; i--) {
    if (tail.length + sentences[i].length > budget - head.length) break;
    tail = sentences[i] + ' ' + tail;
  }
  return (head + '…' + tail).trim();
}

/** 事实白名单：数字、路径、标识符、命令加分 */
function factScore(s) {
  let n = 0;
  if (/[0-9]/.test(s)) n += 1.2;
  if (/[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z0-9_]+|\/[a-z]+\/|`[^`]+`/.test(s)) n += 0.9;
  if (/[：:]/.test(s)) n += 0.3;
  return Math.min(n, 2.4);
}

function structured(text, terms, budget) {
  const sentences = splitSentences(text);
  if (!sentences.length) return text.slice(0, budget);
  const scored = sentences.map((item, index) => {
    const low = item.text.toLowerCase();
    let hits = 0;
    for (const t of terms) if (low.includes(t)) hits++;
    const score = hits * 3 + (item.prose ? 1.5 : 0) + factScore(item.text) + Math.min(1.2, item.text.length / 260);
    return { ...item, index, score };
  });
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  const picked = [];
  let used = 0;
  for (const item of scored) {
    if (used + item.text.length > budget && picked.length) break;
    picked.push(item);
    used += item.text.length + 2;
  }
  picked.sort((a, b) => a.index - b.index);
  return picked.map((p) => p.text).join(' ');
}

const STRATEGIES = {
  '全文（基线）': (text) => text,
  '当前 pickSentences': (text, terms, b) => pickSentences(text, terms, b).picked.map((p) => p.text).join(' '),
  '头 55% + 尾 45%': (text, _t, b) => headTail(text, b),
  '事实优先 structured': (text, terms, b) => structured(text, terms, b),
};

const rows = [];
for (const [name, fn] of Object.entries(STRATEGIES)) {
  let tokSum = 0, hitSum = 0, factSum = 0;
  for (const c of CASES) {
    let text = ''
    try {
      const res = await fetch(c.url, { signal: AbortSignal.timeout(20000), headers: { 'user-agent': 'Mozilla/5.0' } })
      const html = await res.text()
      text = stripHtml(html)
    } catch (e) {
      text = ''
    }
    const terms = queryTerms(c.query)
    const out = fn(text, terms, BUDGET)
    const tok = tokens(out)
    const low = out.toLowerCase()
    const hits = c.facts.filter((f) => low.includes(f.toLowerCase())).length
    tokSum += tok; hitSum += hits; factSum += c.facts.length
    console.log(`  ${name} · ${new URL(c.url).hostname}: ${tok} tok, 命中 ${hits}/${c.facts.length}`)
  }
  rows.push({ name, avgTok: Math.round(tokSum / CASES.length), recall: (hitSum / factSum * 100).toFixed(0), ratio: (hitSum / Math.max(1, tokSum) * 1000).toFixed(1) })
}

console.log('\n策略'.padEnd(22), '平均 tokens'.padStart(10), '事实召回'.padStart(9), '性价比(召回/1k tok)'.padStart(18));
for (const r of rows) console.log(r.name.padEnd(22), String(r.avgTok).padStart(10), (r.recall + '%').padStart(9), String(r.ratio).padStart(18));
