import path from 'node:path'
import type {
  PluginInstallSource,
  PluginInstallTarget,
  RepositoryAnalysis,
} from '../src/types'
import { isSafePackageName, isSafeRepositoryName, repositoryFullNameFromSpecifier } from './profile'

interface PackageManifest {
  name?: string
  version?: string
  private?: boolean
  workspaces?: unknown
  repository?: string | { url?: string }
  homepage?: string
  scripts?: Record<string, string>
  engines?: { node?: string }
  dsh?: {
    type?: string
    bundle?: { patch?: string }
    client?: { platform?: string }
  }
}

interface GitHubTree {
  truncated?: boolean
  tree?: Array<{ path: string; type: 'blob' | 'tree' }>
}

const GITHUB_HEADERS = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'DSH-Launcher',
  'X-GitHub-Api-Version': '2022-11-28',
}

async function requestWithRetry(url: string, init: RequestInit, fetchImpl: typeof fetch): Promise<Response> {
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await fetchImpl(url, init)
    } catch (error) {
      lastError = error
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 300 * (attempt + 1)))
    }
  }
  throw new Error(`连接插件来源失败：${lastError instanceof Error ? lastError.message : String(lastError)}`)
}

function safeBranch(value: string): boolean {
  return value.length > 0
    && value.length <= 160
    && !value.includes('..')
    && /^[A-Za-z0-9._/-]+$/.test(value)
}

function githubApiPath(repository: string, suffix: string): string {
  const [owner, name] = repository.split('/')
  return `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/${suffix}`
}

function rawFileUrl(repository: string, commit: string, filePath: string): string {
  const repositoryPath = repository.split('/').map(encodeURIComponent).join('/')
  const encodedPath = filePath.split('/').map(encodeURIComponent).join('/')
  return `https://raw.githubusercontent.com/${repositoryPath}/${commit}/${encodedPath}`
}

async function fetchJson<T>(url: string, fetchImpl: typeof fetch): Promise<T> {
  const response = await requestWithRetry(url, { headers: GITHUB_HEADERS }, fetchImpl)
  if (!response.ok) {
    if (response.status === 403) throw new Error('GitHub 请求额度暂时用尽，请稍后重试。')
    throw new Error(`读取仓库失败（HTTP ${response.status}）。`)
  }
  return response.json() as Promise<T>
}

async function fetchOptionalManifest(url: string, fetchImpl: typeof fetch): Promise<PackageManifest | null> {
  const response = await requestWithRetry(url, { headers: { 'User-Agent': 'DSH-Launcher' } }, fetchImpl)
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`读取插件清单失败（HTTP ${response.status}）。`)
  try {
    return await response.json() as PackageManifest
  } catch {
    return null
  }
}

function manifestRepository(manifest: PackageManifest): string | undefined {
  const repository = typeof manifest.repository === 'string' ? manifest.repository : manifest.repository?.url
  return repositoryFullNameFromSpecifier(repository)
    ?? repositoryFullNameFromSpecifier(manifest.homepage)
}

async function publishedPackage(
  packageName: string,
  repository: string,
  fetchImpl: typeof fetch,
): Promise<PackageManifest | null> {
  let response: Response
  try {
    response = await requestWithRetry(`https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`, {
      headers: { Accept: 'application/json', 'User-Agent': 'DSH-Launcher' },
    }, fetchImpl)
  } catch {
    return null
  }
  if (response.status === 404) return null
  if (!response.ok) return null
  const manifest = await response.json() as PackageManifest
  if (!manifest.dsh?.bundle?.patch) return null
  const publishedRepository = manifestRepository(manifest)
  if (publishedRepository && publishedRepository.toLowerCase() !== repository.toLowerCase()) return null
  return manifest.name === packageName ? manifest : null
}

