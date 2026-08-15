import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { mkdir, open, readdir, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'

export const NODE_RUNTIME_VERSION = 'v24.19.0'

export interface NodeRuntime {
  root: string
  node: string
  npm: string
  npx: string
  managed: boolean
}

export interface NodeRuntimeProgress {
  percent: number
  message: string
}

type ProgressListener = (progress: NodeRuntimeProgress) => void

let installationPromise: Promise<NodeRuntime> | null = null

/**
 * 可执行文件相对于 root 的两种摆放方式。
 *
 * - `bin-directory`：root 本身就是存放可执行文件的目录，例如 PATH 里的 `/usr/bin`。
 * - `distribution-root`：root 是官方发行包解压后的根目录，例如 `node-v24.19.0-linux-x64/`。
 *
 * Windows 上两者一致（zip 与 PATH 目录都是三个文件平铺）；
 * POSIX 上发行包把可执行文件放在 `bin/` 子目录里，差一层。
 */
type RuntimeLayout = 'bin-directory' | 'distribution-root'

function runtimePaths(root: string, managed: boolean, layout: RuntimeLayout): NodeRuntime {
  if (process.platform === 'win32') {
    return {
      root,
      node: path.join(root, 'node.exe'),
      npm: path.join(root, 'npm.cmd'),
      npx: path.join(root, 'npx.cmd'),
      managed,
    }
  }
  const binary = layout === 'distribution-root' ? path.join(root, 'bin') : root
  return {
    root,
    node: path.join(binary, 'node'),
    npm: path.join(binary, 'npm'),
    npx: path.join(binary, 'npx'),
    managed,
  }
}

function isCompleteRuntime(runtime: NodeRuntime): boolean {
  return existsSync(runtime.node) && existsSync(runtime.npm) && existsSync(runtime.npx)
}

export function findSystemNodeRuntime(environment: NodeJS.ProcessEnv = process.env): NodeRuntime | null {
  const entries = (environment.PATH ?? environment.Path ?? environment.path ?? '')
    .split(path.delimiter)
    .filter(Boolean)
  if (process.platform === 'win32') {
    entries.unshift(path.join(environment.ProgramFiles ?? 'C:\\Program Files', 'nodejs'))
  }
  for (const entry of entries) {
    // PATH 里的每一项本身就是可执行文件所在的目录。
    const runtime = runtimePaths(entry.replace(/^"|"$/g, ''), false, 'bin-directory')
    if (isCompleteRuntime(runtime)) return runtime
  }
  return null
}

export function nodeArchiveName(architecture = process.arch): string {
  const archiveArchitecture = architecture === 'arm64' ? 'arm64' : 'x64'
  return `node-${NODE_RUNTIME_VERSION}-win-${archiveArchitecture}.zip`
}

export function parseNodeArchiveChecksum(checksums: string, archiveName: string): string | null {
  for (const line of checksums.split(/\r?\n/)) {
    const match = line.trim().match(/^([a-f0-9]{64})\s+\*?(.+)$/i)
    if (match?.[2] === archiveName) return match[1].toLowerCase()
  }
  return null
}

export async function findManagedNodeRuntime(runtimeRoot: string): Promise<NodeRuntime | null> {
  if (!existsSync(runtimeRoot)) return null
  const entries = await readdir(runtimeRoot, { withFileTypes: true })
  const directories = entries
    .filter(entry => entry.isDirectory() && entry.name.startsWith('node-v'))
    .map(entry => entry.name)
    .sort((a, b) => b.localeCompare(a, 'en'))
  for (const directory of directories) {
    const runtime = runtimePaths(path.join(runtimeRoot, directory), true, 'distribution-root')
    if (isCompleteRuntime(runtime)) return runtime
  }
  return null
}

async function sha256(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) hash.update(chunk)
  return hash.digest('hex')
}

async function downloadFile(url: string, target: string, onProgress: (ratio: number) => void): Promise<void> {
  const existingSize = existsSync(target) ? (await stat(target)).size : 0
  const response = await fetch(url, {
    redirect: 'follow',
    headers: existingSize > 0 ? { Range: `bytes=${existingSize}-` } : undefined,
  })
  if (response.status === 416 && existingSize > 0) {
    onProgress(1)
    return
  }
  if (!response.ok || !response.body) throw new Error(`下载 Node.js 运行环境失败（HTTP ${response.status}）。`)
  const resumed = response.status === 206 && existingSize > 0
  const contentLength = Number(response.headers.get('content-length'))
  const contentRange = response.headers.get('content-range')
  const rangeTotal = contentRange ? Number(contentRange.split('/').at(-1)) : Number.NaN
  const total = Number.isFinite(rangeTotal) ? rangeTotal : (resumed ? existingSize : 0) + contentLength
  const file = await open(target, resumed ? 'a' : 'w')
  let received = resumed ? existingSize : 0
  try {
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      await file.write(chunk)
      received += chunk.byteLength
      onProgress(Number.isFinite(total) && total > 0 ? Math.min(received / total, 1) : 0)
    }
  } finally {
    await file.close()
  }
}

async function waitForExit(child: ReturnType<typeof spawn>): Promise<number> {
  return new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', code => resolve(code ?? 1))
  })
}

