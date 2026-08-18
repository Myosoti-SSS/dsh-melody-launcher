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
  gitHead?: string
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
  tree?: Array<{ path: string; type: 'blob' | 'tree' | 'commit' }>
}

const GITHUB_HEADERS = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'DSH-Launcher',
  'X-GitHub-Api-Version': '2022-11-28',
}

const RELEASE_LOOKUP_LIMIT = 10

/**
 * 查找仓库官方 Release tgz。
 *
 * 源码型插件（如 dsh-super-injector）的 `lib/` 不在 GitHub 源码树里，
 * 直接 `dsh plugin add <源码目录>` 会装出缺少入口的坏包。Release tgz
 * 是官方构建产物，应优先于 github 源安装。
 */
async function resolveReleaseTarball(
  repository: string,
  fetchImpl: typeof fetch,
): Promise<{ tarballUrl: string; version: string } | null> {
  const repositoryPath = repository.split('/').map(encodeURIComponent).join('/')
  const response = await requestWithRetry(
    `https://api.github.com/repos/${repositoryPath}/releases?per_page=${RELEASE_LOOKUP_LIMIT}`,
    { headers: GITHUB_HEADERS },
    fetchImpl,
  )
  if (!response.ok) return null
  const releases: unknown = await response.json().catch(() => null)
  if (!Array.isArray(releases)) return null
  for (const release of releases) {
    if (!release || typeof release !== 'object') continue
    const record = release as { draft?: unknown; prerelease?: unknown; tag_name?: unknown; assets?: unknown }
    if (record.draft === true || record.prerelease === true) continue
    if (!Array.isArray(record.assets)) continue
    const tgz = record.assets.find((asset): asset is { browser_download_url: string } => {
      if (!asset || typeof asset !== 'object') return false
      const url = (asset as { browser_download_url?: unknown }).browser_download_url
      return typeof url === 'string' && /\.(tgz|tar\.gz)$/i.test(url)
    })
    if (!tgz) continue
    const version = typeof record.tag_name === 'string' ? record.tag_name.replace(/^v/i, '') : ''
    if (!version) continue
    return { tarballUrl: tgz.browser_download_url, version }
  }
  return null
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

/** Verify a published root Bundle without relying on the GitHub API quota. */
async function analyzePublishedRootPlugin(
  repository: string,
  defaultBranch: string,
  currentProfile: string,
  fetchImpl: typeof fetch,
): Promise<RepositoryAnalysis | null> {
  const rootManifest = await fetchOptionalManifest(rawFileUrl(repository, defaultBranch, 'package.json'), fetchImpl)
  if (!rootManifest?.name || !isSafePackageName(rootManifest.name) || !rootManifest.dsh?.bundle?.patch) return null
  if (rootManifest.dsh.type === 'dynamic-plugin') {
    return {
      repository,
      defaultBranch,
      installability: 'dynamic',
      summary: 'This is a session-only dynamic plugin.',
      targets: [],
    }
  }
  if (rootManifest.name === '@deepseek-ai/dsh-root') {
    return {
      repository,
      defaultBranch,
      installability: 'application',
      summary: 'This is the DeepSeek Harness source workspace.',
      targets: [],
    }
  }

  const published = await publishedPackage(rootManifest.name, repository, fetchImpl)
  if (!published) return null
  const profile = recommendedProfile(published, currentProfile)
  const commit = published.gitHead && /^[a-f0-9]{40}$/i.test(published.gitHead)
    ? published.gitHead
    : defaultBranch
  const buildScripts = lifecycleScripts(rootManifest, 'npm')
  return {
    repository,
    defaultBranch,
    installability: 'ready',
    summary: `Detected installable ${published.name ?? rootManifest.name}.`,
    targets: [{
      id: targetId(rootManifest.name, ''),
      packageName: rootManifest.name,
      version: published.version ?? rootManifest.version ?? null,
      source: 'npm',
      profileName: profile.name,
      platform: profile.platform,
      subdirectory: null,
      commit,
      requiresBuild: buildScripts.length > 0,
      buildScripts,
      nodeRange: published.engines?.node ?? rootManifest.engines?.node ?? null,
    }],
  }
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
    release: 1,
    github: 2,
    'archive-subdirectory': 3,
    'local-directory': 4,
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
  let commit: string
  try {
    const commitResult = await fetchJson<{ sha?: string }>(
      githubApiPath(repository, `commits/${encodeURIComponent(defaultBranch)}`),
      fetchImpl,
    )
    commit = commitResult.sha ?? ''
    if (!/^[a-f0-9]{40}$/i.test(commit)) throw new Error('GitHub 没有返回有效的提交版本。')
  } catch (error) {
    const fallback = await analyzePublishedRootPlugin(repository, defaultBranch, currentProfile, fetchImpl).catch(() => null)
    if (fallback) return fallback
    throw error
  }

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

  // 源码型 github 插件优先使用官方 Release tgz，避免装出缺少 lib/ 的坏包。
  let resolvedTargets = installTargets
  if (installTargets.some(target => target.source === 'github')) {
    const release = await resolveReleaseTarball(repository, fetchImpl).catch(() => null)
    if (release) {
      resolvedTargets = installTargets.map(target => target.source === 'github'
        ? {
            ...target,
            source: 'release' as const,
            tarballUrl: release.tarballUrl,
            version: release.version,
          }
        : target)
    }
  }

  if (resolvedTargets.length > 0) {
    return {
      repository,
      defaultBranch,
      installability: resolvedTargets.length === 1 ? 'ready' : 'choice',
      summary: resolvedTargets.length === 1
        ? `检测到可安装的 ${resolvedTargets[0].packageName}。`
        : `检测到 ${resolvedTargets.length} 个可安装组件，请选择需要的组件。`,
      targets: resolvedTargets,
    }
  }

  // git tree 里 type === 'commit' 的条目是 gitlink（git submodule）。GitHub archive
  // 快照不含子模块内容，真正可安装的组件在子模块里，归类为应用/源码工作区，
  // 提示用户走「AI 尝试」（启动器会预取子模块内容）。
  const submodulePaths = entries
    .filter(entry => entry.type === 'commit')
    .map(entry => entry.path)
    .slice(0, 8)
  if (submodulePaths.length > 0) {
    return {
      repository,
      defaultBranch,
      installability: 'application',
      summary: `这是聚合仓库（meta-repo），含 ${submodulePaths.length} 个子模块（${submodulePaths.join('、')}）。子模块才是可安装组件，请用「AI 尝试」研究并安装。`,
      targets: [],
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
