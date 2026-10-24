import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './_setup.mjs'

/**
 * 白框回归锁。
 *
 * 用户反复报的「浏览器卡白框」实测根因：内核的 spawn 选项里带了 `windowsHide: true`。
 * 它本意只是别弹控制台窗口，但在 Windows 上会通过 STARTUPINFO 传 SW_HIDE，
 * 把程序自己第一次 ShowWindow 覆盖掉 —— 浏览器窗口从头到尾都是隐藏的：
 *   · 「可视模式」形同虚设（用户看不到窗口，扫码登录也没法做）
 *   · 隐藏的 Chromium 窗口仍会在桌面上留下一整块纯白矩形，尺寸正好等于 --window-size
 *     （实测：启动前该区域是桌面蓝 RGB(0,165,247)，启动后四个采样点全变 RGB(255,255,255)，
 *      对窗口发一次 SW_MINIMIZE 立刻恢复桌面色）
 *
 * 这条锁检查源码里不再出现这个选项。真机行为校验（真的起内核再看窗口可见性）
 * 用 DSH_WEBSIFT_LIVE=1 打开，见本文件末尾。
 */
const SRC = readFileSync(join(ROOT, 'lib', 'index.js'), 'utf8')

let bad = 0
const check = (name, pass, extra = '') => {
  console.log(`${pass ? '✅' : '❌'} ${name}${extra ? '  ' + extra : ''}`)
  if (!pass) bad++
}

// 只看真正的选项写法，注释里提到它是允许的（注释正是解释为什么不能用）
const liveOption = SRC.split('\n')
  .map((line, i) => [i + 1, line])
  .filter(([, line]) => /^\s*windowsHide\s*:/.test(line))

check('spawn 选项里没有 windowsHide', liveOption.length === 0,
  liveOption.length ? `出现在第 ${liveOption.map(([n]) => n).join(', ')} 行` : '')

check('headless 只在 visible=false 时加',
  SRC.includes("...(settings.visible ? [] : ['--headless=new'])"))
check('可视模式仍带 --window-size（白框尺寸就是它）',
  SRC.includes("'--window-size=1440,900'"))
check('可视模式确实会申请真实窗口（没有别的隐藏手段）',
  !/^\s*(windowsHide|hide)\s*:\s*true/m.test(SRC))

if (bad === 0 && process.env.DSH_WEBSIFT_LIVE === '1' && process.platform === 'win32') {
  console.log('\n--- 真机行为校验（起了内核再看窗口可见性）---')
  const { loadPlugin } = await import('./_setup.mjs')
  const { execFileSync } = await import('node:child_process')
  const { mod } = await loadPlugin()
  const tools = []
  mod.apply({
    tools: { register: (t) => { tools.push(t); return () => {} } },
    get: () => undefined,
    effect: (fn) => { fn() },
  }, {})
  const browser = tools.find((t) => t.name === 'browser')
  const proxyTool = tools.find((t) => t.name === 'browser_proxy')
  try {
    await browser.execute({ url: 'https://example.com/', action: 'text', max_chars: 100 }, {})
    // 用 PowerShell 查这个内核有没有**可见**的 1440x900 窗口
    const ps = [
      "Add-Type -Namespace W -Name U -MemberDefinition '[DllImport(\"user32.dll\")] public static extern bool EnumWindows(EnumProc cb, IntPtr p);",
      "[DllImport(\"user32.dll\")] public static extern bool IsWindowVisible(IntPtr h);",
      "[DllImport(\"user32.dll\")] public static extern bool GetWindowRect(IntPtr h, out RECT r);",
      "public delegate bool EnumProc(IntPtr h, IntPtr p); public struct RECT { public int L,T,R,B; }';",
      "$n=0; $cb=[W.U+EnumProc]{ param($h,$p) $r=New-Object W.U+RECT; [void][W.U]::GetWindowRect($h,[ref]$r);",
      "if (($r.R-$r.L) -eq 1440 -and ($r.B-$r.T) -eq 900 -and [W.U]::IsWindowVisible($h)) { $script:n++ }; return $true };",
      '[void][W.U]::EnumWindows($cb,[IntPtr]::Zero); $n',
    ].join(' ')
    const visible = Number(String(execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { encoding: 'utf8' })).trim())
    check('内核窗口真的可见（可视模式生效）', visible > 0, `可见的 1440x900 窗口数 = ${visible}`)
  } finally {
    await proxyTool.execute({ action: 'stop' }, {})
  }
}

console.log(bad === 0 ? '\n全部通过' : `\n${bad} 项未通过`)
process.exit(bad === 0 ? 0 : 1)