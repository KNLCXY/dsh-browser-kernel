/**
 * dsh-websift — 给 DSH 一个「真浏览器」工具。
 *
 * 内核来自这台机器上 OCS Desktop 自带的 Chrome（完整 Chromium + V8），
 * 用 headless + CDP 驱动，不下载任何东西、不装 playwright、不需要浏览器插件。
 *
 * 两个工具：
 *   browser        打开网址，取 JS 渲染后的正文 / DOM / 执行 JS / 截图
 *   browser_proxy  查看或切换代理模式（auto / always / never），无需重启 DSH
 *
 * 代理模式：
 *   auto    每个新域名先探测直连（HEAD，2.5s），通就直连，不通自动走代理；结果缓存 10 分钟
 *   always  一律走代理
 *   never   一律直连
 * 单次调用可用 `proxy` 参数覆盖全局设置。
 *
 * @module dsh-websift
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { normalizeQuery, rankSearchResults } from './rank.js'
import { spawn } from 'node:child_process'
import net from 'node:net'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

export const name = 'dsh-websift'
export const inject = ['tools', 'webServer']

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36'

const DEFAULTS = {
  // OCS Desktop 自带的内核（Chrome 137）。换成系统 Chrome 也可以，改这里或插件配置即可。
  // 留空 = 自动探测（Chrome / Edge / Brave / Chromium / 应用自带内核）
  chromePath: '',
  port: 9333,
  proxyUrl: 'http://127.0.0.1:7897',
  proxyMode: 'auto',
  // 空闲多久后关掉浏览器（毫秒）。headless Chrome 空转约 700MB，别一直挂着。
  idleMs: 5 * 60 * 1000,
  // 可视模式：不开 headless，浏览器窗口会出现在桌面上，用户能看着它操作
  // 使用方式：off 关闭 / auto 按需（我自己判断）/ force 强制（涉及网页一律实抓）
  usage: 'auto',
  // 兼容旧字段：enabled=false 等同 usage='off'
  enabled: true,
  visible: false,
  // 强制走代理的站点（每行/逗号一个）。命中就直接走代理，不做直连探测。
  // 这些站在国内直连基本不通；换到能直连的网络时把对应行删掉即可。
  proxySites: 'github.com, githubusercontent.com, google.com, youtube.com, x.com, twitter.com',
  // 摘要预算（可被单次调用的 budget_chars 覆盖）
  budgetChars: 3000,
  // ── 高级（一般不用动，调之前先看 README 的基准数据）──
  // 分级阈值：按正文字数决定用哪一档参数
  shortMaxChars: 3000,
  midMaxChars: 15000,
  hugeMaxChars: 50000,
  // 分级预算：每页给多少字符
  shortBudget: 1200,
  midBudget: 1200,
  longBudget: 3000,
  hugeBudget: 4000,
  factExempt: true,
  // 两套互不混搭的方案：
  //   plugin   = 插件自带（默认）：搜索用真浏览器，抓正文也用浏览器，完全不碰 ctx.web.*
  //   official = 官方 API：搜索走 ctx.web.search、抓取走 ctx.web.fetch（失败才回退浏览器）
  // 默认 plugin：DSH 同时注册多个 search provider 又没指定默认时，ctx.web.search 会抛
  // ambiguous，那行报错会被当成备注挂在每次结果上。
  stack: 'plugin',
  cacheTtlMin: 15,
  cacheMax: 60,
  pageWaitMs: 45000,
  waitMs: 600,
  routeTtlMin: 10,
  loginPollMs: 1500,
  loginStreak: 3,
  loginTimeoutS: 180,
  // 输入框旁的小开关是否显示
  showDock: true,
  // 安静模式：可视窗口启动后最小化，不抢焦点；登录时自动还原
  quiet: true,
  probeTimeoutMs: 2500,
  slowVisitMs: 8000,
  profileDir: join(tmpdir(), 'dsh-websift-profile'),
  outputDir: join(homedir(), '.dsh', 'storages', 'browser-kernel'),
}

// ---------------------------------------------------------------- 内核探测

/**
 * 换机器最容易卡住的一步：chromePath 指错了，一调就报「浏览器没起来」。
 * 所以留空时自己找：显式环境变量 → 各平台常见安装位置 → 应用自带的内核。
 * 结果缓存，探测只做一次。
 */
let DETECTED_CHROME = null

function chromeCandidates() {
  const list = []
  const env = process.env
  if (env.DSH_CHROME) list.push(env.DSH_CHROME)
  if (process.platform === 'win32') {
    const pf = env.ProgramFiles || 'C:/Program Files'
    const pf86 = env['ProgramFiles(x86)'] || 'C:/Program Files (x86)'
    const local = env.LOCALAPPDATA || ''
    list.push(
      `${pf}/Google/Chrome/Application/chrome.exe`,
      `${pf86}/Google/Chrome/Application/chrome.exe`,
      local ? `${local}/Google/Chrome/Application/chrome.exe` : '',
      `${pf}/Microsoft/Edge/Application/msedge.exe`,
      `${pf86}/Microsoft/Edge/Application/msedge.exe`,
      `${pf}/BraveSoftware/Brave-Browser/Application/brave.exe`,
      `${pf86}/BraveSoftware/Brave-Browser/Application/brave.exe`,
      `${pf}/Chromium/Application/chrome.exe`,
    )
  } else if (process.platform === 'darwin') {
    list.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    )
  } else {
    list.push(
      '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium', '/usr/bin/chromium-browser',
      '/usr/bin/microsoft-edge', '/snap/bin/chromium',
    )
  }
  return list.filter(Boolean)
}

// 认识的 Chromium 系可执行文件名。豆包、夸克、360、QQ 浏览器、搜狗、猎豹这些
// 都是 Chromium 套壳，能跑 --remote-debugging-port，所以也收进来。
const CHROMIUM_EXE_RE = /^(chrome|chromium|msedge|brave|vivaldi|opera|360se|360chrome|360se6|qqbrowser|sogouexplorer|doubao|quark|ucbrowser|liebao|2345explorer|maxthon|centbrowser|thorium|yandex)\.exe$/i

// 探测时不往里钻的目录（缓存/系统/包管理，钻进去只会慢）
const SCAN_SKIP_RE = /^(node_modules|\.git|Temp|tmp|Cache|GPUCache|Code Cache|CrashDumps|Packages|WinSxS|System32|SysWOW64|Installer|WindowsApps|DriverStore)$/i

/** 目录里有没有 Chromium 的标志文件（icudtl.dat 或 *.pak）：有才可能是真内核。 */
function looksLikeChromium(dir) {
  try {
    const names = readdirSync(dir)
    if (names.includes('icudtl.dat')) return true
    return names.some((n) => n.toLowerCase().endsWith('.pak'))
  } catch {
    return false
  }
}

/**
 * 有界 BFS 扫 Chromium 内核。
 * 之前只扫 3 个目录、只往下一层，豆包这类装在 `%LOCALAPPDATA%\Doubao\Application\...`
 * 的应用根本扫不到。现在多根目录 + 深度 4 + 目录数上限，避免拖慢启动。
 */
function scanChromiumRoots() {
  const enumRoots = []
  const home = homedir()
  const env = process.env
  if (process.platform === 'win32') {
    const pf = env.ProgramFiles || 'C:/Program Files'
    const pf86 = env['ProgramFiles(x86)'] || 'C:/Program Files (x86)'
    const local = env.LOCALAPPDATA || ''
    const roaming = env.APPDATA || ''
    try { enumRoots.push({ dir: join(dirname(process.execPath), 'resources'), depth: 5 }) } catch {}
    // 应用内置内核最常见的落点：LOCALAPPDATA 下的 <App>\Application\<ver>\
    if (local) enumRoots.push({ dir: local, depth: 4 })
    if (local) enumRoots.push({ dir: join(local, 'Programs'), depth: 4 })
    if (roaming) enumRoots.push({ dir: roaming, depth: 3 })
    enumRoots.push({ dir: pf, depth: 3 })
    enumRoots.push({ dir: pf86, depth: 3 })
    enumRoots.push({ dir: join(home, 'Desktop'), depth: 5 })
  } else if (process.platform === 'darwin') {
    enumRoots.push({ dir: '/Applications', depth: 4 })
    enumRoots.push({ dir: join(home, 'Applications'), depth: 4 })
  } else {
    enumRoots.push({ dir: '/usr/lib', depth: 3 })
    enumRoots.push({ dir: '/opt', depth: 3 })
  }

  const found = []
  const seen = new Set()
  let visited = 0
  const MAX_DIRS = 4000

  for (const root of enumRoots) {
    if (!root.dir) continue
    const queue = [{ dir: root.dir, depth: 0 }]
    while (queue.length) {
      const { dir, depth } = queue.shift()
      if (!dir || seen.has(dir)) continue
      seen.add(dir)
      if (++visited > MAX_DIRS) return found
      let entries = []
      try { entries = readdirSync(dir, { withFileTypes: true }) } catch { continue }
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue
        const full = join(dir, entry.name)
        if (entry.isDirectory()) {
          if (SCAN_SKIP_RE.test(entry.name)) continue
          if (depth + 1 <= root.depth) queue.push({ dir: full, depth: depth + 1 })
          continue
        }
        if (!CHROMIUM_EXE_RE.test(entry.name)) continue
        if (!looksLikeChromium(dir)) continue
        found.push({ path: full, dir })
      }
    }
  }
  return found
}

/** 自动探测时的偏好：标准浏览器 > 其他 Chromium > 应用内置。 */
function chromePreference(path) {
  const f = String(path).split(/[\\/]/).pop().toLowerCase()
  if (f === 'chrome.exe') return 0
  if (f === 'msedge.exe') return 1
  if (f === 'brave.exe') return 2
  if (f === 'chromium.exe') return 3
  if (f === 'vivaldi.exe' || f === 'opera.exe') return 4
  return 9
}

/** 兼容旧调用：返回第一个扫到的应用内置内核。 */
function scanBundledChrome() {
  const hits = scanChromiumRoots()
  return hits.length ? hits[0].path : ''
}

/** 给设置面板用的候选列表：只回真正存在的那些。 */
function labelOfChrome(path) {
  const file = String(path).split(/[\\/]/).pop() || ''
  const lower = file.toLowerCase()
  if (lower === 'msedge.exe' || /Edge\.app/i.test(path)) return 'Microsoft Edge'
  if (lower === 'brave.exe') return 'Brave'
  if (lower === 'chromium.exe') return 'Chromium'
  if (lower === 'chrome.exe') return 'Google Chrome'
  if (lower === 'doubao.exe') return '豆包（内置内核）'
  if (lower === 'quark.exe') return '夸克（内置内核）'
  if (/^(360se|360chrome)/.test(lower)) return '360 浏览器'
  if (lower === 'qqbrowser.exe') return 'QQ 浏览器'
  if (lower === 'sogouexplorer.exe') return '搜狗浏览器'
  if (lower === 'vivaldi.exe') return 'Vivaldi'
  if (lower === 'opera.exe') return 'Opera'
  if (lower === 'ucbrowser.exe') return 'UC 浏览器'
  if (lower === 'liebao.exe') return '猎豹浏览器'
  if (lower === 'yandex.exe') return 'Yandex'
  return 'Chromium 内核'
}

function listChromeCandidates() {
  const out = []
  const seen = new Set()
  const push = (path, label) => {
    if (!path || seen.has(path)) return
    seen.add(path)
    let exists = false
    try { exists = existsSync(path) } catch {}
    if (exists) out.push({ path, label })
  }
  if (process.env.DSH_CHROME) push(process.env.DSH_CHROME, 'DSH_CHROME（环境变量）')
  for (const c of chromeCandidates()) push(c, labelOfChrome(c))
  for (const hit of scanChromiumRoots().sort((a, b) => chromePreference(a.path) - chromePreference(b.path))) push(hit.path, labelOfChrome(hit.path) + '（扫描发现）')
  return out
}

/** 返回可用的内核路径；找不到返回空串。 */
function detectChrome() {
  if (DETECTED_CHROME !== null) return DETECTED_CHROME
  for (const candidate of chromeCandidates()) {
    try { if (existsSync(candidate)) { DETECTED_CHROME = candidate; return candidate } } catch {}
  }
  const hits = scanChromiumRoots().sort((a, b) => chromePreference(a.path) - chromePreference(b.path))
  DETECTED_CHROME = hits.length ? hits[0].path : ''
  return DETECTED_CHROME
}

/** 解析最终要用的内核路径，并标记是不是自动探测来的。 */
function resolveChromePath(configured) {
  const raw = String(configured || '').trim()
  if (raw && raw.toLowerCase() !== 'auto') {
    try { if (existsSync(raw)) return { path: raw, auto: false } } catch {}
  }
  const found = detectChrome()
  return { path: found, auto: Boolean(found) }
}

const SETTINGS_PATH = join(DEFAULTS.outputDir, 'settings.json')
/** 用户在输入页关掉总开关后，工具统一返回这句（不启动内核、不联网）。 */
const FORCE_TAIL = [
  '',
  '',
  '[强制使用] 用户把浏览器设为「强制」：涉及网络的内容必须实际抓取核实，不要凭记忆或推测回答。',
].join(String.fromCharCode(10))
function modeTail(exec) {
  return currentUsage(exec) === 'force' ? FORCE_TAIL : ''
}

const OFF_TEXT = [
  '浏览器工具已被关闭（你在输入页关掉了「🌐 浏览器」开关）。',
  '需要时点一下那个开关重新打开，或在 设置 → 浏览器内核 里打开。',
].join(String.fromCharCode(10))
/** 运行时生效的调参（每次 resolveSettings 刷新，供缓存/探测等深层函数读取）。 */
/** 把「强制代理站点」字符串解析成数组：容忍逗号/空白/换行，去掉协议和路径。 */
function parseSites(raw) {
  return String(raw || '')
    .split(/[\s,，;；]+/)
    .map((x) => x.trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/\/.*$/, '').replace(/^\*?\./, ''))
    .filter(Boolean)
}

/** host 命中列表？支持子域（gist.github.com 命中 github.com）。 */
function hostInSites(host, sites) {
  const h = String(host || '').toLowerCase()
  if (!h) return false
  for (const site of sites || []) {
    if (h === site || h.endsWith('.' + site)) return true
  }
  return false
}

const TUNING = { cacheTtlMs: 15 * 60 * 1000, probeTimeoutMs: 2500, slowVisitMs: 8000, factExempt: true, proxySites: [], usage: 'auto', quiet: true, cacheMax: 60, pageWaitMs: 45000, waitMs: 600, routeTtlMs: 10 * 60 * 1000, loginPollMs: 1500, loginStreak: 3, loginTimeoutS: 180 }
const ROUTE_TTL = 10 * 60 * 1000
const PROBE_TIMEOUT = 2500
/** 直连 TTFB 超过这个值就认为「通但慢」，改走代理（弱网/公共 Wi-Fi 场景）。 */
const PROBE_SLOW_MS = 1200
/** 直连访问整页超过这个时长，就把这个域名记成「该走代理」，下次直接走。 */
const SLOW_VISIT_MS = 8000

// ---------------------------------------------------------------- settings

function readSettingsFile() {
  try {
    return JSON.parse(readFileSync(SETTINGS_PATH, 'utf8'))
  } catch {
    return {}
  }
}

