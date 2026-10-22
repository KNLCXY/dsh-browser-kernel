// 0.9.7 回归：query 清洗、别名拆分、标题重合排序。不启动浏览器。
import assert from 'node:assert/strict'
import { normalizeQuery, rankSearchResults, titleQuality } from '../lib/rank.js'

function cleaned(q) {
  return normalizeQuery(q).cleaned
}

assert.equal(cleaned('帮我搜一下东风41的射程是多少'), '东风41的射程')
assert.equal(cleaned('请搜索：东风41 射程'), '东风41 射程')
assert.equal(cleaned('搜索引擎原理'), '搜索引擎原理')
assert.equal(cleaned('yyzj mod'), 'yyzj mod')
assert.equal(cleaned('东风41的相关资料'), '东风41')
assert.equal(cleaned('为什么天空是蓝色的'), '为什么天空是蓝色的')
assert.equal(cleaned('帮我查一下 clash verge tun 模式和系统代理的区别 请用中文回答'), 'clash verge tun 模式和系统代理的区别')

const names = normalizeQuery('狩野樱、樱佬、saye.')
assert.equal(names.cleaned, '狩野樱')
assert.deepEqual(names.aliases, ['樱佬', 'saye.'])

const bagel = normalizeQuery('贝果计划')
assert.equal(bagel.cleaned, '贝果计划')
assert.ok(bagel.aliases.includes('Operation Bagel'), bagel.aliases.join(','))

const paren = normalizeQuery('贝果计划（Operation Bagel）')
assert.equal(paren.cleaned, '贝果计划')
assert.ok(paren.aliases.includes('Operation Bagel'))
assert.equal(paren.aliases.filter((a) => a === 'Operation Bagel').length, 1)

assert.equal(titleQuality('首页', 'example.com').ok, false)
assert.equal(titleQuality('example.com', 'example.com').ok, false)
assert.equal(titleQuality('东风-41洲际导弹 射程', 'baike.baidu.com').ok, true)

const profile = normalizeQuery('东风41 射程')
const ranked = rankSearchResults([
  { url: 'https://news.example/a', title: '今日热点汇总', host: 'news.example' },
  { url: 'https://baike.example/df', title: '东风-41 射程 与参数', host: 'baike.example' },
  { url: 'https://spam.example/', title: '首页', host: 'spam.example' },
  { url: 'https://other.example/x', title: '完全无关的园艺教程', host: 'other.example' },
], profile)
assert.equal(ranked.adopted[0].url, 'https://baike.example/df')
assert.ok(ranked.dropped.some((d) => d.url === 'https://spam.example/' && d.reason === '低质标题'))
assert.ok(ranked.weak.some((d) => d.url === 'https://other.example/x'))
assert.ok(ranked.weak.some((d) => d.url === 'https://news.example/a') || ranked.dropped.some((d) => d.url === 'https://news.example/a') || ranked.adopted.some((d) => d.url === 'https://news.example/a'))

const strict = rankSearchResults([
  { url: 'https://baike.example/df', title: '东风-41 射程', host: 'baike.example' },
  { url: 'https://other.example/x', title: '完全无关的园艺教程', host: 'other.example' },
], profile, { strict: true })
assert.equal(strict.adopted.length, 1)
assert.ok(strict.dropped.some((d) => d.reason === '标题无查询词'))

const keepExact = rankSearchResults([
  { url: 'https://x.example/df', title: '首页', host: 'x.example' },
], normalizeQuery('首页并不该放行除非重合'))
assert.equal(keepExact.dropped.length, 1)

console.log('test-rank: ok')
