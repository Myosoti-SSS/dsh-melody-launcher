import type {
  ApplicationInstallTarget,
  ApplicationLaunchMode,
  ApplicationRepositoryAnalysis,
} from '../src/types'
import { isSafePackageName, isSafeRepositoryName } from './profile'

export const DSH_DESKTOP_REPOSITORY = 'anywhere-labs/deepseek-harness-desktop'
export const DSH_DESKTOP_PACKAGE = 'dsh-plugin-desktop'
export const APPLICATION_MANIFEST_PATH = '.dsh-launcher/addon.json'

const GITHUB_HEADERS = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'DSH-Launcher',
  'X-GitHub-Api-Version': '2022-11-28',
}

const LAUNCH_MODES = new Set<ApplicationLaunchMode>([
  'runtime-replacement',
  'after-runtime',
  'standalone',
])
const PLATFORMS = new Set(['win32', 'darwin', 'linux'] as const)

interface RawApplicationManifest {
  schemaVersion?: unknown
  id?: unknown
  name?: unknown
  description?: unknown
  type?: unknown
  launchMode?: unknown
  install?: {
    provider?: unknown
    package?: unknown
    version?: unknown
  }
  launch?: {
    bin?: unknown
    args?: unknown
  }
  platforms?: unknown
  provides?: unknown
}

function safeBranch(value: string): boolean {
  return value.length > 0
    && value.length <= 160
    && !value.includes('..')
    && /^[A-Za-z0-9._/-]+$/.test(value)
}

function safeAddonId(value: string): boolean {
  return /^[a-z0-9](?:[a-z0-9._-]{0,78}[a-z0-9])?$/.test(value)
}

function githubApiPath(repository: string, suffix: string): string {
  const [owner, name] = repository.split('/')
  return `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/${suffix}`
}

function rawFileUrl(repository: string, revision: string, filePath: string): string {
  const encodedRepository = repository.split('/').map(encodeURIComponent).join('/')
  const encodedPath = filePath.split('/').map(encodeURIComponent).join('/')
  return `https://raw.githubusercontent.com/${encodedRepository}/${encodeURIComponent(revision)}/${encodedPath}`
}

async function fetchCommit(repository: string, branch: string, fetchImpl: typeof fetch): Promise<string> {
  const response = await fetchImpl(githubApiPath(repository, `commits/${encodeURIComponent(branch)}`), {
    headers: GITHUB_HEADERS,
  })
  if (response.status === 403) throw new Error('GitHub 请求额度暂时用尽，请稍后重试。')
  if (!response.ok) throw new Error(`读取应用加载项仓库失败（HTTP ${response.status}）。`)
  const result = await response.json() as { sha?: unknown }
  if (typeof result.sha !== 'string' || !/^[a-f0-9]{40}$/i.test(result.sha)) {
    throw new Error('GitHub 没有返回有效的提交版本。')
  }
  return result.sha
}

async function fetchManifest(
  repository: string,
  revision: string,
  fetchImpl: typeof fetch,
): Promise<RawApplicationManifest | null> {
  const response = await fetchImpl(rawFileUrl(repository, revision, APPLICATION_MANIFEST_PATH), {
    headers: { 'User-Agent': 'DSH-Launcher' },
  })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`读取应用加载项清单失败（HTTP ${response.status}）。`)
  try {
    return await response.json() as RawApplicationManifest
  } catch {
    throw new Error(`应用加载项清单 ${APPLICATION_MANIFEST_PATH} 不是有效 JSON。`)
  }
}

function stringList(value: unknown, field: string, maximum = 32): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > maximum || value.some(item => typeof item !== 'string')) {
    throw new Error(`应用加载项清单中的 ${field} 格式无效。`)
  }
  return value.map(item => item.trim()).filter(Boolean)
}