function writeSettingsFile(patch) {
  const next = { ...readSettingsFile(), ...patch }
  try {
    mkdirSync(DEFAULTS.outputDir, { recursive: true })
    writeFileSync(SETTINGS_PATH, JSON.stringify(next, null, 2), 'utf8')
  } catch (error) {
    // 配置写不进去不该让工具本身失败：本次调用继续用内存里的值。
    return { ...next, _writeError: String(error && error.message ? error.message : error) }
  }
  return next
}

/** 某个会话的使用方式：会话里有覆盖就先用它，否则用全局默认。 */
function usageFor(exec) {
  let sid = ''
  try { sid = (exec && exec.agent && exec.agent.id) || '' } catch {}
  if (!sid) return TUNING.usage || 'auto'
  const map = readSettingsFile().sessionUsage || {}
  const per = map[sid]
  return per === 'off' || per === 'force' || per === 'auto' ? per : (TUNING.usage || 'auto')
}

function currentUsage(exec) { return usageFor(exec) }

function resolveSettings(config) {
  const merged = { ...DEFAULTS, ...(config || {}), ...readSettingsFile() }
  // 兼容 0.9.18 的布尔开关 builtinSearch：只在没有显式 stack 时才升级
  if ((config || {}).stack === undefined && readSettingsFile().stack === undefined) {
    const legacy = { ...(config || {}), ...readSettingsFile() }.builtinSearch
    if (legacy === true) merged.stack = 'official'
    else if (legacy === false) merged.stack = 'plugin'
  }
  merged.stack = merged.stack === 'official' ? 'official' : 'plugin'
  // chromePath 留空、写成 auto、或指向一个不存在的文件时，自动探测可用的内核
  const chrome = resolveChromePath(merged.chromePath)
  merged.chromePath = chrome.path
  merged._chromeAuto = chrome.auto
  TUNING.cacheTtlMs = Math.max(1, Number(merged.cacheTtlMin) || 15) * 60 * 1000
  TUNING.probeTimeoutMs = Math.max(300, Number(merged.probeTimeoutMs) || 2500)
  TUNING.slowVisitMs = Math.max(2000, Number(merged.slowVisitMs) || 8000)
  TUNING.factExempt = merged.factExempt !== false
  TUNING.proxySites = parseSites(merged.proxySites)
  TUNING.cacheMax = Math.max(5, Number(merged.cacheMax) || 60)
  TUNING.pageWaitMs = Math.max(3000, Number(merged.pageWaitMs) || 45000)
  TUNING.waitMs = Math.max(0, Number(merged.waitMs) || 0)
  TUNING.routeTtlMs = Math.max(1, Number(merged.routeTtlMin) || 10) * 60 * 1000
  TUNING.loginPollMs = Math.max(500, Number(merged.loginPollMs) || 1500)
  TUNING.loginStreak = Math.max(1, Number(merged.loginStreak) || 3)
  TUNING.loginTimeoutS = Math.max(20, Number(merged.loginTimeoutS) || 180)
  TUNING.quiet = merged.quiet !== false
  TUNING.clashPath = String(merged.clashPath || '').trim()
  TUNING.autoStartClash = merged.autoStartClash !== false
  TUNING.usage = merged.usage === 'off' || merged.enabled === false ? 'off' : merged.usage === 'force' ? 'force' : 'auto'
  return merged
}

// ---------------------------------------------------------------- proxy

const routeCache = new Map()

function isPrivateHost(host) {
  return host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local') || /^(10|127)\./.test(host)
    || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || /^\[?::1\]?$/.test(host)
}

/** 直连能不能通？通 = direct，不通 = proxy。按域名缓存 10 分钟。 */
const proxyAliveCache = new Map()
/** 代理端口活不活（300ms 超时，缓存 60 秒）——不通就别白改路由。 */
async function proxyAlive(proxyUrl) {
  if (!proxyUrl) return false
  let target
  try {
    const u = new URL(proxyUrl)
    target = { host: u.hostname, port: Number(u.port) || 80 }
  } catch {
    return false
  }
  const key = target.host + ':' + target.port
  const hit = proxyAliveCache.get(key)
  if (hit && Date.now() - hit.at < 60000) return hit.ok
  const ok = await new Promise((resolve) => {
    const socket = net.connect({ host: target.host, port: target.port })
    const finish = (value) => { try { socket.destroy() } catch {} ; resolve(value) }
    socket.setTimeout(300)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
  proxyAliveCache.set(key, { ok, at: Date.now() })
  return ok
}

// ---------------------------------------------------------------- Clash Verge

/**
 * 可选依赖：Clash Verge（代理内核）。插件不打包它，只在检测到代理端口不通时
 * 帮你把它拉起来。项目与作者信息同时出现在设置面板和 README 里。
 */
const CLASH = {
  name: 'Clash Verge',
  repo: 'https://github.com/clash-verge-rev/clash-verge-rev',
  author: 'zzzgydi 与 Clash Verge Rev 贡献者',
  license: 'GPL-3.0',
}

let CLASH_BIN = null

function clashCandidates() {
  const out = []
  const env = process.env
  if (env.DSH_CLASH) out.push(env.DSH_CLASH)
  if (process.platform === 'win32') {
    const local = env.LOCALAPPDATA || ''
    const pf = env.ProgramFiles || 'C:/Program Files'
    const pf86 = env['ProgramFiles(x86)'] || 'C:/Program Files (x86)'
    const names = ['Clash Verge.exe', 'clash-verge.exe', 'Clash Verge Rev.exe']
    const dirs = [
      local ? join(local, 'Programs', 'Clash Verge') : '',
      local ? join(local, 'Clash Verge') : '',
      join(pf, 'Clash Verge'),
      join(pf86, 'Clash Verge'),
      join(pf, 'Clash Verge Rev'),
    ].filter(Boolean)
    for (const dir of dirs) for (const name of names) out.push(join(dir, name))
  } else if (process.platform === 'darwin') {
    out.push('/Applications/Clash Verge.app/Contents/MacOS/clash-verge')
  } else {
    out.push('/usr/bin/clash-verge', '/opt/Clash Verge/clash-verge')
  }
  return out
}

function detectClash() {
  if (CLASH_BIN !== null) return CLASH_BIN
  for (const candidate of clashCandidates()) {
    try { if (existsSync(candidate)) { CLASH_BIN = candidate; return candidate } } catch {}
  }
  CLASH_BIN = ''
  return ''
}

/** 清掉代理存活缓存，启动后要重新测。 */
function forgetProxyAlive(proxyUrl) {
  try {
    const u = new URL(proxyUrl)
    proxyAliveCache.delete(u.hostname + ':' + (Number(u.port) || 80))
  } catch {}
}

let clashStarting = null
let clashLastTry = 0

/** 启动 Clash Verge，并等代理端口就绪（最多 20s）。 */
async function startClash(settings) {
  if (!settings.proxyUrl) return { ok: false, error: '没有配置代理地址' }
  forgetProxyAlive(settings.proxyUrl)
  if (await proxyAlive(settings.proxyUrl)) return { ok: true, already: true }
  if (clashStarting) return clashStarting
  const bin = String(settings.clashPath || '').trim() || detectClash()
  if (!bin) {
    return { ok: false, error: '没找到 Clash Verge（可设 DSH_CLASH 环境变量，或在设置里填路径）' }
  }
  if (Date.now() - clashLastTry < 30000) {
    return { ok: false, error: '30 秒内刚尝试过，先别重复启动', path: bin }
  }
  clashLastTry = Date.now()
  clashStarting = (async () => {
    try {
      const child = spawn(bin, [], { detached: true, stdio: 'ignore' })
      child.unref?.()
    } catch (error) {
      return { ok: false, error: '启动失败：' + String((error && error.message) || error), path: bin }
    }
    for (let i = 0; i < 40; i++) {
      await sleep(500)
      forgetProxyAlive(settings.proxyUrl)
      if (await proxyAlive(settings.proxyUrl)) return { ok: true, waitedMs: (i + 1) * 500, path: bin }
    }
    return { ok: false, error: '已尝试启动，但 20 秒内代理端口仍无响应（可能还在加载订阅）', path: bin }
  })().finally(() => { clashStarting = null })
  return clashStarting
}

/** 设置面板 / 工具用的一份状态。 */
async function clashStatus(settings) {
  forgetProxyAlive(settings.proxyUrl)
  const running = await proxyAlive(settings.proxyUrl)
  return {
    name: CLASH.name,
    repo: CLASH.repo,
    author: CLASH.author,
    license: CLASH.license,
    running,
    proxyUrl: settings.proxyUrl,
    path: String(settings.clashPath || '').trim() || detectClash(),
    autoStart: settings.autoStartClash !== false,
  }
}

async function probeRoute(host, proxyUrl) {
  // 代理端口不通时，按设置自动把 Clash Verge 拉起来（有 30s 冷却，不会反复点）
  if (TUNING.autoStartClash && proxyUrl) {
    forgetProxyAlive(proxyUrl)
    if (!(await proxyAlive(proxyUrl))) {
      const started = await startClash({ proxyUrl, clashPath: TUNING.clashPath })
      if (!started.ok && started.error) console.error('[websift] Clash 自动启动：' + started.error)
    }
  }
  // 用户指定的「强制代理站点」：命中就不探测了，直接走代理（代理不在线才退回直连）
  if (hostInSites(host, TUNING.proxySites) && (await proxyAlive(proxyUrl))) {
    routeCache.set(host, { route: 'proxy', at: Date.now() })
    return 'proxy'
  }
  if (isPrivateHost(host)) return 'direct'
  const hit = routeCache.get(host)
  if (hit && Date.now() - hit.at < TUNING.routeTtlMs) return hit.route
  let route = 'proxy'
  try {
    const startedAt = Date.now()
    const res = await fetch('https://' + host + '/', {
      method: 'HEAD',
      redirect: 'manual',
      headers: { 'user-agent': UA },
      signal: AbortSignal.timeout(TUNING.probeTimeoutMs),
    })
    const elapsed = Date.now() - startedAt
    const proxyOnline = await proxyAlive(proxyUrl)
    // 弱网场景（学校/公共 Wi-Fi）：通不等于快。直连 TTFB 超过 1.2 秒就改走代理，
    // 否则会出现「探测 0.3s 通过、真页面加载 25s」这种坑（实测 GameBanana）。
    route = res && (elapsed <= PROBE_SLOW_MS || !proxyOnline) ? 'direct' : 'proxy'
  } catch {
    route = 'proxy'
  }
  routeCache.set(host, { route, at: Date.now() })
  return route
}

// ---------------------------------------------------------------- chrome lifecycle

const browserState = { proxy: null, visible: null, timer: null, lastUsed: 0, launching: null, workTargetId: null, minimized: false }

async function ping(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1500) })
    return res.ok ? await res.json() : null
  } catch {
    return null
  }
}

function touchIdle(settings) {
  if (browserState.timer) clearTimeout(browserState.timer)
  // 可视化开着就不自动关窗：窗口是给用户看的，关掉等于把观察面收走了。
  // 要回收就显式调 browser_proxy({ action: "stop" })。
  if (settings.visible) return
  const ms = Number(settings.idleMs) > 0 ? Number(settings.idleMs) : DEFAULTS.idleMs
  browserState.timer = setTimeout(() => {
    stopChrome(settings.port).catch(() => {})
  }, ms)
  browserState.timer.unref?.()
}

async function stopChrome(port) {
  const version = await ping(port)
  if (version && version.webSocketDebuggerUrl) {
    try {
      const cdp = await connect(version.webSocketDebuggerUrl)
      await cdp.send('Browser.close').catch(() => {})
      cdp.close()
    } catch {
      /* 进程可能正在退出 */
    }
  }
  for (let i = 0; i < 20; i++) {
    if (!(await ping(port))) break
    await sleep(250)
  }
  browserState.proxy = null
  if (browserState.timer) {
    clearTimeout(browserState.timer)
    browserState.timer = null
  }
}

async function launchChrome(settings, useProxy) {
  const args = [
    // 可视模式下不加 headless：窗口会真的出现在桌面上
    ...(settings.visible ? [] : ['--headless=new']),
    // 可视 + 安静：尽量以最小化启动（部分内核不认这个参数，认不认都不影响后面的处理）
    ...(settings.visible && TUNING.quiet ? ['--start-minimized'] : []),
    // 必须：内核放在 Desktop 下，Chromium 沙箱读不到自己的可执行文件
    //（Sandbox cannot access executable, 0x5 拒绝访问）。
    '--no-sandbox',
    '--disable-gpu',
    // 去掉自动化特征：headless 下 navigator.webdriver === true，
    // GitHub 的文件编辑器等页面会**整块拒绝渲染**（只剩 "Files main" 骨架）。
    // 实测加上这个开关后编辑器正常出现。不影响登录态与 cookie。
    '--disable-blink-features=AutomationControlled',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--mute-audio',
    '--window-size=1440,900',
    `--user-data-dir=${settings.profileDir}`,
    `--remote-debugging-port=${settings.port}`,
  ]
  if (useProxy && settings.proxyUrl) args.push(`--proxy-server=${settings.proxyUrl}`)
  // 不传 about:blank：多出来的空白标签会让人以为「浏览器卡在空白页」

  const child = spawn(settings.chromePath, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  })
  // 父进程退出后浏览器继续跑，下次调用直接复用。
  child.unref()
  child.on('error', () => {})

  for (let i = 0; i < 60; i++) {
    await sleep(500)
    if (await ping(settings.port)) {
      browserState.proxy = !!useProxy
      browserState.visible = !!settings.visible
      browserState.minimized = false
      writeSettingsFile({ launchedProxy: !!useProxy, launchedVisible: !!settings.visible, launchedAt: new Date().toISOString() })
      return
    }
  }
  throw new Error(
    `浏览器没起来（15s 内 CDP 端口 ${settings.port} 无响应）。` +
      (settings.chromePath
        ? `内核路径：${settings.chromePath}（不存在或起不来；可在「设置 → 浏览器代理 → 内核路径」里改）`
        : '没找到可用的 Chrome/Chromium：装一个 Chrome/Edge，或在设置里手动填内核路径（也可以设环境变量 DSH_CHROME）'),
  )
}

async function ensureChrome(settings, useProxy) {
  if (browserState.launching) await browserState.launching
  const up = await ping(settings.port)
  if (up) {
    // DSH 重启后内存状态丢了：以 settings 里记录的启动参数为准。
    if (browserState.proxy === null) {
      const saved = readSettingsFile()
      browserState.proxy = saved.launchedProxy === true
      browserState.visible = saved.launchedVisible === true
    }
    // 代理和可视模式都是启动参数，变了只能重启浏览器
    if (browserState.proxy === !!useProxy && browserState.visible === !!settings.visible) {
      touchIdle(settings)
      return
    }
    await stopChrome(settings.port)
  }
  browserState.launching = launchChrome(settings, useProxy).finally(() => {
    browserState.launching = null
  })
  await browserState.launching
  touchIdle(settings)
}