async function installManagedNodeRuntime(runtimeRoot: string, onProgress?: ProgressListener): Promise<NodeRuntime> {
  if (process.platform !== 'win32') {
    throw new Error('未检测到 Node.js。自动准备运行环境目前仅支持 Windows。')
  }

  const archiveName = nodeArchiveName()
  const extractedName = archiveName.slice(0, -4)
  const finalRoot = path.join(runtimeRoot, extractedName)
  const existing = runtimePaths(finalRoot, true, 'distribution-root')
  if (isCompleteRuntime(existing)) return existing

  const nonce = `${process.pid}-${Date.now()}`
  const archivePath = path.join(runtimeRoot, archiveName)
  const stagingRoot = path.join(runtimeRoot, `.node-runtime-${nonce}`)
  const baseUrl = `https://nodejs.org/dist/${NODE_RUNTIME_VERSION}`
  await mkdir(runtimeRoot, { recursive: true })
  await mkdir(stagingRoot, { recursive: true })

  try {
    onProgress?.({ percent: 3, message: '正在读取 Node.js 官方校验信息' })
    const checksumResponse = await fetch(`${baseUrl}/SHASUMS256.txt`, { redirect: 'follow' })
    if (!checksumResponse.ok) throw new Error(`读取 Node.js 校验信息失败（HTTP ${checksumResponse.status}）。`)
    const expectedChecksum = parseNodeArchiveChecksum(await checksumResponse.text(), archiveName)
    if (!expectedChecksum) throw new Error('Node.js 官方校验信息中没有找到当前 Windows 安装包。')

    let actualChecksum = existsSync(archivePath) ? await sha256(archivePath) : ''
    if (actualChecksum !== expectedChecksum) {
      onProgress?.({ percent: 8, message: '正在下载 Node.js 便携运行环境' })
      let lastProgress = -1
      const reportDownload = (ratio: number) => {
        const percent = 8 + Math.round(ratio * 67)
        if (percent !== lastProgress) {
          lastProgress = percent
          onProgress?.({ percent, message: `正在下载 Node.js ${NODE_RUNTIME_VERSION}` })
        }
      }
      await downloadFile(`${baseUrl}/${archiveName}`, archivePath, reportDownload)
      onProgress?.({ percent: 78, message: '正在校验 Node.js 安装包' })
      actualChecksum = await sha256(archivePath)
      if (actualChecksum !== expectedChecksum) {
        await rm(archivePath, { force: true })
        await downloadFile(`${baseUrl}/${archiveName}`, archivePath, reportDownload)
        actualChecksum = await sha256(archivePath)
      }
    }
    if (actualChecksum !== expectedChecksum) {
      await rm(archivePath, { force: true })
      throw new Error('Node.js 安装包校验失败，请重试。')
    }

    onProgress?.({ percent: 84, message: '正在解压 Node.js 运行环境' })
    const extractor = spawn('tar.exe', ['-xf', archivePath, '-C', stagingRoot], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let extractionError = ''
    extractor.stderr.on('data', chunk => { extractionError += chunk.toString('utf8') })
    const exitCode = await waitForExit(extractor)
    if (exitCode !== 0) throw new Error(`解压 Node.js 运行环境失败：${extractionError.trim() || `代码 ${exitCode}`}`)

    const stagedRoot = path.join(stagingRoot, extractedName)
    const stagedRuntime = runtimePaths(stagedRoot, true, 'distribution-root')
    if (!isCompleteRuntime(stagedRuntime)) throw new Error('Node.js 运行环境解压后文件不完整。')
    await rm(finalRoot, { recursive: true, force: true })
    await rename(stagedRoot, finalRoot)
    const installed = runtimePaths(finalRoot, true, 'distribution-root')
    await rm(archivePath, { force: true })
    onProgress?.({ percent: 100, message: `Node.js ${NODE_RUNTIME_VERSION} 已就绪` })
    return installed
  } finally {
    await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined)
  }
}

export async function ensureNodeRuntime(runtimeRoot: string, onProgress?: ProgressListener): Promise<NodeRuntime> {
  const systemRuntime = findSystemNodeRuntime()
  if (systemRuntime) return systemRuntime
  const managedRuntime = await findManagedNodeRuntime(runtimeRoot)
  if (managedRuntime) return managedRuntime
  if (!installationPromise) {
    installationPromise = installManagedNodeRuntime(runtimeRoot, onProgress).finally(() => {
      installationPromise = null
    })
  }
  return installationPromise
}

export function resolveNodeExecutable(executable: string, runtime: NodeRuntime): string {
  const name = path.basename(executable).toLowerCase()
  if (name === 'node' || name === 'node.exe') return runtime.node
  if (name === 'npm' || name === 'npm.cmd') return runtime.npm
  if (name === 'npx' || name === 'npx.cmd') return runtime.npx
  return executable
}

export function requiresNodeRuntime(executable: string, args: string[]): boolean {
  const name = path.basename(executable).toLowerCase()
  return ['node', 'node.exe', 'npm', 'npm.cmd', 'npx', 'npx.cmd', 'dsh', 'dsh.cmd'].includes(name)
    || args.includes('@deepseek-ai/dsh')
    || executable.toLowerCase().includes('dsh-runtime')
}
