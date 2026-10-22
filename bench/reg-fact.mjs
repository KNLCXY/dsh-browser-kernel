// 0.7.3 回归：事实句豁免 + 预算宁少勿滥，是否既保住数字又不放回噪音
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const SRC = 'C:/Users/Administrator/Documents/deepseek-harness/default-workspace/plugins/dsh-browser-kernel/lib/index.js';
const TOOLS = 'C:/Users/Administrator/Desktop/DeepSeek Harness/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js';
const OUT = 'C:/Users/Administrator/AppData/Local/Temp/bk-reg.mjs';
writeFileSync(OUT, readFileSync(SRC, 'utf8').replace("from '@deepseek-ai/dsh-tools'", `from '${pathToFileURL(TOOLS).href}'`), 'utf8');
const mod = await import(pathToFileURL(OUT).href + '?t=' + Date.now());
const { extractSmart, EXTRACT_POLICY, queryTerms } = mod.__bench;

const CASES = [
  {
    name: '东风-41',
    file: 'C:/Users/Administrator/AppData/Local/Temp/baike-df41.txt',
    query: '东风41 导弹类型 射程 洲际',
    title: '东风-41洲际战略核导弹_百度百科',
    budget: 1500,
    noise: ['东风-61', '东风-17', '东风-26'],
    must: ['弹道导弹', '洲际'],
    nice: ['公里', '射程', '马赫'],
  },
  {
    name: 'PLC',
    file: 'C:/Users/Administrator/AppData/Local/Temp/baike-plc.txt',
    query: 'PLC 中文全称 替代 继电器 梯形图',
    title: '可编程逻辑控制器（以微处理器为核心的一种通用工业自动控制装置）_百度百科',
    budget: 2000,
    noise: ['水压', 'Y-△', '降压启动'],
    must: ['继电器', '梯形图'],
    nice: ['Programmable'],
  },
];

for (const c of CASES) {
  if (!existsSync(c.file)) { console.log(c.name, '缺少样本', c.file); continue; }
  const text = readFileSync(c.file, 'utf8');
  const terms = queryTerms(c.query);
  const marks = String(c.title).match(/[A-Za-z]{2,}|\d{2,}/g) || [];
  const titleTerms = String(c.title).replace(/[（(][^）)]*[）)]/g, ' ').replace(/百度百科/g, ' ').split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2).slice(0, 4);
  const out = extractSmart(text, terms, { ...EXTRACT_POLICY, shortBudget: c.budget, midBudget: c.budget, longBudget: c.budget, hugeBudget: c.budget }, { distinctive: marks, titleTerms })
    .picked.map((p) => p.text).join(' ');
  const tok = Math.round(out.length / 2.5);
  const noise = c.noise.filter((n) => out.includes(n));
  const must = c.must.filter((m) => out.includes(m));
  const nice = c.nice.filter((m) => out.includes(m));
  console.log(`\n=== ${c.name} · ${text.length} 字 → ${out.length} 字 (${tok} tok) ===`);
  console.log(`  噪音: ${noise.length ? '❌ ' + noise.join('/') : '0'}`);
  console.log(`  必答: ${must.join('/') || '—'}`);
  console.log(`  加分项(数字/英文): ${nice.join('/') || '—'}`);
}