// ---------------------------------------------------------------- CDP

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    const pending = new Map()
    let id = 0
    ws.addEventListener('open', () => resolve(api))
    ws.addEventListener('error', () => reject(new Error('CDP WebSocket 连接失败')))
    ws.addEventListener('close', () => {
      for (const p of pending.values()) p.reject(new Error('CDP 连接已关闭'))
      pending.clear()
    })
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id === undefined) return
      const p = pending.get(msg.id)
      if (!p) return
      pending.delete(msg.id)
      msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result)
    })
    const api = {
      send(method, params = {}) {
        const mid = ++id
        return new Promise((res, rej) => {
          pending.set(mid, { resolve: res, reject: rej })
          ws.send(JSON.stringify({ id: mid, method, params }))
        })
      },
      close() {
        try {
          ws.close()
        } catch {
          /* already closed */
        }
      },
    }
  })
}

// ---------------------------------------------------------------- one page visit

function hostOf(url) {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

/**
 * 执行一个页面动作。三条评审标准要求：批量做完再返回，动作本身不产生任何正文。
 * 找不到元素就明确报失败，不假装成功。
 */
/** 把 JSON 字符串解析成动作数组；解析不了就当一个都不做（不要瞎猜）。 */
function parseActions(raw) {
  if (!raw) return []
  if (Array.isArray(raw)) return raw
  try {
    const parsed = JSON.parse(String(raw))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function runAction(cdp, a) {
  if (!a || typeof a !== "object") return { ok: false, why: "动作格式不对" }
  if (a.wait !== undefined) {
    await sleep(Math.min(15000, Math.max(0, Number(a.wait) || 0)))
    return { ok: true, wait: a.wait }
  }
  if (a.click !== undefined) {
    const sel = String(a.click)
    const expr = "JSON.stringify((function(){var sel=" + JSON.stringify(sel) + ";" +
      "var el=null;try{el=document.querySelector(sel)}catch(e){}" +
      "if(!el){var all=[].slice.call(document.querySelectorAll(\"a,button,[role=button],li,span\"));" +
      "for(var i=0;i<all.length;i++){if((all[i].innerText||\"\").trim()===sel){el=all[i];break}}}" +
      "if(!el)return {ok:false,sel:sel};" +
      "el.scrollIntoView({block:\"center\"});el.click();" +
      "return {ok:true,sel:sel,tag:el.tagName}})())"
    const r = await cdp.send("Runtime.evaluate", { expression: expr, returnByValue: true }).catch(() => null)
    if (!r || !r.result || !r.result.value) return { ok: false, click: sel, why: "执行失败" }
    try { return JSON.parse(r.result.value) } catch { return { ok: false, click: sel } }
  }
  if (a.scroll !== undefined) {
    const to = a.scroll === "bottom" ? "document.body.scrollHeight" : String(Math.max(0, Number(a.scroll) || 0))
    await cdp.send("Runtime.evaluate", { expression: "window.scrollTo(0," + to + ")", returnByValue: true }).catch(() => {})
    return { ok: true, scroll: a.scroll }
  }
  if (a.type && a.type.selector) {
    const expr = "JSON.stringify((function(){var el=document.querySelector(" + JSON.stringify(String(a.type.selector)) + ");" +
      "if(!el)return {ok:false};el.focus();el.value=" + JSON.stringify(String(a.type.text || "")) + ";" +
      "el.dispatchEvent(new Event(\"input\",{bubbles:true}));el.dispatchEvent(new Event(\"change\",{bubbles:true}));" +
      "return {ok:true}})())"
    const r = await cdp.send("Runtime.evaluate", { expression: expr, returnByValue: true }).catch(() => null)
    if (!r || !r.result || !r.result.value) return { ok: false, type: a.type.selector }
    try { return JSON.parse(r.result.value) } catch { return { ok: false, type: a.type.selector } }
  }
  return { ok: false, why: "不认识的动作" }
}
/**
 * 挑一个标签页来用：优先复用上次那个（这样可见模式下不会闪走），
 * 其次用现成的 about:blank，都没有才新开。
 */
async function pickTarget(settings) {
  let list = []
  // 刚启动时 /json/list 可能还是空的，重试几次再决定要不要新开标签
  for (let i = 0; i < 12; i++) {
    try {
      list = await fetch('http://127.0.0.1:' + settings.port + '/json/list').then((r) => r.json())
    } catch {
      list = []
    }
    const has = (list || []).some((t) => t.type === 'page')
    if (has) break
    await sleep(250)
  }
  const pages = (list || []).filter((t) => t.type === 'page')
  if (browserState.workTargetId) {
    const same = pages.find((t) => t.id === browserState.workTargetId)
    if (same) return same
    browserState.workTargetId = null
  }
  const blank = pages.find((t) => !t.url || t.url === 'about:blank' || t.url.indexOf('chrome://newtab') === 0)
  if (blank) return blank
  return null
}

/**
 * 可视模式下把浏览器窗口最小化：窗口还在（你可以随时还原看），
 * 但不会反复跳到前台抢焦点、挡着你用别的软件。
 */
async function minimizeWindow(settings) {
  if (!settings.visible || TUNING.quiet === false || browserState.minimized) return
  try {
    const list = await fetch('http://127.0.0.1:' + settings.port + '/json/list').then((r) => r.json())
    const page = (list || []).find((t) => t.type === 'page')
    if (!page) return
    const cdp = await connect(page.webSocketDebuggerUrl)
    try {
      const win = await cdp.send('Browser.getWindowForTarget', { targetId: page.id })
      await cdp.send('Browser.setWindowBounds', { windowId: win.windowId, bounds: { windowState: 'minimized' } })
      browserState.minimized = true
    } finally {
      cdp.close()
    }
  } catch {
    /* 某些平台不支持，忽略即可 */
  }
}

/**
 * 非安静的可视模式：把窗口还原 + 置前，让用户实时看到在点哪、翻到哪。
 * （安静模式下不会调用它 —— 安静的要求是全程不抢前台。）
 */
async function focusWindow(settings, target) {
  if (!settings.visible || TUNING.quiet) return
  try {
    const cdp = await connect(target.webSocketDebuggerUrl)
    try {
      if (browserState.minimized) {
        const win = await cdp.send('Browser.getWindowForTarget', { targetId: target.id })
        await cdp.send('Browser.setWindowBounds', { windowId: win.windowId, bounds: { windowState: 'normal' } })
        browserState.minimized = false
      }
      await cdp.send('Page.bringToFront')
    } finally {
      cdp.close()
    }
  } catch {
    /* 平台不支持就算了，不影响抓取 */
  }
}

async function visit(settings, opts) {
  const wantProxy = opts.route === 'proxy'
  await ensureChrome(settings, wantProxy)

  // 复用同一个标签页：可见模式下窗口会停在刚访问的页面，而不是闪回 about:blank
  let target = await pickTarget(settings)
  if (!target) {
    target = await fetch(`http://127.0.0.1:${settings.port}/json/new?about:blank`, { method: 'PUT' }).then((r) => r.json())
  }
  browserState.workTargetId = target.id
  const cdp = await connect(target.webSocketDebuggerUrl)
  const started = Date.now()
  try {
    // 窗口策略只看「可视化」开关；安静只决定"要不要置前"
    if (settings.visible) {
      if (TUNING.quiet) await minimizeWindow(settings)
      else await focusWindow(settings, target)
    }
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    // 试过在文本模式下屏蔽图片/字体：实测更慢（GameBanana 24.9s → 66.4s，
    // 而且永远到不了 complete）。站点会等资源、失败还重试，所以这条路否决。
    await cdp.send('Emulation.setUserAgentOverride', { userAgent: UA }).catch(() => {})
    await cdp.send('Page.navigate', { url: opts.url })

    // 等 document.readyState = complete（最多 45s）。SPA 会先 complete 再水合，
    // 所以后面还有 wait_ms 的额外等待。
    let ready = ''
    const maxTicks = Math.ceil(TUNING.pageWaitMs / 250)
    for (let i = 0; i < maxTicks; i++) {
      const r = await cdp.send('Runtime.evaluate', {
        expression: 'JSON.stringify([document.readyState, document.body ? document.body.innerText.length : 0])',
        returnByValue: true,
      })
      let state = '', textLen = 0
      try { [state, textLen] = JSON.parse(r.result?.value || '[]') } catch {}
      ready = state || ''
      if (state === 'complete') break
      // 弱网下图片/字体可能拖到几十秒，但正文通常 2–3 秒就在了。
      // 只要 interactive 且有字，就不再等完整加载（截图模式除外，截图要等排版）。
      if (opts.action !== 'screenshot' && i >= 4 && state === 'interactive' && textLen > 200) break
      await sleep(250)
    }
    if (opts.waitMs > 0) await sleep(opts.waitMs)

    // 批量动作：一次调用里点/滚/填完，中间不返回任何正文（否则 N 步就是 N 份摘要）
    let actionLog = null
    if (Array.isArray(opts.actions) && opts.actions.length) {
      actionLog = []
      for (const act of opts.actions.slice(0, 12)) {
        const one = await runAction(cdp, act)
        actionLog.push(Object.assign({ act: act }, one))
        if (one && one.ok === false) break  // 动作失败就停，不硬着头皮往下点
        await sleep(700)                    // 给页面一点反应时间
      }
    }

    const meta = await cdp.send('Runtime.evaluate', {
      expression: 'JSON.stringify({url: location.href, title: document.title, ready: document.readyState})',
      returnByValue: true,
    })
    const info = JSON.parse(meta.result?.value || '{}')
    const out = {
      url: info.url || opts.url,
      title: info.title || '',
      readyState: info.ready || ready,
      route: opts.route,
      seconds: Number(((Date.now() - started) / 1000).toFixed(1)),
      actions: actionLog,
    }

    if (opts.action === 'screenshot') {
      mkdirSync(join(settings.outputDir, 'shots'), { recursive: true })
      const file = opts.out || join(settings.outputDir, 'shots', `shot-${Date.now()}.png`)
      const shot = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: opts.fullPage !== false,
      })
      writeFileSync(file, Buffer.from(shot.data, 'base64'))
      out.screenshot = file
      return out
    }

    if (opts.action === 'eval') {
      const r = await cdp.send('Runtime.evaluate', {
        expression: opts.js || 'document.title',
        returnByValue: true,
        awaitPromise: true,
      })
      if (r.exceptionDetails) {
        // exceptionDetails.text 通常只是 "Uncaught"，真正的原因在 exception.description 里。
        const detail = r.exceptionDetails.exception?.description || r.exceptionDetails.text || 'unknown'
        throw new Error('JS 报错：' + String(detail).split('\n')[0])
      }
      const value = r.result?.value
      out.value = value
      out.text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
      return out
    }

    const expression = opts.action === 'html' ? 'document.documentElement.outerHTML' : '(document.body && document.body.innerText) || ""'
    const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true })
    let text = String(r.result?.value || '')
    if (opts.action === 'text') text = text.replace(/\n{3,}/g, '\n\n').trim()
    out.chars = text.length
    out.text = text
    return out
  } finally {
    cdp.close()
    // 工作标签一律保留并复用：
    // 以前每次新建+关闭，可见模式下窗口会一直闪回 about:blank（用户报过）。
    // 整个浏览器空闲 5 分钟会自己关掉，不会攒标签。
    browserState.workTargetId = target.id
  }
}

/** 登录时注入到页面上的浮条：用户点「我已登录」就是明确信号，比任何猜测都可靠。 */
const LOGIN_BAR_JS = `(function(){
  if (document.getElementById('__bk_login_bar')) return 'exists';
  if (!document.body) return 'no-body';
  var d = document.createElement('div');
  d.id = '__bk_login_bar';
  d.style.cssText = 'position:fixed;z-index:2147483647;left:50%;bottom:18px;transform:translateX(-50%);' +
    'display:flex;gap:10px;align-items:center;padding:10px 14px;border-radius:10px;background:#16181d;' +
    'color:#fff;font:14px/1.4 system-ui,sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.45);border:1px solid #333';
  var t = document.createElement('span');
  t.textContent = '登录完成后点右边 →';
  var b = document.createElement('button');
  b.textContent = '✅ 我已登录';
  b.style.cssText = 'all:unset;cursor:pointer;background:#2b6ef6;color:#fff;padding:6px 14px;border-radius:6px;font-weight:600';
  b.onclick = function(){ window.__bkLoginDone = true; b.textContent = '已确认，正在收尾…'; };
  var c = document.createElement('button');
  c.textContent = '✕';
  c.style.cssText = 'all:unset;cursor:pointer;opacity:.55;padding:2px 6px;font-size:16px';
  c.onclick = function(){ window.__bkLoginCancel = true; d.remove(); };
  d.appendChild(t); d.appendChild(b); d.appendChild(c);
  document.body.appendChild(d);
  return 'added';
})()`

/**
 * 登录流程：弹出可见窗口 → 用户自己登（扫码/验证码/密码都行）→ 我轮询到登录成功。
 * 密码不经过模型、不写进对话，只有浏览器把 cookie 写进本地 profile。
 */
async function loginFlow(settings, args) {
  const wanted = { ...settings, visible: true } // 登录必须看得见窗口
  const route = await probeRoute(hostOf(args.url), wanted.proxyUrl)
  await ensureChrome(wanted, route === 'proxy')

  const target = await fetch('http://127.0.0.1:' + wanted.port + '/json/new?about:blank', { method: 'PUT' }).then((r) => r.json())
  const cdp = await connect(target.webSocketDebuggerUrl)
  const started = Date.now()
  const timeoutMs = Math.min(600, Math.max(20, Number(args.timeout_s) || TUNING.loginTimeoutS)) * 1000
  try {
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    await cdp.send('Network.enable').catch(() => {})
    // 登录必须让用户看得见：还原窗口并置前
    try {
      const win = await cdp.send('Browser.getWindowForTarget', { targetId: target.id })
      await cdp.send('Browser.setWindowBounds', { windowId: win.windowId, bounds: { windowState: 'normal' } })
      await cdp.send('Page.bringToFront')
      browserState.minimized = false
    } catch {}
    await cdp.send('Page.navigate', { url: args.url })
    await sleep(2500) // 让页面先稳定下来，避免初始跳转被当成登录成功

    const before = await cdp.send('Network.getAllCookies').catch(() => ({ cookies: [] }))
    const baseCookies = (before.cookies || []).length
    const baseUrl = (await cdp.send('Runtime.evaluate', { expression: 'location.href', returnByValue: true })).result?.value || args.url

    let href = baseUrl
    let cookies = baseCookies
    let streak = 0
    while (Date.now() - started < timeoutMs) {
      await sleep(TUNING.loginPollMs)
      const ev = await cdp.send('Runtime.evaluate', {
        expression: 'JSON.stringify({h:location.href,t:document.title,done:window.__bkLoginDone===true,cancel:window.__bkLoginCancel===true,ready:document.readyState})',
        returnByValue: true,
      }).catch(() => ({ result: {} }))
      let info = {}
      try { info = JSON.parse(ev.result?.value || '{}') } catch {}
      href = info.h || href
      const title = info.t || ''
      const seconds = Number(((Date.now() - started) / 1000).toFixed(1))

      if (info.cancel) {
        return { ok: false, status: 'cancelled', url: href, title, seconds, cookiesFrom: baseCookies, cookiesTo: cookies }
      }
      // 每轮补一次浮条：页面一跳转旧 DOM 就没了
      await cdp.send('Runtime.evaluate', { expression: LOGIN_BAR_JS, returnByValue: true }).catch(() => {})
      // ① 用户点了「我已登录」——最可靠的信号，直接收工
      if (info.done) {
        const now = await cdp.send('Network.getAllCookies').catch(() => ({ cookies: [] }))
        return { ok: true, status: 'logged-in', url: href, title, seconds, cookiesFrom: baseCookies, cookiesTo: (now.cookies || []).length, via: '用户确认' }
      }
      // ② 自动判定：连续 3 次成立才算（页面跳转那一瞬容易假成立）
      let jsHit = false
      if (args.wait_js) {
        const jr = await cdp.send('Runtime.evaluate', {
          expression: 'Boolean(' + String(args.wait_js) + ')', returnByValue: true,
        }).catch(() => ({ result: {} }))
        jsHit = jr.result?.value === true
      }
      let selectorHit = false
      if (args.wait_until) {
        const sel = await cdp.send('Runtime.evaluate', {
          expression: '!!document.querySelector(' + JSON.stringify(String(args.wait_until)) + ')', returnByValue: true,
        }).catch(() => ({ result: {} }))
        selectorHit = sel.result?.value === true
      }
      const urlChanged = href !== baseUrl && href.split('#')[0] !== baseUrl.split('#')[0]
      const leftLoginPage = urlChanged && !/(login|signin|sign-in|sign_in|auth|sessions|verify)/i.test(href)
      const ok = args.wait_js ? jsHit : args.wait_until ? selectorHit : leftLoginPage
      streak = ok && info.ready === 'complete' ? streak + 1 : 0
      if (streak >= TUNING.loginStreak) {
        const now = await cdp.send('Network.getAllCookies').catch(() => ({ cookies: [] }))
        const via = args.wait_js ? 'JS 判定' : args.wait_until ? '选择器' : '离开登录页'
        return { ok: true, status: 'logged-in', url: href, title, seconds, cookiesFrom: baseCookies, cookiesTo: (now.cookies || []).length, via }
      }
    }
    return {
      ok: false, status: 'timeout', url: href, seconds: Number(((Date.now() - started) / 1000).toFixed(1)),
      cookiesFrom: baseCookies, cookiesTo: cookies,
    }
  } finally {
    cdp.close()
    // 故意不关标签页：登录流程里用户可能还停在三步验证/设备确认页面，
    // 关掉等于把他正在操作的页面抽走（踩过一次）。空闲 5 分钟会自动回收。
  }
}

