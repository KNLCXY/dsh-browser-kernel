// 测试共用：把插件源码里的 '@deepseek-ai/dsh-tools' 指到 DSH 里的真实实现，
// 找不到就退化成桩（纯逻辑测试仍能跑）。这样测试不依赖任何硬编码绝对路径。
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
export const ROOT = resolve(HERE, '..')
export const PLUGIN_INDEX = join(ROOT, 'lib', 'index.js')

const STUB = "from 'data:text/javascript,export const defineTool = (d) => d'"

/** 找 DSH 自带的 dsh-tools：DSH_TOOLS 环境变量优先，其次几个常见安装位置。 */
export function resolveTools () {
  const env = process.env.DSH_TOOLS
  if (env && existsSync(env)) return env
  const guesses = [
    // Windows 桌面版
    join(process.env.LOCALAPPDATA || '', 'Programs', 'DeepSeek Harness', 'resources', 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-tools', 'lib', 'index.js'),
    'C:/Users/Administrator/Desktop/DeepSeek Harness/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js',
    // macOS / Linux 常见位置（装过桌面版或全局 CLI 时）
    '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js',
    '/usr/lib/node_modules/@deepseek-ai/dsh-tools/lib/index.js',
    join(ROOT, 'node_modules', '@deepseek-ai', 'dsh-tools', 'lib', 'index.js'),
  ]
  return guesses.find((p) => p && existsSync(p)) || null
}

/** 载入插件模块（先复制到临时目录并改写 import，避免模块缓存与真实安装冲突）。 */
export async function loadPlugin () {
  const toolsPath = resolveTools()
  // 整个 lib/ 一起复制：index.js 里还有 `./rank.js` 这样的相对依赖
  const dir = mkdtempSync(join(tmpdir(), 'bk-test-'))
  const libDir = join(ROOT, 'lib')
  for (const f of readdirSync(libDir)) {
    if (!f.endsWith('.js')) continue
    const code = readFileSync(join(libDir, f), 'utf8').replace(
      /from '@deepseek-ai\/dsh-tools'/,
      toolsPath ? `from ${JSON.stringify(pathToFileURL(toolsPath).href)}` : STUB,
    )
    writeFileSync(join(dir, f), code, 'utf8')
  }
  const mod = await import(pathToFileURL(join(dir, 'index.js')).href + '?t=' + Date.now())
  return { mod, toolsPath, tmpDir: dir }
}

/** 假 ctx：收集注册的工具与路由。 */
export function fakeCtx () {
  const tools = []
  const routes = []
  const ctx = {
    get: (k) => (k === 'webServer' ? { register: (r) => { routes.push(r); return () => {} } } : undefined),
    tools: { register: (t) => tools.push(t) },
    effect: (fn) => { const d = fn(); return typeof d === 'function' ? d : () => {} },
  }
  return { ctx, tools, routes }
}