export function applicationTargetFromManifest(
  repository: string,
  manifest: RawApplicationManifest,
  platform: NodeJS.Platform = process.platform,
): ApplicationInstallTarget {
  if (manifest.schemaVersion !== 1 || manifest.type !== 'application') {
    throw new Error('应用加载项清单版本或类型不受支持。')
  }
  const addonId = typeof manifest.id === 'string' ? manifest.id.trim().toLowerCase() : ''
  const name = typeof manifest.name === 'string' ? manifest.name.trim() : ''
  const description = typeof manifest.description === 'string' ? manifest.description.trim() : ''
  const packageName = typeof manifest.install?.package === 'string' ? manifest.install.package.trim() : ''
  const version = typeof manifest.install?.version === 'string' && manifest.install.version.trim()
    ? manifest.install.version.trim()
    : null
  const binName = typeof manifest.launch?.bin === 'string' ? manifest.launch.bin.trim() : ''
  const launchMode = manifest.launchMode
  if (!safeAddonId(addonId)) throw new Error('应用加载项清单中的 id 无效。')
  if (!name || name.length > 120) throw new Error('应用加载项清单中的 name 无效。')
  if (manifest.install?.provider !== 'npm') throw new Error('当前只支持 npm 应用加载项。')
  if (!isSafePackageName(packageName)) throw new Error('应用加载项清单中的 npm 包名无效。')
  if (!binName || binName.length > 120 || /[\\/]/.test(binName)) throw new Error('应用加载项清单中的启动入口无效。')
  if (typeof launchMode !== 'string' || !LAUNCH_MODES.has(launchMode as ApplicationLaunchMode)) {
    throw new Error('应用加载项清单中的 launchMode 无效。')
  }
  const rawPlatforms = manifest.platforms === undefined
    ? ['win32', 'darwin', 'linux']
    : stringList(manifest.platforms, 'platforms', 3)
  if (rawPlatforms.length === 0 || rawPlatforms.some(item => !PLATFORMS.has(item as 'win32' | 'darwin' | 'linux'))) {
    throw new Error('应用加载项清单中的 platforms 无效。')
  }
  const platforms = rawPlatforms as Array<'win32' | 'darwin' | 'linux'>
  return {
    id: `${addonId}:.`,
    addonId,
    name,
    description: description || `${name} 应用加载项`,
    provider: 'npm',
    packageName,
    version,
    binName,
    launchMode: launchMode as ApplicationLaunchMode,
    launchArgs: stringList(manifest.launch?.args, 'launch.args'),
    platforms,
    supported: platforms.includes(platform as 'win32' | 'darwin' | 'linux'),
    verified: true,
    provides: stringList(manifest.provides, 'provides'),
  }
}

export function isDshDesktopRepository(repository: string): boolean {
  return repository.toLowerCase() === DSH_DESKTOP_REPOSITORY
}

export function dshDesktopTarget(platform: NodeJS.Platform = process.platform): ApplicationInstallTarget {
  const platforms: Array<'win32' | 'darwin' | 'linux'> = ['win32', 'darwin', 'linux']
  return {
    id: 'dsh-desktop:.',
    addonId: 'dsh-desktop',
    name: 'DSH Desktop',
    description: '为 DeepSeek Harness 提供原生窗口、托盘、终端与桌面运行时服务。',
    provider: 'npm',
    packageName: DSH_DESKTOP_PACKAGE,
    version: null,
    binName: DSH_DESKTOP_PACKAGE,
    launchMode: 'runtime-replacement',
    launchArgs: [],
    platforms,
    supported: platforms.includes(platform as 'win32' | 'darwin' | 'linux'),
    verified: true,
    provides: ['desktopRuntime', 'desktopProfiles', 'desktopPnpmBootstrap'],
  }
}

export async function analyzeApplicationRepository(
  repository: string,
  defaultBranch: string,
  fetchImpl: typeof fetch = fetch,
  platform: NodeJS.Platform = process.platform,
): Promise<ApplicationRepositoryAnalysis> {
  if (!isSafeRepositoryName(repository) || !safeBranch(defaultBranch)) {
    throw new Error('仓库名称或默认分支无效。')
  }

  if (isDshDesktopRepository(repository)) {
    const target = dshDesktopTarget(platform)
    return {
      repository,
      defaultBranch,
      installability: target.supported ? 'ready' : 'unsupported',
      summary: target.supported
        ? '检测到 DSH Desktop 独立宿主，将作为应用加载项安装，不会写入 Web Profile。'
        : '检测到 DSH Desktop，但当前操作系统不在其支持列表中。',
      targets: [target],
    }
  }

  const commit = await fetchCommit(repository, defaultBranch, fetchImpl)
  const manifest = await fetchManifest(repository, commit, fetchImpl)
  if (!manifest) {
    return {
      repository,
      defaultBranch,
      installability: 'invalid',
      summary: `没有找到 ${APPLICATION_MANIFEST_PATH} 应用加载项清单。`,
      targets: [],
    }
  }

  const target = applicationTargetFromManifest(repository, manifest, platform)
  return {
    repository,
    defaultBranch,
    installability: target.supported ? 'ready' : 'unsupported',
    summary: target.supported
      ? `检测到可安装的应用加载项 ${target.name}（${target.launchMode}）。`
      : `${target.name} 不支持当前操作系统。`,
    targets: [target],
  }
}