/** 把 URL 解析成一次访问：先定路由，再干活。 */
async function run(settings, args) {
  if (!args.url) throw new Error('缺少 url')
  const mode = String(args.proxy || settings.proxyMode || 'auto').toLowerCase()
  let route
  if (mode === 'always') route = 'proxy'
  else if (mode === 'never') route = 'direct'
  else route = await probeRoute(hostOf(args.url), settings.proxyUrl)

  const result = await visit(settings, {
    url: args.url,
    route,
    action: String(args.action || 'text').toLowerCase(),
    js: args.js,
    waitMs: args.wait_ms === undefined ? TUNING.waitMs : Number(args.wait_ms),
    actions: parseActions(args.actions),
    fullPage: args.full_page,
    out: args.out,
  })
  // 弱网/海外站点：直连整页超过 8 秒，记下「这站该走代理」，下一次直接走代理
  if (result.route === 'direct' && Number(result.seconds) * 1000 > TUNING.slowVisitMs) {
    routeCache.set(hostOf(args.url), { route: 'proxy', at: Date.now() })
    result.note = (result.note ? result.note + '; ' : '') + '直连耗时过长，已标记该站走代理'
  }
  return { ...result, mode }
}

// ---------------------------------------------------------------- rendering

function head(r) {
  const base = `${r.url}\ntitle: ${r.title || '(无)'} · route: ${r.route} · ${r.seconds}s`
  // 批量动作：成功几个、失败在哪一步，直接写在抬头里，不用去正文里找
  if (!Array.isArray(r.actions) || !r.actions.length) return base
  const total = r.actions.length
  const bad = r.actions.filter((a) => a && a.ok === false)
  const desc = r.actions.map((a, i) => {
    const act = a.act || {}
    const mark = a.ok === false ? '✗' : '✓'
    if (act.wait !== undefined) return `#${i + 1} 等 ${act.wait}ms`
    if (act.click !== undefined) return `#${i + 1} 点「${act.click}」${mark}`
    if (act.scroll !== undefined) return `#${i + 1} 滚到 ${act.scroll}${mark}`
    if (act.type) return `#${i + 1} 填 ${act.type.selector}${mark}`
    return `#${i + 1} ?`
  })
  const why = bad.map((a) => a.why || a.sel || '').filter(Boolean).join('；')
  return `${base}\n动作 ${total - bad.length}/${total}：${desc.join(' · ')}${bad.length ? '\n⚠ 有动作失败，后面的没再执行' + (why ? '：' + why : '') : ''}`
}

function render(r, maxChars) {
  if (r.summary) return r.summary
  if (r.screenshot) return `${head(r)}\n截图已保存：${r.screenshot}\n（用 read_image 读取这个路径就能看）`
  const text = r.text || ''
  const max = maxChars
  return `${head(r)}\n---\n${text.slice(0, max)}${text.length > max ? `\n… [截断，共 ${text.length} 字符]` : ''}`
}

// ---------------------------------------------------------------- http routes (设置页用)

function sendJson(res, status, value) {
  try {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(value))
  } catch {
    /* 客户端可能已经断开 */
  }
}

async function readJsonBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8').trim()
  if (!raw) return {}
  return JSON.parse(raw)
}

/** 设置页和工具共用的一份状态快照。 */
async function snapshot(settings, sessionId) {
  const version = await ping(settings.port)
  return {
    ok: true,
    mode: settings.proxyMode,
    proxyUrl: settings.proxyUrl,
    proxySites: Array.isArray(TUNING.proxySites) ? TUNING.proxySites : parseSites(settings.proxySites),
    proxySitesRaw: String(settings.proxySites || ''),
    port: settings.port,
    idleMs: settings.idleMs,
    usage: sessionId ? ((readSettingsFile().sessionUsage || {})[sessionId] || TUNING.usage) : TUNING.usage,
    globalUsage: TUNING.usage,
    sessionUsage: readSettingsFile().sessionUsage || {},
    showDock: settings.showDock !== false,
    quiet: settings.quiet !== false,
    cacheMax: TUNING.cacheMax,
    pageWaitMs: TUNING.pageWaitMs,
    waitMs: TUNING.waitMs,
    routeTtlMin: Math.round(TUNING.routeTtlMs / 60000),
    loginPollMs: TUNING.loginPollMs,
    loginStreak: TUNING.loginStreak,
    loginTimeoutS: TUNING.loginTimeoutS,
    enabled: TUNING.usage !== 'off',
    visible: settings.visible === true,
    budgetChars: settings.budgetChars,
    longBudget: settings.longBudget,
    shortMaxChars: settings.shortMaxChars,
    midMaxChars: settings.midMaxChars,
    hugeMaxChars: settings.hugeMaxChars,
    shortBudget: settings.shortBudget,
    midBudget: settings.midBudget,
    hugeBudget: settings.hugeBudget,
    factExempt: settings.factExempt !== false,
    stack: settings.stack === 'official' ? 'official' : 'plugin',
    cacheTtlMin: settings.cacheTtlMin,
    probeTimeoutMs: settings.probeTimeoutMs,
    slowVisitMs: settings.slowVisitMs,
    chromePath: settings.chromePath,
    clashPath: String(settings.clashPath || '').trim(),
    clashDetected: detectClash(),
    autoStartClash: settings.autoStartClash !== false,
    clash: await clashStatus(settings),
    settingsPath: SETTINGS_PATH,
    defaults: {
      proxyUrl: DEFAULTS.proxyUrl,
      idleMs: DEFAULTS.idleMs,
      chromePath: DEFAULTS.chromePath,
      port: DEFAULTS.port,
      mode: DEFAULTS.proxyMode,
    },
    browser: { running: !!version, proxy: browserState.proxy === true },
  }
}

/**
 * 校验并归一化设置页提交的补丁。
 * 只接受白名单字段，非法值抛错（路由转成 400），不做「猜你想改」。
 */
function sanitizePatch(body) {
  const patch = {}
  if (body.mode !== undefined) {
    const mode = String(body.mode).toLowerCase()
    if (!['auto', 'always', 'never'].includes(mode)) throw new Error('mode 必须是 auto / always / never')
    patch.proxyMode = mode
  }
  if (body.proxyUrl !== undefined) {
    const url = String(body.proxyUrl).trim()
    if (url && !/^(https?|socks5h?):\/\/[^\s/]+/i.test(url)) {
      throw new Error('代理地址要以 http:// 、 https:// 或 socks5:// 开头，例如 http://127.0.0.1:7897')
    }
    patch.proxyUrl = url
  }
  if (body.idleMs !== undefined) {
    const ms = Number(body.idleMs)
    if (!Number.isFinite(ms) || ms < 30_000 || ms > 6 * 3600_000) throw new Error('空闲关闭要在 30 秒到 6 小时之间')
    patch.idleMs = Math.round(ms)
  }
  if (body.chromePath !== undefined) {
    const p = String(body.chromePath).trim()
    if (p && !/\.exe$/i.test(p)) throw new Error('内核路径要指向一个 .exe')
    patch.chromePath = p
  }
  if (body.port !== undefined) {
    const n = Number(body.port)
    if (!Number.isInteger(n) || n < 1024 || n > 65535) throw new Error('端口要在 1024–65535 之间')
    patch.port = n
  }
  if (body.visible !== undefined) {
    patch.visible = Boolean(body.visible)
  }
  if (body.budgetChars !== undefined) {
    const n = Number(body.budgetChars)
    if (!Number.isFinite(n) || n < 600 || n > 20000) throw new Error('默认摘要预算要在 600–20000 字符之间')
    patch.budgetChars = Math.round(n)
  }
  if (body.longBudget !== undefined) {
    const n = Number(body.longBudget)
    if (!Number.isFinite(n) || n < 800 || n > 8000) throw new Error('长页预算要在 800–8000 字符之间')
    patch.longBudget = Math.round(n)
  }
  if (body.enabled !== undefined) patch.enabled = Boolean(body.enabled)
  if (body.usage !== undefined) {
    const u = String(body.usage).toLowerCase()
    if (!['off', 'auto', 'force'].includes(u)) throw new Error('usage 必须是 off / auto / force')
    const sid = body.sessionId ? String(body.sessionId) : ''
    if (sid) {
      // 按会话存：每个对话独立，互不影响
      patch.sessionUsage = Object.assign({}, readSettingsFile().sessionUsage || {}, { [sid]: u })
    } else {
      patch.usage = u
    }
  }
  if (body.factExempt !== undefined) patch.factExempt = Boolean(body.factExempt)
  if (body.stack !== undefined) {
    const s = String(body.stack).toLowerCase()
    if (!['plugin', 'official'].includes(s)) throw new Error('stack 必须是 plugin / official')
    patch.stack = s
  }
  if (body.proxySites !== undefined) {
    const raw = String(body.proxySites)
    if (raw.length > 4000) throw new Error('站点列表太长（上限 4000 字符）')
    patch.proxySites = raw
  }
  const intIn = (key, lo, hi, msg) => {
    if (body[key] === undefined) return
    const n = Number(body[key])
    if (!Number.isFinite(n) || n < lo || n > hi) throw new Error(msg)
    patch[key] = Math.round(n)
  }
  intIn('shortMaxChars', 500, 20000, '短页阈值要在 500–20000 字之间')
  intIn('midMaxChars', 2000, 60000, '中页阈值要在 2000–60000 字之间')
  intIn('hugeMaxChars', 20000, 200000, '超长页阈值要在 20000–200000 字之间')
  intIn('shortBudget', 240, 4000, '短页预算要在 240–4000 字之间')
  intIn('midBudget', 240, 6000, '中页预算要在 240–6000 字之间')
  intIn('hugeBudget', 500, 12000, '超长页预算要在 500–12000 字之间')
  intIn('cacheTtlMin', 1, 1440, '缓存有效期要在 1–1440 分钟之间')
  intIn('probeTimeoutMs', 300, 10000, '探测超时要在 300–10000 毫秒之间')
  intIn('slowVisitMs', 2000, 60000, '慢站阈值要在 2000–60000 毫秒之间')
  intIn('cacheMax', 5, 500, '缓存条数要在 5–500 之间')
  intIn('pageWaitMs', 3000, 120000, '页面等待上限要在 3–120 秒之间')
  intIn('waitMs', 0, 20000, '默认等待要在 0–20000 毫秒之间')
  intIn('routeTtlMin', 1, 1440, '路由缓存要在 1–1440 分钟之间')
  intIn('loginPollMs', 500, 10000, '登录轮询间隔要在 500–10000 毫秒之间')
  intIn('loginStreak', 1, 10, '连续确认次数要在 1–10 之间')
  intIn('loginTimeoutS', 20, 600, '登录默认超时要在 20–600 秒之间')
  if (body.showDock !== undefined) patch.showDock = Boolean(body.showDock)
  if (body.quiet !== undefined) patch.quiet = Boolean(body.quiet)
  if (body.clashPath !== undefined) {
    const cp = String(body.clashPath || '').trim()
    if (cp && !/\.exe$/i.test(cp)) throw new Error('Clash 路径要指向 .exe（留空 = 自动找）')
    patch.clashPath = cp
  }
  if (body.autoStartClash !== undefined) patch.autoStartClash = Boolean(body.autoStartClash)
  if (body.reset === true) {
    // 恢复默认：把所有可调项都写回 DEFAULTS（以前只重置了 5 个字段，其余会留在旧值）
    const keys = ["proxyMode","proxyUrl","idleMs","port","visible","budgetChars","longBudget","shortMaxChars","midMaxChars","hugeMaxChars","shortBudget","midBudget","hugeBudget","factExempt","stack","cacheTtlMin","probeTimeoutMs","slowVisitMs","proxySites"]
    for (const key of keys) if (DEFAULTS[key] !== undefined) patch[key] = DEFAULTS[key]  }
  return patch
}

// ---------------------------------------------------------------- 网页摘要（省 token）

/**
 * 摘要管线：搜索（或给定链接）→ 抓正文 → 抽取关键句 → 压缩成一段。
 *
 * 全部在宿主进程里做，只有压缩后的结果进入对话上下文，所以省的是**上下文 token**，
 * 不是网络请求。抽取是「挑句子」，不调模型 —— 零额外 token。
 */

/**
 * HTML → 纯文本，带两层去噪：
 *   1) 结构层：整块丢掉 nav / header / footer / aside / form —— 这些永远是导航。
 *   2) 密度层：<li> 里几乎只有链接的，是菜单项而不是正文列表，丢掉。
 * 顺序很重要：先按结构删，再做标签剥离；否则删完标签就认不出哪里是菜单了。
 */
