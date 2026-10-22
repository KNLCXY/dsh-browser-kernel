/**
 * 搜前整理与结果重排。纯函数，不碰浏览器。
 * find / digest 共用，避免两套 query 各写各的。
 *
 * 不做语义、不调模型：只去指令壳、拆别名、按标题字面重合排序。
 */

/** 垂直别名表。命中任一词，把同组其它写法补进自动别名（每组最多再加 2 个）。 */
export const VERTICAL_ALIASES = [
  ['贝果计划', 'Operation Bagel'],
]

const INSTRUCTION_LEAD = /^(?:请你?|麻烦你?|帮我|给我|替我|我想知道|我想了解|我想|我要|请问|能不能|可不可以|可以帮我|告诉我|看一下|用\s*web_(?:find|digest))[\s,，:：]*/
const LEAD_VERB = /^(?:搜索一下|搜一下|搜一搜|查一下|查一查|找一下|找一找|检索一下|了解一下|介绍一下|总结一下|简述一下|简要介绍|查查|搜搜)[:：\s]*/
const LEAD_VERB_MARK = /^(?:请\s*)?(?:搜索|查找|检索|搜)(?:\s*[:：]|\s+)(?=\S)/
const LEAD_LABEL = /^(?:关键词|搜索词|查询词|query|search)\s*[:：]\s*/i
const INSTRUCTION_SUFFIX = /(?:谢谢|感谢|thanks|thank you|请用中文(?:回答|回复)?|并(?:给出|返回|附上)(?:链接|来源|摘要)|只要链接|不要摘要)[.。!！\s]*$/i
const WEAK_TAIL = /(?:的)?(?:相关)?(?:资料|信息|内容|介绍|简介|情况|资讯)$/
const QUESTION_TAIL = /(?:到底|究竟)?(?:是什么|是啥|怎么样|如何|怎么回事|什么意思|是多少|有多少|多少)$/

function stripShell(input) {
  let s = String(input || '').replace(/\s+/g, ' ').trim()
  s = s.replace(/^["'“”‘’「」]+|["'“”‘’「」]+$/g, '').trim()
  let guard = 0
  while (s && guard++ < 6) {
    const next = s
      .replace(INSTRUCTION_LEAD, '')
      .replace(LEAD_VERB, '')
      .replace(LEAD_VERB_MARK, '')
      .replace(LEAD_LABEL, '')
      .trim()
    if (next === s) break
    s = next
  }
  s = s.replace(INSTRUCTION_SUFFIX, '').trim()
  const cutWeak = s.replace(WEAK_TAIL, '').trim()
  if (cutWeak.length >= 2) s = cutWeak
  const cutQ = s.replace(QUESTION_TAIL, '').trim()
  if (cutQ.length >= 2) s = cutQ
  return s.replace(/\s+/g, ' ').trim()
}

function splitNameList(cleaned) {
  const aka = cleaned.split(/\s*(?:又名|又称|也叫|亦称|aka|a\.k\.a\.|=|＝)\s*/i).map((s) => s.trim()).filter(Boolean)
  if (aka.length >= 2 && aka.every((p) => p.length >= 2 && p.length <= 32)) {
    return { query: aka[0], aliases: aka.slice(1) }
  }
  const paren = /^(.{2,32}?)[（(]([^）)]{2,40})[）)]$/.exec(cleaned)
  if (paren) return { query: paren[1].trim(), aliases: [paren[2].trim()] }
  if (/[、,，;；|/｜]/.test(cleaned)) {
    const parts = cleaned.split(/[、,，;；|/｜]+/).map((s) => s.trim()).filter((p) => p.length >= 2 && p.length <= 16)
    const rawParts = cleaned.split(/[、,，;；|/｜]+/).map((s) => s.trim()).filter(Boolean)
    const commaList = rawParts.length >= 2 && rawParts.length <= 5 && parts.length === rawParts.length && parts.every((p) => (p.match(/ /g) || []).length <= 1)
    if (commaList) return { query: parts[0], aliases: parts.slice(1) }
  }
  return { query: cleaned, aliases: [] }
}

function expandVertical(query, aliases) {
  const bag = []
  const seen = new Set([query.toLowerCase()])
  const push = (name) => {
    const text = String(name || '').trim()
    if (text.length < 2) return
    const key = text.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    bag.push(text)
  }
  for (const name of aliases) push(name)
  const have = [query, ...bag]
  for (const group of VERTICAL_ALIASES) {
    const hit = have.some((name) => group.some((g) => name.toLowerCase() === g.toLowerCase()))
    if (!hit) continue
    let added = 0
    for (const g of group) {
      if (added >= 2) break
      const before = bag.length
      push(g)
      if (bag.length > before) added++
    }
  }
  return bag.slice(0, 4)
}

/** 排序用的核心词：整句、拉丁词、整段中文。不把二字滑窗当同等权重。 */
export function coreTerms(cleaned) {
  const text = String(cleaned || '').trim().toLowerCase()
  if (!text) return []
  const strong = []
  const compact = text.replace(/\s+/g, '')
  if (compact.length >= 2 && compact.length <= 24) strong.push(compact)
  for (const w of text.split(/[^a-z0-9\u4e00-\u9fff]+/)) {
    if (w.length >= 2 && !/^\d+$/.test(w)) strong.push(w)
  }
  for (const run of text.match(/[\u4e00-\u9fff]{2,8}/g) || []) strong.push(run)
  return [...new Set(strong)].slice(0, 12)
}

/**
 * @returns {{ raw: string, cleaned: string, aliases: string[], core: string[], stripped: boolean }}
 */
export function normalizeQuery(raw) {
  const original = String(raw || '').replace(/\s+/g, ' ').trim()
  const stripped = stripShell(original)
  const base = stripped || original
  const split = splitNameList(base)
  const aliases = expandVertical(split.query, split.aliases)
  const cleaned = split.query || base
  return {
    raw: original,
    cleaned,
    aliases,
    core: coreTerms(cleaned),
    stripped: cleaned !== original,
  }
}

const LOW_TITLE = /^(?:首页|主页|官网|官方网站|官方网站首页|登录|登陆|注册|搜索|搜索结果|无标题|未命名|网页搜索|百度一下|untitled|home|index|404|403|not found|error|forbidden|click here|advertisement|ads?)$/i

export function titleQuality(title, host) {
  const t = String(title || '').replace(/\s+/g, ' ').trim()
  const hostName = String(host || '').replace(/^www\./i, '').toLowerCase()
  if (LOW_TITLE.test(t)) return { ok: false, reason: '低质标题' }
  if (t.length < 4) return { ok: false, reason: '过短' }
  const bare = t.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '').toLowerCase()
  if (hostName && (bare === hostName || t.toLowerCase() === hostName)) return { ok: false, reason: '仅域名' }
  if (/(.)\1{5,}/.test(t)) return { ok: false, reason: '重复字符' }
  const punct = (t.match(/[^\p{L}\p{N}\s]/gu) || []).length
  if (t.length >= 8 && punct / t.length > 0.45) return { ok: false, reason: '符号过多' }
  return { ok: true, reason: '' }
}