function candidatePatchPath(directory: string, patchFile: string): string | null {
  if (!patchFile || path.posix.isAbsolute(patchFile)) return null
  const normalized = path.posix.normalize(path.posix.join(directory, patchFile))
  if (normalized === '..' || normalized.startsWith('../')) return null
  return normalized.replace(/^\.\//, '')
}

function recommendedProfile(manifest: PackageManifest, currentProfile: string): {
  name: string
  platform: PluginInstallTarget['platform']
} {
  if (manifest.dsh?.client?.platform === 'web') return { name: 'web', platform: 'web' }
  const packageName = manifest.name?.toLowerCase() ?? ''
  if (packageName === 'dsh-cc-tui' || /(?:^|[-_/])tui(?:$|[-_/])/.test(packageName)) {
    return { name: 'cc-tui', platform: 'terminal' }
  }
  return { name: currentProfile, platform: 'unknown' }
}

function lifecycleScripts(manifest: PackageManifest, source: PluginInstallSource): string[] {
  const names = source === 'npm'
    ? ['preinstall', 'install', 'postinstall']
    : ['preinstall', 'install', 'postinstall', 'prepare']
  return names.filter(name => Boolean(manifest.scripts?.[name]))
}

function targetId(packageName: string, directory: string): string {
  return `${packageName}:${directory || '.'}`
}

function isTemplatePackageName(packageName: string): boolean {
  return /__[a-z0-9_-]+__/i.test(packageName)
}

function targetPreference(target: PluginInstallTarget): [number, number, number, string] {
  const sourceRank: Record<PluginInstallSource, number> = {
    npm: 0,
    github: 1,
    'archive-subdirectory': 2,
  }
  const directory = target.subdirectory ?? ''
  const depth = directory ? directory.split('/').length : 0
  return [sourceRank[target.source], depth, directory.length, target.id]
}

function preferTarget(left: PluginInstallTarget, right: PluginInstallTarget): PluginInstallTarget {
  const leftPreference = targetPreference(left)
  const rightPreference = targetPreference(right)
  for (let index = 0; index < leftPreference.length; index += 1) {
    const comparison = leftPreference[index] < rightPreference[index]
      ? -1
      : leftPreference[index] > rightPreference[index]
        ? 1
        : 0
    if (comparison !== 0) return comparison < 0 ? left : right
  }
  return left
}

function uniqueTargets(targets: PluginInstallTarget[]): PluginInstallTarget[] {
  const unique = new Map<string, PluginInstallTarget>()
  for (const target of targets) {
    const key = target.packageName.toLowerCase()
    const existing = unique.get(key)
    unique.set(key, existing ? preferTarget(existing, target) : target)
  }
  return [...unique.values()]
}

export async function analyzeRepository(
  repository: string,
  defaultBranch: string,
  currentProfile: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RepositoryAnalysis> {
  if (!isSafeRepositoryName(repository) || !safeBranch(defaultBranch)) throw new Error('仓库名称或默认分支无效。')

  const commitResult = await fetchJson<{ sha?: string }>(
    githubApiPath(repository, `commits/${encodeURIComponent(defaultBranch)}`),
    fetchImpl,
  )
  const commit = commitResult.sha
  if (!commit || !/^[a-f0-9]{40}$/i.test(commit)) throw new Error('GitHub 没有返回有效的提交版本。')

  const rootManifest = await fetchOptionalManifest(rawFileUrl(repository, commit, 'package.json'), fetchImpl)
  if (rootManifest?.dsh?.type === 'dynamic-plugin') {
    return {
      repository,
      defaultBranch,
      installability: 'dynamic',
      summary: '这是会话内动态插件，需要通过 DSH 的 cordis_define / cordis_run 加载，重启后不会保留。',
      targets: [],
    }
  }
  if (rootManifest?.name === '@deepseek-ai/dsh-root') {
    return {
      repository,
      defaultBranch,
      installability: 'application',
      summary: '这是 DeepSeek Harness 源码工作区，不是可以加入 Profile 的第三方插件。',
      targets: [],
    }
  }

  const tree = await fetchJson<GitHubTree>(githubApiPath(repository, `git/trees/${commit}?recursive=1`), fetchImpl)
  const entries = tree.tree ?? []
  const files = new Set(entries.filter(entry => entry.type === 'blob').map(entry => entry.path))
  const packagePaths = entries
    .filter(entry => entry.type === 'blob' && (entry.path === 'package.json' || entry.path.endsWith('/package.json')))
    .map(entry => entry.path)

  const patchDirectories = new Set(entries
    .filter(entry => entry.type === 'blob' && /(?:^|\/)(?:cordis\.patch\.ya?ml|[^/]+\.patch\.ya?ml)$/i.test(entry.path))
    .map(entry => path.posix.dirname(entry.path) === '.' ? '' : path.posix.dirname(entry.path)))

  const likelyPackages = packagePaths
    .filter(packagePath => {
      const directory = path.posix.dirname(packagePath) === '.' ? '' : path.posix.dirname(packagePath)
      return directory === '' || patchDirectories.has(directory)
    })
    .slice(0, 32)

  if (!likelyPackages.includes('package.json') && rootManifest) likelyPackages.unshift('package.json')

  const manifests = await Promise.all(likelyPackages.map(async packagePath => {
    if (packagePath === 'package.json' && rootManifest) return { packagePath, manifest: rootManifest }
    return {
      packagePath,
      manifest: await fetchOptionalManifest(rawFileUrl(repository, commit, packagePath), fetchImpl),
    }
  }))

  const targets: PluginInstallTarget[] = []
  for (const { packagePath, manifest } of manifests) {
    if (!manifest?.name || !isSafePackageName(manifest.name)) continue
    if (isTemplatePackageName(manifest.name)) continue
    const patchFile = manifest.dsh?.bundle?.patch
    if (!patchFile) continue
    const directory = path.posix.dirname(packagePath) === '.' ? '' : path.posix.dirname(packagePath)
    const patchPath = candidatePatchPath(directory, patchFile)
    if (!patchPath || !files.has(patchPath)) continue

    const published = manifest.private ? null : await publishedPackage(manifest.name, repository, fetchImpl)
    const source: PluginInstallSource = published
      ? 'npm'
      : directory
        ? 'archive-subdirectory'
        : 'github'
    const effectiveManifest = published ?? manifest
    const profile = recommendedProfile(effectiveManifest, currentProfile)
    const scripts = lifecycleScripts(manifest, source)
    targets.push({
      id: targetId(manifest.name, directory),
      packageName: manifest.name,
      version: effectiveManifest.version ?? manifest.version ?? null,
      source,
      profileName: profile.name,
      platform: profile.platform,
      subdirectory: directory || null,
      commit,
      requiresBuild: scripts.length > 0,
      buildScripts: scripts,
      nodeRange: effectiveManifest.engines?.node ?? manifest.engines?.node ?? null,
    })
  }

  const installTargets = uniqueTargets(targets)

  if (installTargets.length > 0) {
    return {
      repository,
      defaultBranch,
      installability: installTargets.length === 1 ? 'ready' : 'choice',
      summary: installTargets.length === 1
        ? `检测到可安装的 ${installTargets[0].packageName}。`
        : `检测到 ${installTargets.length} 个可安装组件，请选择需要的组件。`,
      targets: installTargets,
    }
  }

  const applicationLike = Boolean(rootManifest?.private || rootManifest?.workspaces || rootManifest?.name === '@deepseek-ai/dsh-root')
  return {
    repository,
    defaultBranch,
    installability: applicationLike ? 'application' : 'invalid',
    summary: applicationLike
      ? '这是完整应用或源码工作区，仓库根目录没有可安装的 DSH Bundle。'
      : tree.truncated
        ? '仓库文件过多且 GitHub 返回了截断目录，未能确认有效的 DSH Bundle。'
        : '没有找到同时包含 package.json、dsh.bundle.patch 和对应补丁文件的插件组件。',
    targets: [],
  }
}