function stripHtml(html) {
  let s = String(html)
  s = s.replace(/<(script|style|noscript|template|svg|head)[\s\S]*?<\/\1>/gi, ' ')
  s = s.replace(/<(nav|header|footer|aside|form)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
  s = s.replace(/<!--[\s\S]*?-->/g, ' ')
  // 菜单项：文字很短、且大部分文字都在 <a> 里的 <li>
  s = s.replace(/<li\b[^>]*>([\s\S]{0,500}?)<\/li>/gi, (whole, inner) => {
    const plain = inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    const linkText = (inner.match(/<a\b[^>]*>[\s\S]*?<\/a>/gi) || [])
      .join(' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    if (plain.length < 80 && linkText.length > plain.length * 0.6) return ' '
    return whole
  })
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 带单位的数字 / 版本号 / 日期 / 金额 —— 这类句子是「事实句」，不参与淘汰。 */
const FACT_UNIT_RE = /\d+(?:\.\d+)?\s*(?:公里|千米|km|米|马赫|吨|kg|MB|GB|TB|ms|%)/i
const FACT_VERSION_RE = /\bv?\d+\.\d+(?:\.\d+)?\b/
function isFactSentence(text) {
  if (!TUNING.factExempt) return false
  return FACT_UNIT_RE.test(text) || FACT_VERSION_RE.test(text)
}

/** URL 规范化：去 fragment、去跟踪参数、去 www、参数排序 —— 缓存和去重的 key。 */
// 只收「几乎必然是跟踪/分享来源」的参数。`from` / `source` 故意不放进来：
// 有些站点用它们选内容（?from=page2、?source=pdf），删了会让两个不同页面
// 撞成同一个 key —— 去重时就是「少给一条」。
const TRACKING_PARAM_RE = /^(?:utm_|spm|fbclid|gclid|share_|ref)/i
/** 正文指纹：长度 + djb2 哈希。用来判断「两条搜索结果其实是同一篇」。 */
function textFingerprint(text) {
  const s = String(text || '')
  if (s.length < 40) return '' // 太短的（空页、纯导航）不参与，避免误合并
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return s.length + ':' + (h >>> 0).toString(36)
}

function normalizeUrl(input) {
  try {
    const u = new URL(String(input))
    u.hash = ''
    for (const key of [...u.searchParams.keys()]) if (TRACKING_PARAM_RE.test(key)) u.searchParams.delete(key)
    u.hostname = u.hostname.replace(/^www\./i, '').toLowerCase()
    // 尾斜杠不该造成两份：/a/ 和 /a 是同一篇（根路径 "/" 要保留）
    if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, '')
    const entries = [...u.searchParams.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    u.search = ''
    for (const [k, v] of entries) u.searchParams.append(k, v)
    return u.toString()
  } catch {
    return String(input)
  }
}

/** 进程内短时缓存：同一次会话里重复抓同一页很常见（多轮、多页重叠）。 */
const PAGE_CACHE_TTL = 15 * 60 * 1000
const PAGE_CACHE_MAX = 60
const pageCache = new Map()
function cacheGet(key) {
  const hit = pageCache.get(key)
  if (!hit) return null
  if (Date.now() - hit.at > TUNING.cacheTtlMs) { pageCache.delete(key); return null }
  pageCache.set(key, hit) // LRU 续期
  return hit
}
function cacheSet(key, value) {
  pageCache.set(key, { ...value, at: Date.now() })
  while (pageCache.size > TUNING.cacheMax) pageCache.delete(pageCache.keys().next().value)
}

/**
 * JSON → 紧凑文本。很多站点（GameBanana、GitHub）的 API 一次返回几十条记录，
 * 原样塞进上下文动辄几千 token；这里只留「一行一条 + 几个短字段」。
 */
function digestJson(parsed, budget) {
  let best = null
  const scan = (node, depth) => {
    if (!node || depth > 4) return
    if (Array.isArray(node)) {
      const objs = node.filter((x) => x && typeof x === "object" && !Array.isArray(x))
      if (objs.length >= 2 && (!best || objs.length > best.length)) best = objs
      for (const child of node.slice(0, 2)) scan(child, depth + 1)
    } else if (typeof node === "object") {
      for (const value of Object.values(node)) scan(value, depth + 1)
    }
  }
  scan(parsed, 0)
  if (!best) return JSON.stringify(parsed).slice(0, budget)

  const lines = ["JSON 数组，共 " + best.length + " 条，只列前 20 条："]
  let used = lines[0].length
  for (const item of best.slice(0, 20)) {
    const parts = []
    for (const [key, value] of Object.entries(item)) {
      if (value === null || typeof value === "object") continue
      const text = String(value).trim()
      if (!text || text.length > 70) continue
      parts.push(key + "=" + text)
      if (parts.length >= 6) break
    }
    const line = "  " + parts.join(" | ")
    lines.push(line)
    used += line.length + 1
    if (used > budget) break
  }
  return lines.join(String.fromCharCode(10)).slice(0, budget)
}

function htmlTitle(html) {
  const m = /<title[^>]*>([\s\S]{0,300}?)<\/title>/i.exec(String(html))
  return m ? m[1].replace(/\s+/g, ' ').trim() : ''
}

/** 查询词：英文按词，中文取整块 + 相邻二字（没有分词器，用二字滑窗近似）。 */
function queryTerms(query) {
  const terms = new Set()
  const lower = String(query || '').toLowerCase()
  for (const w of lower.split(/[^a-z0-9\u4e00-\u9fff]+/)) {
    if (w.length >= 2 && !/^\d+$/.test(w)) terms.add(w)
  }
  const cjk = lower.replace(/[^\u4e00-\u9fff]+/g, ' ')
  for (const chunk of cjk.split(/\s+/)) {
    if (!chunk) continue
    if (chunk.length <= 4) terms.add(chunk)
    for (let i = 0; i + 2 <= chunk.length; i++) terms.add(chunk.slice(i, i + 2))
  }
  return [...terms]
}

const NAV_NOISE = /^(sign in|sign up|log in|log out|register|登录|注册|首页|上一页|下一页|view all|read more|see more|skip to|jump to|accept all|cookie|privacy policy|terms of service|copyright|©|all rights reserved|share|tweet|print|email)/i

function countHits(text, terms) {
  if (!terms.length) return 0
  const low = String(text || '').toLowerCase()
  let hits = 0
  for (const t of terms) if (low.includes(t)) hits++
  return hits
}

function splitSentences(text) {
  const out = []
  const blocks = String(text).split(/\n+/).map((b) => b.trim()).filter(Boolean)
  blocks.forEach((block) => {
    if (block.length < 20) return
    if (NAV_NOISE.test(block)) return
    // 导航项通常自成一短行、没有句末标点；正文段落往往更长或带句号。
    const proseBlock = block.length > 180 || /[。！？!?]/.test(block)
    for (const piece of block.match(/[^。！？!?;；]+[。！？!?;；]?/g) || []) {
      const s = piece.trim()
      if (s.length >= 20) out.push({ text: s, prose: proseBlock })
    }
  })
  return out
}

/** 按查询词命中 + 段落感打分，取头部若干句，再按原文顺序还原。 */
function pickSentences(text, terms, budget, boostFn) {
  const sentences = splitSentences(text)
  if (!sentences.length) return { picked: [], total: 0 }
  const scored = sentences.map((item, index) => {
    const lower = item.text.toLowerCase()
    let hits = 0
    for (const t of terms) if (lower.includes(t)) hits++
    let score = hits * 3
    score += item.prose ? 1.5 : 0
    score += Math.min(1.5, item.text.length / 200)
    // 事实句（带单位的数字、版本号）单独加分：查询词里没有这些数字时，
    // 它们很容易被普通长句挤掉（实测：东风-41 的射程数字就是这样消失的）
    if (isFactSentence(item.text)) score += 1.6
    // 软门槛：和本条目相关的句子加分，跑题的扣分（不是硬删，避免把答案句一起删掉）
    if (typeof boostFn === "function") score += boostFn(item.text)
    if (/[。！？!?]$/.test(item.text)) score += 0.8
    // 短行（菜单、按钮、标签）扣分，避免把导航当选摘
    if (item.text.length < 45) score -= 1.2
    if (index < 3) score += 0.5
    return { ...item, index, score }
  })
  scored.sort((a, b) => b.score - a.score || a.index - b.index)
  // 有足够多「像段落」的句子时只从它们里挑，避免把菜单项当摘要。
  // 事实句例外：像「最大射程约14000公里 可携带分导式核弹头」这种是视频标题/图注，
  // 没有句号也不算段落，但恰恰是答案 —— 只收段落会把它们一起丢掉（实测踩过）。
  const proseOnly = scored.filter((s) => s.prose || isFactSentence(s.text))
  const pool = proseOnly.length >= 3 ? proseOnly : scored
  const picked = []
  const seen = []
  let used = 0
  // 近似去重：把标点空白去掉后比较前缀，挡掉「同一句话换个说法讲三遍」
  // （Python 文档里 proxy 环境变量那一段就重复了三次）。
  const norm = (s) => s.toLowerCase().replace(/[\s，。！？、；：""''（）()\-—…·,.!?;:]/g, '').slice(0, 80)
  for (const item of pool) {
    if (used + item.text.length > budget && picked.length > 0) break
    // 宁少勿滥：凑满预算会塞进一堆边缘句，分数太低的直接收手
    if (item.score < 1.2 && picked.length > 0) break
    const n = norm(item.text)
    if (n.length > 20 && seen.some((o) => o.includes(n) || n.includes(o))) continue
    seen.push(n)
    picked.push(item)
    used += item.text.length + 2
  }
  picked.sort((a, b) => a.index - b.index)
  return { picked: picked.map((p) => ({ text: p.text, index: p.index })), total: sentences.length }
}

/**
 * 分级抽取参数。数据来源：3 轮 × 3 个长度桶的基准（bench-regimes.mjs）。
 *
 * - 短（≤3k 字）：给全文反而贵 2.2 倍只换 11 个点召回，不值 → 仍压到 1200
 * - 中（3k–15k）：全局打分已经是 Pareto 前沿，参数不动
 * - 长（>15k 字）：全局打分会被开头吃掉，前/中/后覆盖从 17/33/33 变成 83/50/50，
 *   召回 28% → 61%，代价是 token 2.5 倍 —— 这个交换在「精度优先」下值得
 */
const EXTRACT_POLICY = {
  shortMaxChars: 3000,
  midMaxChars: 15000,
  hugeMaxChars: 50000,
  shortBudget: 1200,
  midBudget: 1200,
  longBudget: 3000,
  hugeBudget: 4000,
}

/** 按页面长度选参数，再抽取。返回 {picked:[{text,index}], total}，和 pickSentences 同形。 */
function extractSmart(text, terms, policy = EXTRACT_POLICY, opts = {}) {
  // 硬门槛（0.7.2，A/B 胜出）：句子必须带上标题里的型号或标题词。
  // 百科的「相关推荐」会把同系列条目塞进正文，只按查询词打分挡不住。
  // 试过软门槛（+3/-2 打分不删句），实测东风-41 页面噪音 3/3 全回来了、token 4 倍，否决。
  const marks = (opts.distinctive || []).filter(Boolean)
  const titleWords = (opts.titleTerms || []).filter(Boolean)
  if (marks.length || titleWords.length) {
    const all = splitSentences(text)
    const kept = all.filter((s) => {
      const low = s.text.toLowerCase()
      const hit = marks.length
        ? marks.some((m) => low.includes(String(m).toLowerCase()))
        : titleWords.some((w) => low.includes(String(w).toLowerCase()))
      // 事实句开口子：讲射程/性能/版本的那句常常不含型号（“最大射程 14000 公里”），
      // 硬门槛会把答案连同噪音一起删掉。
      return hit || isFactSentence(s.text)
    })
    // 过滤太狠就不要了：至少留下 5 句
    if (kept.length >= 5) text = kept.map((s) => s.text).join(String.fromCharCode(10))
  }
  const len = text.length
  if (!len) return { picked: [], total: 0 }

  if (len <= policy.midMaxChars) {
    const budget = Math.min(len <= policy.shortMaxChars ? policy.shortBudget : policy.midBudget, len)
    return pickSentences(text, terms, budget)
  }

  // 长文档：前/中/后三段按「各有几个查询词命中」分预算，避免开头通吃
  const budget = len > policy.hugeMaxChars ? policy.hugeBudget : policy.longBudget
  const sentences = splitSentences(text)
  if (!sentences.length) return { picked: [], total: 0 }

  const size = Math.ceil(sentences.length / 3)
  const parts = [0, 1, 2].map((i) => sentences.slice(i * size, (i + 1) * size))
  const weights = parts.map((part) => {
    const slice = part.map((s) => s.text).join(' ').toLowerCase()
    let hits = 0
    for (const t of terms) if (slice.includes(t)) hits++
    return hits + 0.35 // 全无命中的段也留一点，免得整段消失
  })
  const total = weights.reduce((a, b) => a + b, 0)

  const merged = []
  let offset = 0
  parts.forEach((part, i) => {
    const slice = part.map((s) => s.text).join('\n')
    const sliceBudget = Math.max(120, Math.floor((budget * weights[i]) / total))
    for (const item of pickSentences(slice, terms, sliceBudget).picked) {
      merged.push({ text: item.text, index: offset + item.index })
    }
    offset += part.length
  })
  merged.sort((a, b) => a.index - b.index)
  return { picked: merged, total: sentences.length }
}

/** 给官方接口的调用套一层超时：fetch / search 卡住时不能把整个工具调用一起拖死。 */
function withTimeout(promise, ms, label) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} 超时（${Math.round(ms / 1000)}s）`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/** 读一个页面：先官方 fetch（直连、无 JS），不行再上真浏览器。 */
async function readPage(web, settings, url, allowBrowser) {
  const started = Date.now()
  const officialTimeoutMs = Math.min(Number(settings.pageWaitMs) || 20000, 20000)
  let note = ''
  // 只有 official 模式才碰官方 fetch；plugin 模式整条链路都走自己的浏览器，不混搭。
  if (settings.stack === 'official' && web && typeof web.fetch === 'function') {
    // 这台机器的直连会偶发超时（尤其中间断在 IPv6 上），单次失败不代表页面打不开，
    // 所以先原地重试一次，还不行才考虑升级浏览器。
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await withTimeout(web.fetch({ url }), officialTimeoutMs, '官方 fetch')
        const raw = String((res && res.body && res.body.content) || '')
        const isHtml = res && res.body && res.body.kind === 'html'
        const text = isHtml ? stripHtml(raw) : raw
        // JSON 响应（API）：压成紧凑行，别把整坨 JSON 灌进上下文。
        // 注意不能只看 content-type —— 有些 CDN 会把 application/json 报成 text/html，
        // 那就走不到这里了（实测 GameBanana 的 apiv11 就是这样）。
      let jsonNote = ''
      if (/^[[{]/.test(raw.trim())) {
        try {
          return {
            url: (res && res.url) || url, title: '', status: res.statusCode,
            text: digestJson(JSON.parse(raw), 6000), tier: 'JSON', ms: Date.now() - started, fullLen: raw.length,
          }
        } catch { jsonNote = '（JSON 解析失败，按文本处理）' }
      }
      const shell = isHtml && text.length < 300 && raw.length > 8000
        // 4xx/5xx 的页面（"Page not found"、"403 Forbidden"）正文里全是导航，
        // 当成成功就会把菜单当摘要 —— 直接判失败。
        if (res && Number(res.statusCode) >= 400) {
          note = `HTTP ${res.statusCode}`
        } else if (text.length >= 80 && !shell) {
          // 80 字符就收：example.com 那种页面正文本来就只有一百来字，
          // 用 300 当门槛会把正常短页误判成失败。
          return {
            url: (res && res.url) || url, title: isHtml ? htmlTitle(raw) : '', status: res.statusCode,
            text, tier: 'HTTP 直连', ms: Date.now() - started, fullLen: text.length,
          }
        } else {
          note = shell ? '拿到的是 JS 空壳' : '正文太短'
        }
        break
      } catch (error) {
        note = String(error && error.message ? error.message : error)
        if (attempt === 0) await sleep(400)
      }
    }
  }
  if (!allowBrowser) {
    return { url, error: note || '抓取失败', tier: 'HTTP 直连', ms: Date.now() - started, fullLen: 0 }
  }
  try {
    const r = await run(settings, { url, action: 'text', proxy: 'auto' })
    const text = String(r.text || '')
    // JSON 端点：Chrome 会把 JSON 原样渲染成文本，这里同样压成紧凑行，保住「JSON 直读」的收益
    if (/^[[{]/.test(text.trim())) {
      try {
        return {
          url: r.url || url, title: '', status: 200, text: digestJson(JSON.parse(text), 6000),
          tier: 'JSON(浏览器)', ms: Date.now() - started, fullLen: text.length,
        }
      } catch {}
    }
    if (text.trim().length >= 200) {
      return {
        url: r.url || url, title: r.title || '', status: 200, text,
        tier: '浏览器(' + (r.route === 'proxy' ? '代理' : '直连') + ')', ms: Date.now() - started, fullLen: text.length,
      }
    }
    return { url, error: `浏览器也只拿到 ${text.length} 字`, tier: '浏览器', ms: Date.now() - started, fullLen: 0 }
  } catch (error) {
    return {
      url, error: String(error && error.message ? error.message : error),
      tier: '浏览器', ms: Date.now() - started, fullLen: 0, fallbackNote: note,
    }
  }
}

// ---------------------------------------------------------------- 浏览器搜索

const SEARCH_ENGINES = {
  bing: (q) => 'https://cn.bing.com/search?q=' + encodeURIComponent(q),
  google: (q) => 'https://www.google.com/search?q=' + encodeURIComponent(q),
  baidu: (q) => 'https://www.baidu.com/s?wd=' + encodeURIComponent(q),
  '360': (q) => 'https://www.so.com/s?q=' + encodeURIComponent(q),
}

/** 结果页里所有「像正文结果」的链接。引擎自己的域名、站内导航都过滤掉。 */
const EXTRACT_LINKS_JS = `(() => {
  const ENGINE = /(^|\\.)(bing|google|baidu|so|microsoft|msn|yandex|duckduckgo)\\.(com|cn|net)/i;
  const out = [], seen = new Set();
  for (const a of document.querySelectorAll('a[href^="http"]')) {
    const raw = a.innerText || '';
    const lines = raw.split('\\n').map((x) => x.trim()).filter(Boolean);
    // 标题可能在 <a> 里，也可能在它所在的结果卡片里（Bing 的 a 有时只包住网址）。
    const scope = a.closest('li, article, section') || a.parentElement;
    const head = a.querySelector('h2, h3') || (scope && scope.querySelector('h2, h3'));
    const pick = head
      ? head.innerText.trim()
      : (lines.filter((l) => l.length <= 120).sort((x, y) => y.length - x.length)[0] || '');
    const text = pick.replace(/\\s+/g, ' ').trim();
    if (text.length < 8) continue;
    const href = a.href;
    try { if (ENGINE.test(new URL(href).hostname)) continue; } catch { continue; }
    if (seen.has(href)) continue;
    seen.add(href);
    out.push({ href, text: text.slice(0, 180) });
    if (out.length >= 60) break;
  }
  return out;
})()`

/**
 * 用真浏览器搜：DOM 里的 href 是引擎自己 JS 解出来的**真实地址**，
 * 不会出现 360 的 so.com/link、Bing 的 ck/a 这类跳转壳。
 */
async function searchWithBrowser(settings, engine, query, limit, proxyMode) {
  const build = SEARCH_ENGINES[engine] || SEARCH_ENGINES.bing
  const r = await run(settings, {
    url: build(query), action: 'eval', js: EXTRACT_LINKS_JS, proxy: proxyMode, wait_ms: 1500,
  })
  const raw = Array.isArray(r.value) ? r.value : []
  const seenUrl = new Set()
  const perHost = new Map()
  const results = []
  for (const item of raw) {
    if (!item || !item.href) continue
    // Bing 会把选中文字编成 #:~:text=… 片段挂在 URL 上，纯噪音，剪掉
    const clean = String(item.href).replace(/#:~:text=[^#]*$/i, '')
    let host = ''
    try { host = new URL(clean).hostname.replace(/^www\./, '') } catch { continue }
    if (seenUrl.has(clean)) continue
    // 同站最多两条：全折叠会把 10 条压成 5 条，全放开又会被一个站刷屏
    if ((perHost.get(host) || 0) >= 2) continue
    seenUrl.add(clean)
    perHost.set(host, (perHost.get(host) || 0) + 1)
    let title = String(item.text || '').trim()
    if (!title || /^https?:\/\//i.test(title) || title === host) title = host
    results.push({ url: clean, title: title.slice(0, 120), host })
    if (results.length >= limit) break
  }
  return { results, engine, route: r.route, seconds: r.seconds }
}

function summarizeDrops(dropped) {
  const counts = new Map()
  for (const item of dropped) {
    const reason = item.reason || '低质'
    counts.set(reason, (counts.get(reason) || 0) + 1)
  }
  return [...counts.entries()].map(([reason, n]) => `${reason} ${n}`).join(' / ')
}

function explicitAliasList(raw) {
  return String(raw || '').split(/[,，、;；]/).map((s) => s.trim()).filter(Boolean).slice(0, 4)
}

function mergeAliasLists(explicit, automatic, cleaned) {
  const out = []
  const seen = new Set([String(cleaned || '').toLowerCase()])
  for (const name of [...explicit, ...automatic]) {
    const text = String(name || '').trim()
    const key = text.toLowerCase()
    if (!text || seen.has(key)) continue
    seen.add(key)
    out.push(text)
    if (out.length >= 4) break
  }
  return out
}

function formatFindText({ banner, profile, explicitAliases, autoAliases, engine, route, seconds, shown, dropped }) {
  const cleaned = profile.cleaned || profile.raw
  const head = [banner || '[web_find]']
  if (profile.stripped && profile.raw && profile.raw !== cleaned) {
    head[0] += ` 原查询：${profile.raw}`
    head.push(`清洗：${cleaned}`)
  } else {
    head[0] += ` ${cleaned}`
  }
  const aliasBits = []
  if (explicitAliases.length) aliasBits.push('指定 ' + explicitAliases.join(' / '))
  if (autoAliases.length) aliasBits.push('自动 ' + autoAliases.join(' / '))
  if (aliasBits.length) head.push('别名：' + aliasBits.join('；'))
  const dropNote = dropped.length ? ` · 弃用 ${dropped.length}（${summarizeDrops(dropped)}）` : ''
  head.push(`引擎 ${engine} · 出口 ${route === 'proxy' ? '代理' : '直连'} · 合计 ${Number(seconds || 0).toFixed(1)}s · 采用 ${shown.length}${dropNote}`)
  const lines = shown.map((r, i) => {
    const star = i < 3 ? '★ ' : ''
    const matched = r.matched
    const matchedList = matched && typeof matched[Symbol.iterator] === 'function' ? [...matched] : []
    const tag = matchedList.length > 1 ? ` · 匹配「${matchedList.join('/')}」` : ''
    const weak = r._weak ? ' · 弱相关' : ''
    const ov = profile.core && profile.core.length ? ` · 重合 ${Math.round(((r.overlap && r.overlap.ratio) || 0) * 100)}%` : ''
    return `${i + 1}. ${star}${r.title}${ov}${tag}${weak}\n   ${r.url}`
  })
  const dropLines = dropped.slice(0, 4).map((d) => `- ${String(d.title || d.host || d.url).slice(0, 80)}（${d.reason}）`)
  const body = lines.length ? lines.join('\n\n') : '（本引擎没有可采用的标题）'
  const dropBlock = dropLines.length ? `\n\n弃用：\n${dropLines.join('\n')}` : ''
  return `${head.filter(Boolean).join('\n')}\n\n${body}${dropBlock}\n\n建议深挖：标 ★ 的链接交给 web_digest({ urls })，不要再连搜。`
}

/** web_find 与 web_digest({ links_only }) 共用：清洗 → 多路召回 → 标题重排。 */
async function runFind(live, opts) {
  const query = String(opts.query || '').trim()
  const profile = normalizeQuery(query)
  const limit = Math.min(15, Math.max(3, Number(opts.limit) || 8))
  const pool = Math.min(15, Math.max(limit, 8))
  const mode = String(opts.proxy || live.proxyMode || 'auto')
  const wanted = String(opts.engine || 'auto').toLowerCase()
  const order = wanted !== 'auto' && SEARCH_ENGINES[wanted] ? [wanted] : ['bing', 'google', 'baidu']
  const explicit = explicitAliasList(opts.aliases)
  const auto = (profile.aliases || []).slice(0, explicit.length ? 4 : 2)
  const aliases = mergeAliasLists(explicit, auto, profile.cleaned)
  const queries = [profile.cleaned || query]
  for (const name of aliases) {
    if (!queries.some((q) => q.toLowerCase() === name.toLowerCase())) queries.push(name)
  }
  const notes = []

  for (const engine of order) {
    try {
      const merged = new Map()
      let route = 'direct'
      let seconds = 0
      for (const q of queries) {
        try {
          const found = await searchWithBrowser(live, engine, q, pool, mode)
          route = found.route || route
          seconds += Number(found.seconds) || 0
          notes.push(`${engine}「${q}」${found.results.length} 条`)
          for (const r of found.results) {
            const prev = merged.get(r.url)
            if (prev) prev.matched.add(q)
            else merged.set(r.url, { ...r, matched: new Set([q]) })
          }
        } catch (error) {
          notes.push(`${engine}「${q}」失败：${String(error && error.message ? error.message : error).slice(0, 80)}`)
        }
        if (merged.size >= pool) break
      }
      if (!merged.size) continue
      // 同一个页面常以不同形态进池（跟踪参数 / 尾斜杠 / 大小写域名），
      // 先按规范化 URL 合并，**再**排序取前 limit 条：
      //   · 排在后面合，合并掉的名额不会被候补结果补上（采用 5 条而不是 8 条）；
      //   · 排在前面合，排序看到的就是互不重复的池子，名额能填满。
      const seenUrl = new Set()
      const poolItems = []
      let dupes = 0
      for (const item of merged.values()) {
        const key = normalizeUrl(item.url || '')
        if (key && seenUrl.has(key)) { dupes++; continue }
        if (key) seenUrl.add(key)
        poolItems.push(item)
      }
      if (dupes) notes.push(`${engine} 重复链接 ${dupes} 条已合并`)
      const ranked = rankSearchResults(poolItems, profile, { strict: false })
      const shown = [...ranked.adopted, ...ranked.weak].slice(0, limit)
      if (shown.length < 3 && engine !== order[order.length - 1]) {
        notes.push(`${engine} 采用 ${shown.length}（不足 3，换引擎）`)
        continue
      }
      const text = formatFindText({
        banner: opts.banner || '[web_find]',
        profile,
        explicitAliases: explicit.filter((n) => aliases.some((a) => a.toLowerCase() === n.toLowerCase())),
        autoAliases: aliases.filter((n) => !explicit.some((e) => e.toLowerCase() === n.toLowerCase())),
        engine,
        route,
        seconds,
        shown,
        dropped: ranked.dropped,
      })
      return { ok: shown.length > 0, text, profile, shown, dropped: ranked.dropped, notes }
    } catch (error) {
      notes.push(`${engine} 失败：${String(error && error.message ? error.message : error)}`)
    }
  }
  return {
    ok: false,
    text: `没有搜到可用结果。\n${notes.join('\n')}`,
    profile,
    shown: [],
    dropped: [],
    notes,
  }
}

// ---------------------------------------------------------------- tools

export function apply(ctx, config) {
  const settings = resolveSettings(config)

  const webServer = typeof ctx.get === 'function' ? ctx.get('webServer') : undefined
  if (webServer && typeof webServer.register === 'function') {
    // ctx.effect 要的是「返回 disposer 的工厂」，直接传 register() 的结果会让路由当场自我注销。
    ctx.effect(
      () =>
        webServer.register({
          kind: 'exact',
          path: '/_browser-kernel/settings',
          handler: async (req, res) => {
            try {
              const live = resolveSettings(config)
              if (req.method === 'GET') {
                // ?session=<id> 时返回该会话的实际使用方式（每个对话可以不同）
                let sid = ''
                try {
                  const q = String(req.url || '').split('?')[1] || ''
                  sid = (new URLSearchParams(q).get('session') || '').trim()
                } catch {}
                sendJson(res, 200, await snapshot(live, sid))
                return
              }
              if (req.method === 'POST') {
                const body = await readJsonBody(req)
                let patch
                try {
                  patch = sanitizePatch(body || {})
                } catch (error) {
                  sendJson(res, 400, { ok: false, error: String(error && error.message ? error.message : error) })
                  return
                }
                if (Object.keys(patch).length === 0) {
                  sendJson(res, 400, { ok: false, error: '没有可更新的字段' })
                  return
                }
                const before = resolveSettings(config)
                writeSettingsFile(patch)
                const next = resolveSettings(config)
                // 内核路径 / 端口变了，旧进程就不再对应新设置；先关掉，下次调用按新参数拉起。
                if (before.port !== next.port || before.chromePath !== next.chromePath) {
                  await stopChrome(before.port)
                } else if (browserState.proxy !== null) {
                  // 代理档变了也要重启浏览器：Chrome 的代理是启动参数，不是请求级设置。
                  const mode = next.proxyMode
                  const wantProxy = mode === 'always' ? true : mode === 'never' ? false : browserState.proxy
                  if (wantProxy !== browserState.proxy) await stopChrome(next.port)
                }
                sendJson(res, 200, await snapshot(next, body && body.sessionId ? String(body.sessionId) : ''))
                return
              }
              sendJson(res, 405, { ok: false, error: 'GET / POST only' })
            } catch (error) {
              sendJson(res, 500, { ok: false, error: String(error && error.message ? error.message : error) })
            }
          },
        }),
      'dsh-websift: settings route',
    )
    // Clash Verge：GET 看状态，POST { action: "start" } 启动
    ctx.effect(
      () => webServer.register({
        kind: 'exact',
        path: '/_browser-kernel/clash',
        handler: async (req, res) => {
          try {
            const live = resolveSettings(config)
            if (req.method === 'GET') {
              sendJson(res, 200, { ok: true, clash: await clashStatus(live) })
              return
            }
            if (req.method === 'POST') {
              const body = await readJsonBody(req)
              if (body && body.action === 'start') {
                const r = await startClash(live)
                sendJson(res, 200, { ok: r.ok, result: r, clash: await clashStatus(live) })
                return
              }
              sendJson(res, 400, { ok: false, error: '只支持 { action: "start" }' })
              return
            }
            sendJson(res, 405, { ok: false, error: 'GET / POST only' })
          } catch (error) {
            sendJson(res, 500, { ok: false, error: String((error && error.message) || error) })
          }
        },
      }),
      'dsh-websift: clash',
    )

    // 内核候选：设置面板的「自动探测」按钮用
    ctx.effect(
      () => webServer.register({
        kind: 'exact',
        path: '/_browser-kernel/chrome-candidates',
        handler: async (req, res) => {
          if (req.method !== 'GET') {
            sendJson(res, 405, { ok: false, error: 'GET only' })
            return
          }
          try {
            const live = resolveSettings(config)
            sendJson(res, 200, {
              ok: true,
              current: live.chromePath || '',
              auto: Boolean(live._chromeAuto),
              candidates: listChromeCandidates(),
            })
          } catch (error) {
            sendJson(res, 500, { ok: false, error: String((error && error.message) || error) })
          }
        },
      }),
      'dsh-websift: chrome candidates',
    )
  }


  ctx.tools.register(
    defineTool({
      name: 'browser',
      description:
        '用本机真实 Chrome 内核（headless + CDP）打开网页，拿到 **JS 渲染之后** 的内容。' +
        '适合普通 web_fetch 搞不定的场景：需要执行 JS 的页面、要读 DOM 结构、要截图、或者被墙的站点（自动走本机 Clash 代理）。\n\n' +
        '动作（action）：\n' +
        '- `text`（默认）：返回页面正文纯文本\n' +
        '- `html`：返回 outerHTML（配合 max_chars 截取）\n' +
        '- `eval`：在页面里执行 js 表达式并返回结果，例如 `document.querySelectorAll("h2").length`、`[...document.querySelectorAll("a")].map(a=>a.href)`\n' +
        '- `screenshot`：整页 PNG 截图存到磁盘并返回路径，之后用 read_image 看\n' +
        '- `login`：**弹出可见窗口让你自己登录**（扫码/验证码/密码都行）。我不接触你的密码，' +
        '登录成功后 cookie 存进插件自己的 profile，后续调用自动带上。可用 `wait_until` 指定成功标志、' +
        '`timeout_s` 设等待秒数（默认 180，最少 20）。\n\n' +
        '代理：默认 `auto`（每个新域名先试直连 2.5s，不通自动走代理，结果缓存 10 分钟）。' +
        '单次可用 `proxy` 参数覆盖：`always` 强制代理、`never` 强制直连。' +
        '浏览器空闲 5 分钟自动关闭（约 700MB 内存），不需要手动清理。\n\n' +
        '注意：首次调用要拉起浏览器，约 3–6 秒；之后的调用约 1–3 秒。',
      parameters: {
        url: { type: 'string', required: true, description: '要打开的完整 URL（含 https://）' },
        action: { type: 'string', description: 'text | html | eval | screenshot | login，默认 text；login = 弹出窗口让你自己登录' },
        wait_until: { type: 'string', description: 'action=login 时，出现这个 CSS 选择器就算登录成功（可选）' },
        timeout_s: { type: 'number', description: 'action=login 的等待秒数，默认 180，最多 600' },
        actions: {
          type: 'string',
          description:
            '批量页面动作（JSON 数组，最多 12 个），在取正文之前一次性做完，只返回最终页面。' +
            '例：[{"click":"a.morelink"},{"wait":800},{"scroll":"bottom"}]；' +
            'click 可以是 CSS 选择器或按钮文字；scroll 支持 bottom 或像素值；type 用 {"selector":"#q","text":"xx"}。' +
            '任何一个动作找不到目标就停止，并在结果里写明哪一步失败。',
        },
        wait_js: {
          type: 'string',
          description:
            'action=login 的判定表达式（推荐）。返回真即视为登录成功，例如 ' +
            '!!document.querySelector("meta[name=user-login]").content 。' +
            '比 wait_until 选择器更准，因为很多站点的选择器未登录也存在。',
        },
        js: { type: 'string', description: 'action=eval 时执行的 JS 表达式' },
        wait_ms: { type: 'number', description: '页面 readyState 完成后再等多久（毫秒），默认 600；SPA 建议 1500–3000' },
        max_chars: { type: 'number', description: '返回文本的最大字符数，默认 4000' },
        proxy: { type: 'string', description: 'auto | always | never，覆盖全局代理模式' },
        full_page: { type: 'boolean', description: '截图是否整页，默认 true' },
        out: { type: 'string', description: '截图保存路径（可选，默认存到 ~/.dsh/storages/browser-kernel/shots/）' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (args, value) => [{ type: 'text', text: render(value, Number(args.max_chars) > 0 ? Number(args.max_chars) : 4000) }],
      },
      execute: async (args, exec) => {
        try {
          if (currentUsage(exec) === 'off') return { text: OFF_TEXT }
          if (String(args.action || '').toLowerCase() === 'login') {
            const live = resolveSettings(config)
            if (!args.url) return { summary: 'action=login 需要 url（登录页地址）' }
            const r = await loginFlow(live, args)
            const lines = []
            if (r.ok) {
              lines.push('✅ 登录成功（检测到「' + r.via + '」）')
              lines.push('当前页面：' + (r.title || ''))
              lines.push(r.url)
              lines.push('cookie ' + r.cookiesFrom + ' → ' + r.cookiesTo + ' · 用时 ' + r.seconds + 's')
              lines.push('登录状态已存进插件自己的 profile，之后的 web_find / web_digest 会自动带上。')
            } else {
              lines.push('⏳ ' + r.seconds + 's 内没检测到登录完成。')
              lines.push('窗口还开着——你可以继续操作，完成后让我再跑一次 login 检查。')
              lines.push('当前页面：' + r.url)
            }
            return { summary: lines.join(String.fromCharCode(10)), login: r }
          }
          return await run(settings, args)
        } catch (error) {
          const message = String(error && error.message ? error.message : error)
          return { url: args.url || '', title: '', route: 'unknown', seconds: 0, text: '调用失败：' + message }
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'browser_proxy',
      description:
        '查看或切换 browser 工具的代理模式，立即生效、不用重启 DSH。\n\n' +
        '模式：`auto` 每个新域名先探测直连、不通才走代理；`always` 一律走代理；`never` 一律直连。\n' +
        '动作：`status` 查看当前设置与浏览器状态；`set` 切换模式；`test` 对某个 URL 探测走直连还是代理；`stop` 关掉浏览器。',
      parameters: {
        action: { type: 'string', description: 'status | set | test | stop，默认 status' },
        mode: { type: 'string', description: 'action=set 时的新模式：auto | always | never' },
        url: { type: 'string', description: 'action=test 时要探测的 URL 或其域名' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [{ type: 'text', text: value.text }],
      },
      execute: async (args) => {
        const action = String(args.action || 'status').toLowerCase()
        const current = resolveSettings(config)
        const version = await ping(current.port)

        if (action === 'set') {
          const mode = String(args.mode || '').toLowerCase()
          if (!['auto', 'always', 'never'].includes(mode)) {
            return { text: `mode 必须是 auto / always / never，收到：${args.mode || '(空)'}` }
          }
          const saved = writeSettingsFile({ proxyMode: mode })
          const note = saved._writeError ? `\n⚠️ 写入配置文件失败（仅本次进程内生效）：${saved._writeError}` : ''
          // 和设置页走同一套逻辑：参数对不上就关掉浏览器，下次调用重新按新档拉起。
          if (browserState.proxy !== null) {
            const wantProxy = mode === 'always' ? true : mode === 'never' ? false : browserState.proxy
            if (wantProxy !== browserState.proxy) await stopChrome(current.port)
          }
          return {
            text: `代理模式已改为 **${mode}**，下次调用 browser 即生效。\n` +
              `代理地址：${current.proxyUrl}${note}\n` +
              `浏览器当前：${version ? `运行中（端口 ${current.port}，${browserState.proxy ? '走代理' : '直连'}）` : '未启动'}`,
          }
        }

        if (action === 'test') {
          if (!args.url) return { text: 'action=test 需要 url' }
          const target = /^https?:\/\//i.test(args.url) ? args.url : 'https://' + args.url
          routeCache.delete(hostOf(target))
          const route = await probeRoute(hostOf(target), current.proxyUrl)
          return { text: `${hostOf(target)} → **${route === 'proxy' ? '走代理' : '直连可用'}**（探测结果缓存 10 分钟）` }
        }

        if (action === 'clash') {
          const st = await clashStatus(current)
          return {
            text: [
              `Clash Verge：${st.running ? '运行中' : '未运行'}`,
              `代理地址：${st.proxyUrl || '（未配置）'}`,
              `程序路径：${st.path || '（没找到，可在设置里填或设 DSH_CLASH）'}`,
              `自动启动：${st.autoStart ? '开（代理不通时自动拉起）' : '关'}`,
              '',
              `项目：${st.repo}`,
              `作者：${st.author}（${st.license}）`,
            ].join('\n'),
          }
        }

        if (action === 'clash-start') {
          const r = await startClash(current)
          const st = await clashStatus(current)
          return {
            text: r.ok
              ? `✅ Clash Verge 已就绪${r.already ? '（本来就在跑）' : `（等待 ${r.waitedMs || 0}ms）`}\n程序：${r.path || st.path}\n代理：${st.proxyUrl}`
              : `⚠️ ${r.error}${r.path ? '\n程序：' + r.path : ''}`,
          }
        }

        if (action === 'stop') {
          await stopChrome(current.port)
          return { text: '浏览器已关闭。' }
        }

        const cached = [...routeCache.entries()].slice(-5).map(([h, v]) => `  ${h} → ${v.route}`)
        return {
          text: [
            `代理模式：**${current.proxyMode}**`,
            `代理地址：${current.proxyUrl}`,
            `浏览器：${version ? `运行中，端口 ${current.port}，${browserState.proxy ? '走代理' : '直连'}` : '未启动'}`,
            `可视模式：${current.visible ? '开（窗口可见）' : '关（headless）'}`,
            `空闲关闭：${Math.round(Number(current.idleMs) / 1000)}s`,
            `内核：${current.chromePath || '（未找到）'}${current._chromeAuto ? '（自动探测）' : ''}`,
            `设置文件：${SETTINGS_PATH}`,
            cached.length ? `最近探测：\n${cached.join('\n')}` : '最近探测：(无)',
          ].join('\n'),
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'web_digest',
      description:
        '把「查资料」压成一次调用：搜索（或给定链接）→ 抓正文 → 按相关性筛选 → 抽取并合并关键句 → 返回紧凑摘要。' +
        'HTTP 抓不到、或只拿到 JS 空壳时，自动升级到真浏览器（直连不通再走代理）。\n\n' +
        '三个设计点：\n' +
        '1) 相关性闸门：正文里真的出现查询词才算命中；不相关的页面会被跳过并在头部列出。' +
        '如果一页都没命中，不硬凑摘要，而是直接返回按查询词重排过的候选链接，让你换链接或换说法。\n' +
        '2) 连贯：相邻句合并成段落，而不是一行一句的碎片。\n' +
        '3) 省 token：整页正文只进宿主进程，返回头自带压缩比与 token 估算；抽取不调用模型，零额外 token。\n' +
        '4) 搜前会去掉「帮我搜一下 / 是什么」这类指令壳。人话可以传，但关键词更稳。\n\n' +
        '少连调：一个主题一次即可，推荐 max_pages 2–3、budget_chars 3000（要数字再用 4000）。' +
        '先看链接用 links_only，选定后用 urls 深挖，不要换个说法再搜一轮。' +
        'strict=true 时不抓标题里没有查询词的页，正文闸门也更严。\n\n' +
        '适合：快速了解主题、多来源核对、只要结论不要全文。要逐字读某段或看排版，改用 web_fetch / browser。',
      parameters: {
        query: { type: 'string', description: '搜索词。指令壳会先洗掉（「帮我搜一下东风41的射程是多少」→「东风41的射程」）。给了 urls 时可省略' },
        urls: { type: 'string', description: '可选，逗号或空格分隔的直接链接；给了就跳过搜索，只深挖这些页' },
        max_pages: { type: 'number', description: '最多读几个页面，默认 3，上限 6。一个主题 2–3 页通常够，不要连调加页' },
        budget_chars: { type: 'number', description: '摘要的总字符预算，默认 3000（600–20000）。要参数/数字时用 4000' },
        allow_browser: { type: 'boolean', description: 'HTTP 抓不到时是否升级到真浏览器，默认 true' },
        strict: { type: 'boolean', description: '更严：标题与查询词零重合的链接不抓；正文须命中 ≥3 个词或 ≥45% 且至少含一个核心词。默认 false' },
        links_only: { type: 'boolean', description: '只返回排好序的真实链接，不抓正文。选定后再用 urls 深挖。给了 urls 时忽略此项' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [{ type: 'text', text: value.text }],
      },
      execute: async (args, exec) => {
        const live = resolveSettings(config)
        if (currentUsage(exec) === 'off') return { text: OFF_TEXT }
        const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n))
        const budget = clamp(Number(args.budget_chars) || live.budgetChars || 3000, 600, 20000)
        const maxPages = clamp(Number(args.max_pages) || 3, 1, 6)
        const allowBrowser = args.allow_browser !== false
        const strict = args.strict === true
        const query = String(args.query || '').trim()
        const profile = normalizeQuery(query)
        const searchQuery = profile.cleaned || query
        const web = typeof ctx.get === 'function' ? ctx.get('web') : undefined

        if (args.links_only && !args.urls) {
          if (!query) return { text: 'links_only 需要 query；已经有链接就传 urls，不要再搜。' }
          const found = await runFind(live, {
            query,
            engine: 'auto',
            limit: clamp(Number(args.limit) || 8, 3, 15),
            proxy: live.proxyMode,
            banner: '[web_digest] 仅链接 · 未抓正文',
          })
          return { text: found.text + modeTail(exec) }
        }

        const urls = []
        const searchTitles = new Map()
        const searchSnippets = new Map()
        let candidates = []
        let searchNote = ''

        if (args.urls) {
          for (const u of String(args.urls).split(/[\s,]+/)) {
            if (urls.length >= maxPages) break
            if (/^https?:\/\//i.test(u)) urls.push(u)
          }
        } else {
          if (!query) return { text: '需要 query（搜索词）或 urls（直接给链接）。' }

          let sources = []
          // 只有 official 模式才碰官方 provider（见 DEFAULTS.stack）：默认 plugin 模式完全不调，
          // 免得多个 provider 共存时抛 ambiguous，把报错挂在每次结果上。
          // 设置里打开才试；打开后失败才如实记下来。
          let triedBuiltin = false
          if (live.stack === 'official' && web && typeof web.search === 'function') {
            triedBuiltin = true
            try {
              const res = await withTimeout(
                web.search({ query: searchQuery, maxResults: Math.max(8, maxPages * 3) }),
                Math.min(Number(live.pageWaitMs) || 20000, 20000),
                '官方 search',
              )
              sources = res.sources || []
            } catch (error) {
              searchNote = String(error && error.message ? error.message : error)
            }
          }

          // 没有 search provider（或它挂了）：自己用真浏览器搜。
          // 浏览器 DOM 里的 href 是真实地址，不会像 HTML 抓取那样拿到 so.com/link 的跳转壳。
          if (sources.length === 0) {
            try {
              const found = await searchWithBrowser(live, 'bing', searchQuery, Math.max(8, maxPages * 3), 'auto')
              sources = found.results.map((r) => ({ url: r.url, title: r.title }))
              if (triedBuiltin && !searchNote) searchNote = '内置搜索未启用，改用浏览器搜索'
            } catch (error) {
              const message = String(error && error.message ? error.message : error)
              searchNote = searchNote ? `${searchNote}; 浏览器搜索也失败：${message}` : `浏览器搜索失败：${message}`
            }
          }

          const ranked = rankSearchResults(
            sources
              .filter((source) => source && /^https?:\/\//i.test(source.url || ''))
              .map((source) => ({
                url: source.url,
                title: source.title || '',
                snippet: source.snippet || '',
                host: hostOf(source.url),
              })),
            profile,
            { strict },
          )
          candidates = [...ranked.adopted, ...ranked.weak]
          if (ranked.dropped.length) {
            searchNote = [searchNote, `标题门槛弃用 ${ranked.dropped.length} 条`].filter(Boolean).join('; ')
          }
          const pick = strict ? ranked.adopted : (ranked.adopted.length ? ranked.adopted : candidates)

          const seen = new Set()
          const take = (list) => {
            for (const source of list) {
              if (urls.length >= maxPages) break
              const host = hostOf(source.url)
              if (!host || seen.has(host)) continue
              seen.add(host)
              urls.push(source.url)
              if (source.title) searchTitles.set(source.url, source.title)
              if (source.snippet) searchSnippets.set(source.url, source.snippet)
            }
          }
          take(pick)

          if (!urls.length && query) {
            const pool = (candidates.length ? candidates : ranked.dropped).slice(0, 6)
            const list = pool.map((c, i) => {
              const why = c.reason ? `（${c.reason}）` : ''
              const snippet = c.snippet ? `\n   ${String(c.snippet).replace(/\s+/g, ' ').slice(0, 150)}` : ''
              return `${i + 1}. ${String(c.title || hostOf(c.url) || c.url).slice(0, 100)}${why}${snippet}\n   ${c.url}`
            })
            const head = profile.stripped ? `原查询：${query}\n清洗：${searchQuery}` : `查询：${searchQuery}`
            return {
              text: `[web_digest] ${head}\n` +
                `命中 0 · 跳过 0 · 没有页面值得抓` +
                `${strict ? '（strict：标题与查询词不够重合）' : ''}。\n\n` +
                `建议 url：\n\n${list.join('\n\n') || '（无）'}\n\n` +
                `选定一条再 web_digest({ urls })，不要换说法连搜。` +
                (profile.aliases.length ? `\n可改用的别名：${profile.aliases.join(' / ')}` : ''),
            }
          }
        }

        if (!urls.length) {
          return { text: `没有可读的链接。${searchNote ? '搜索失败：' + searchNote : ''}` }
        }

        // 按规范化 URL 去重：同一篇文章常以 ?from=xx、#锚点 等不同形态出现两次
        const unique = [...new Map(urls.map((u) => [normalizeUrl(u), u])).values()]
        if (unique.length !== urls.length) {
          searchNote = [searchNote, `重复链接 ${urls.length - unique.length} 条已合并`].filter(Boolean).join('; ')
          urls.splice(0, urls.length, ...unique)
        }

        const pages = await Promise.all(
          urls.map(async (u) => {
            const key = normalizeUrl(u)
            const hit = cacheGet(key)
            if (hit) return { ...hit, url: u, ms: 0, cached: true }
            const page = await readPage(web, live, u, allowBrowser).catch((error) => ({
              url: u, error: String(error && error.message ? error.message : error), tier: '失败', ms: 0, fullLen: 0,
            }))
            if (page && page.text) cacheSet(key, page)
            return page
          }),
        )

        const terms = queryTerms(searchQuery || query)
        const core = (profile.core || []).filter((term) => term.length >= 2)

        // 抓完再合一次，两种依据：
        //   ① 最终 URL —— 站内跳转可能把不同请求落到同一页；
        //   ② 正文指纹 —— 服务层 fetch 不一定回传重定向后的 URL（实测 ctx.web.fetch
        //      回的仍是请求 URL），那就按内容判断：同一篇正文只留第一条。
        const seenFinal = new Set()
        const seenFingerprint = new Set()
        const pagesMerged = []
        let mergedByFinal = 0
        let mergedByContent = 0
        for (const page of pages) {
          const key = page && page.url ? normalizeUrl(page.url) : ''
          if (key && seenFinal.has(key)) {
            mergedByFinal++
            continue
          }
          const fp = textFingerprint(page && page.text)
          if (fp && seenFingerprint.has(fp)) {
            mergedByContent++
            continue
          }
          if (key) seenFinal.add(key)
          if (fp) seenFingerprint.add(fp)
          pagesMerged.push(page)
        }
        if (mergedByFinal) {
          searchNote = [searchNote, `重定向重复 ${mergedByFinal} 条已合并`].filter(Boolean).join('; ')
        }
        if (mergedByContent) {
          searchNote = [searchNote, `内容重复 ${mergedByContent} 条已合并`].filter(Boolean).join('; ')
        }

        // 相关性闸门：正文里真的出现查询词才算命中。宁可回「没找到」，
        // 也不要把一篇无关的文章当答案（实测：查 clash TUN 会抓到反邪教宣传页）。
        const scoredPages = pagesMerged.map((page) => {
          if (!page.text) return { page, hits: 0, relevant: false }
          const hits = countHits(page.text, terms)
          const ratio = terms.length ? hits / terms.length : 1
          const coreHits = countHits(page.text, core)
          const loose = terms.length === 0 || hits >= 2 || ratio >= 0.3
          const tight = terms.length === 0 || ((hits >= 3 || ratio >= 0.45) && (coreHits >= 1 || core.length === 0))
          // 显式给了 urls 就直接读，不做相关性过滤（那是用户点名的链接）。
          return { page, hits, ratio, relevant: Boolean(args.urls) || (strict ? tight : loose) }
        })
        const relevant = scoredPages.filter((s) => s.relevant)
        const skipped = scoredPages.filter((s) => s.page.text && !s.relevant)

        // 一条都没命中：把（按查询词重排过的）搜索结果当线索返回，
        // 我据此换链接或换说法，而不是硬凑三段摘要。
        if (relevant.length === 0 && query && !args.urls) {
          const pool = candidates.length
            ? candidates
            : urls.map((u) => ({ url: u, title: searchTitles.get(u) || '' }))
          const list = pool.slice(0, 6).map((c, i) => {
            const snippet = c.snippet ? `\n   ${String(c.snippet).replace(/\s+/g, ' ').slice(0, 150)}` : ''
            return `${i + 1}. ${String(c.title || hostOf(c.url) || c.url).slice(0, 100)}${snippet}\n   ${c.url}`
          })
          const qHead = profile.stripped && profile.cleaned && profile.cleaned !== query
            ? `原查询：${query}\n清洗：${profile.cleaned}`
            : `查询：${searchQuery || query}`
          return {
            text: `[web_digest] ${qHead}\n` +
              `命中 0/${pages.length} · 跳过 ${skipped.length}\n` +
              `没有页面真正命中` +
              `${skipped.length ? '：' + skipped.map((s) => hostOf(s.page.url)).join(' / ') + '（查询词不足）' : ''}。\n\n` +
              `建议 url：\n\n${list.join('\n\n')}\n\n` +
              `选定一条再 web_digest({ urls })，不要换说法连搜。` +
              (profile.aliases.length ? `\n可改用的别名：${profile.aliases.join(' / ')}` : ''),
          }
        }

        // 预算按「真正命中的页面」平分：失败页和不相关页不该占走份额。
        const perPage = Math.max(240, Math.floor((budget - 220) / Math.max(1, relevant.length)))
        const blocks = []
        let rawTotal = 0
        let outChars = 0

        const seenSentences = new Set()
        let crossDup = 0

        relevant.forEach(({ page, hits }, index) => {
          rawTotal += page.text.length
          const rawTitle = page.title || searchTitles.get(page.url) || ''
          const marks = String(rawTitle).match(/[A-Za-z]{2,}|\d{2,}/g) || []
          // 标题词：去掉「百度百科」「（……）」这类装饰后，剩下的实词
          const titleTerms = String(rawTitle)
            .replace(/[（(][^）)]*[）)]/g, ' ')
            .replace(/百度百科|维基百科|官网|官方|首页/g, ' ')
            .split(/[^\p{L}\p{N}]+/u)
            .filter((w) => w.length >= 2 && !/^[0-9]+$/.test(w))
            .slice(0, 4)

          // JSON（API 响应）已经是一行一条的结构化数据，再做句子抽取只会把记录撕碎
          if (page.tier === 'JSON') {
            const body = page.text.slice(0, perPage)
            outChars += body.length + 60
            blocks.push(
              `${index + 1}. ${hostOf(page.url)} · API 数据 · ${(page.ms / 1000).toFixed(1)}s\n` +
                `   ${page.url}\n` + body.split('\n').map((l) => '   ' + l).join('\n'),
            )
            return
          }

          const { picked, total } = extractSmart(page.text, terms, {
            shortMaxChars: live.shortMaxChars,
            midMaxChars: live.midMaxChars,
            hugeMaxChars: live.hugeMaxChars,
            shortBudget: perPage,
            midBudget: perPage,
            // 长页允许超过用户给的单页预算：3k 字以下压到 1200 已经把信息压没了
            longBudget: Math.max(perPage, live.longBudget),
            hugeBudget: Math.max(perPage, live.hugeBudget),
          }, { distinctive: marks, titleTerms })
          const title = page.title || searchTitles.get(page.url) || hostOf(page.url) || page.url

          // 跨页去重：三个站说同一件事时只留第一份（省 10–20% 预算，不损失信息）
          const kept = []
          for (const item of picked) {
            const key = item.text.toLowerCase().replace(/[\s，。！？、；：""''（）()\-—…·,.!?;:]/g, '').slice(0, 60)
            if (key.length > 20 && seenSentences.has(key)) { crossDup++; continue }
            if (key.length > 20) seenSentences.add(key)
            kept.push(item)
          }

          // 相邻句合并成段落：一行一句读起来是碎的，连着的句子本来就是一段。
          const groups = []
          for (const item of kept) {
            const last = groups[groups.length - 1]
            if (last && item.index === last.end + 1) {
              last.texts.push(item.text)
              last.end = item.index
            } else groups.push({ texts: [item.text], end: item.index })
          }
          const lines = groups.map((g) => '   · ' + g.texts.join(' ').replace(/\s+/g, ' ').slice(0, 420))
          picked.length = kept.length

          const snippet = searchSnippets.get(page.url)
          if (!lines.length && snippet) {
            lines.push('   · 搜索摘要：' + String(snippet).replace(/\s+/g, ' ').slice(0, 240))
          }
          const body = lines.join('\n')
          outChars += body.length + title.length + 90
          blocks.push(
            `${index + 1}. ${String(title).slice(0, 110)} — ${hostOf(page.url)} · ${page.tier}` +
              ` · 命中 ${hits} 词 · ${(page.ms / 1000).toFixed(1)}s · ${total} 句取 ${picked.length} 句\n` +
              `   ${page.url}\n${body}`,
          )
        })

        const ok = relevant.length
        const pct = rawTotal > 0 ? Math.round((1 - outChars / rawTotal) * 100) : 0
        const ratio = pct > 5
          ? `正文 ${rawTotal} 字符 → 摘要 ${outChars} 字符（压缩 ${pct}%）` +
            ` · 约 ${Math.round(rawTotal / 2.5)} → ${Math.round(outChars / 2.5)} tokens`
          : `正文本来就短（${rawTotal} 字符），直接给要点`
        const qHead = !query
          ? '给定链接'
          : (profile.stripped && profile.cleaned && profile.cleaned !== query
            ? `原查询：${query}\n清洗：${profile.cleaned}`
            : `查询：${profile.cleaned || query}`)
        const header = [
          `[web_digest] ${qHead}`,
          strict ? '模式：strict' : '',
          `命中 ${ok}/${pages.length} · 跳过 ${skipped.length}` + (crossDup ? ` · 跨页重复 ${crossDup}` : ''),
          ratio,
          skipped.length ? `弃用：${skipped.map((s) => hostOf(s.page.url)).join(' / ')}（查询词不足）` : '',
          searchNote ? `备注：${searchNote}` : '',
          !args.urls && profile.aliases.length ? `别名未另搜：${profile.aliases.join(' / ')}（多路召回用 web_find）` : '',
        ].filter(Boolean).join('\n')

        return {
          text: `${header}\n\n采用：\n\n${blocks.join('\n\n')}\n\n（够用即停。要某一篇全文：web_digest({ urls: "那条链接" })，不要再用 query 连搜。）` + modeTail(exec),
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'web_find',
      description:
        '用**真浏览器**搜一次，只返回链接清单（标题 + 真实 URL）。\n\n' +
        '和 web_search 的区别：web_search 是抓搜索引擎的 HTML 再用正则解析，' +
        '拿到的一堆是跳转壳（360 的 so.com/link?m=…、Bing 的 ck/a?u=…），点开还是重定向；' +
        '这里页面真的在浏览器里跑过，DOM 里的 href 是引擎自己解出来的**真实地址**。\n\n' +
        '返回前会做三件事，都不调模型：\n' +
        '1) 去掉「帮我搜一下 / 是什么」这类指令壳，别名（逗号、又名、括号）自动拆开再各搜一轮；\n' +
        '2) 按标题与查询词的字面重合重排，低质标题（首页、仅域名、符号堆砌）弃用；\n' +
        '3) 固定抬头：采用 / 弃用 / 建议深挖。标 ★ 的前 3 条交给 web_digest({ urls })，不要连搜。\n\n' +
        '代价：一次 3–6 秒，每多一个别名再加一轮。没手写 aliases 时，自动别名最多再搜 2 个。' +
        '只要摘要用 web_digest。\n\n' +
        'engine 默认 auto：先 Bing → 采用少于 3 条再换 Google → 再换百度。',
      parameters: {
        query: { type: 'string', required: true, description: '搜索词。人话会先洗成核心词；本身就是关键词时原样搜' },
        engine: { type: 'string', description: 'auto | bing | google | baidu | 360，默认 auto' },
        limit: { type: 'number', description: '最多返回几条，默认 8（3–15）' },
        proxy: { type: 'string', description: 'auto | always | never，覆盖全局代理模式' },
        aliases: {
          type: 'string',
          description:
            '别名，逗号分隔（最多 4 个），与自动拆出的别名合并。找人时强烈建议给：' +
            '中文昵称在境外站点几乎都不是 handle。例：「狩野樱、樱佬、kano sakura、saye.」。',
        },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [{ type: 'text', text: value.text }],
      },
      execute: async (args, exec) => {
        const live = resolveSettings(config)
        if (currentUsage(exec) === 'off') return { text: OFF_TEXT }
        const query = String(args.query || '').trim()
        if (!query) return { text: '需要 query。' }
        const found = await runFind(live, {
          query,
          aliases: args.aliases,
          engine: args.engine,
          limit: args.limit,
          proxy: args.proxy || live.proxyMode,
        })
        return { text: found.text + (found.ok ? modeTail(exec) : '') }
      },
    }),
  )
}

/** 仅供离线基准测试使用（不对外承诺 API 稳定性）。 */
export const __bench = { stripHtml, pickSentences, splitSentences, queryTerms, countHits, extractSmart, EXTRACT_POLICY, parseSites, hostInSites, probeRoute, resolveSettings, normalizeQuery, rankSearchResults }