export function scoreOverlap(text, profile) {
  const low = String(text || '').toLowerCase()
  const terms = (profile && profile.core) || []
  if (!terms.length) return { hits: 0, ratio: 0, score: 1 }
  let hits = 0
  let weight = 0
  let maxW = 0
  for (const term of terms) {
    const w = term.length >= 4 ? 2 : 1
    maxW += w
    if (low.includes(term)) {
      hits++
      weight += w
    }
  }
  const ratio = maxW ? weight / maxW : 0
  let score = weight * 3 + ratio * 2
  for (const alias of (profile && profile.aliases) || []) {
    if (alias.length >= 2 && low.includes(alias.toLowerCase())) score += 4
  }
  return { hits, ratio, score }
}

function hostOfItem(item) {
  if (item && item.host) return String(item.host).replace(/^www\./i, '')
  try { return new URL(String(item && item.url || '')).hostname.replace(/^www\./i, '') } catch { return '' }
}

/**
 * 标题质量门槛 + 标题↔query 重合排序。
 * 非 strict：零重合留在 weak，调用方可以垫底保留。
 * strict：零重合直接弃用。
 */
export function rankSearchResults(items, profile, opts = {}) {
  const strict = !!(opts && opts.strict)
  const core = (profile && profile.core) || []
  const annotated = (items || []).map((item, index) => {
    const host = hostOfItem(item)
    const title = String((item && item.title) || host || '').trim()
    const quality = titleQuality(title, host)
    const overlap = scoreOverlap(title, profile)
    const blend = scoreOverlap(`${title} ${item && item.snippet || ''}`, profile)
    let extra = 0
    const matched = item && item.matched
    const matchedSize = matched && typeof matched.size === 'number' ? matched.size : Array.isArray(matched) ? matched.length : 0
    if (matchedSize > 1) extra += 2
    return { ...item, host, title, quality, overlap, blend, index, _rank: overlap.score * 10 + blend.score + extra }
  })
  annotated.sort((a, b) => {
    const gate = (x) => (x.quality.ok || x.overlap.ratio >= 0.6 ? 1 : 0)
    const g = gate(b) - gate(a)
    if (g) return g
    if (b._rank !== a._rank) return b._rank - a._rank
    return a.index - b.index
  })

  const adopted = []
  const weak = []
  const dropped = []
  for (const item of annotated) {
    if (!item.url) continue
    if (!item.quality.ok && item.overlap.ratio < 0.6) {
      dropped.push({ ...item, reason: item.quality.reason || '低质标题' })
      continue
    }
    if (core.length >= 2 && item.overlap.ratio === 0) {
      if (strict) dropped.push({ ...item, reason: '标题无查询词' })
      else weak.push({ ...item, _weak: true })
      continue
    }
    adopted.push(item)
  }
  return { adopted, weak, dropped }
}
