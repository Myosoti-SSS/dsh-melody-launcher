import { access, mkdir, mkdtemp, readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import AdmZip from 'adm-zip'
import type {
  AppSettings,
  DshMarketCatalog,
  NonstandardPackImportPreview,
  NonstandardPackPluginPreview,
  NonstandardPackSkippedComponent,
  PackComponentCategory,
  ProfileSummary,
} from '../src/types'
import { parseGitHubImportUrl } from '../src/lib/github-import'
import { assertMeaningfulPackName } from './pack-manifest'
import { downloadGitHubArchive } from './github-archive'
import { analyzeMetaRepository } from './meta-repo-catalog'
import type { GitHubAuthService } from './github-auth'
import type { Installer } from './installer'
import { recordPluginInstall } from './plugin-receipts'
import { readProfile, togglePlugin, reorderPlugins } from './profile'
import type { ProfileService } from './profile-service'

const MAX_ARCHIVE_BYTES = 96 * 1024 * 1024
const MAX_FILES = 20_000
const SAFE_REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/

interface DistributionEntry {
  id?: unknown
  pkg?: unknown
  packageName?: unknown
  source?: unknown
  version?: unknown
  profile?: unknown
  install?: unknown
  path?: unknown
  subdirectory?: unknown
  [key: string]: unknown
}

interface DistributionManifest {
  core?: unknown
  optional?: unknown
  workspace?: unknown
  presets?: unknown
  skills?: unknown
  modelPresetLink?: unknown
}

export interface NonstandardPackOptions {
  githubAuth: GitHubAuthService
  installer: Installer
  dshMarket: { load(): Promise<DshMarketCatalog>; install?(name: string, profileName?: string): Promise<unknown> }
  profiles: ProfileService
  readSettings: () => Promise<AppSettings>
  pluginReceiptsPath: string
  pluginSourceRoot: string
  ensureDshVersion?: (version: string) => Promise<void>
}

export interface NonstandardPackService {
  analyze(url: string): Promise<NonstandardPackImportPreview>
  import(url: string, options?: { name?: string; packageNames?: string[]; installDsh?: boolean }): Promise<ProfileSummary>
  resolve(preview: NonstandardPackImportPreview): Promise<NonstandardPackPluginPreview[]>
}

interface Snapshot {
  root: string
  repository: string
  branch: string
  commit: string | null
  packageJson: Record<string, unknown>
  sourceJson: Record<string, unknown> | null
  bundles: DistributionManifest | null
  gitmodules: string | null
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function string(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function githubRepo(value: string | null): string | null {
  if (!value) return null
  const normalized = value.replace(/^git\+/, '').replace(/\.git$/, '')
  const match = /github\.com[/:]([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/i.exec(normalized) ?? /^github:([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)$/i.exec(normalized)
  const fullName = match?.[1]
  return fullName && SAFE_REPOSITORY.test(fullName) ? fullName : SAFE_REPOSITORY.test(normalized) ? normalized : null
}

async function readJson(filePath: string): Promise<Record<string, unknown> | null> {
  try { return object(JSON.parse(await readFile(filePath, 'utf8'))) } catch { return null }
}

async function walk(root: string, relative = ''): Promise<string[]> {
  if (relative.split('/').length > 20) return []
  const directory = path.join(root, relative)
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
  const result: string[] = []
  for (const entry of entries) {
    const next = relative ? `${relative}/${entry.name}` : entry.name
    if (entry.name === 'node_modules' || entry.name === '.git') continue
    if (entry.isDirectory()) result.push(...await walk(root, next))
    else result.push(next)
    if (result.length > MAX_FILES) return result.slice(0, MAX_FILES)
  }
  return result
}

async function unpack(buffer: Buffer, destination: string): Promise<void> {
  const entries = new AdmZip(buffer).getEntries()
  if (entries.length === 0 || entries.length > MAX_FILES) throw new Error('整合包仓库快照为空或文件数量超过限制。')
  const root = path.resolve(destination)
  let archiveRoot: string | null = null
  for (const entry of entries) {
    const normalized = entry.entryName.replace(/\\/g, '/')
    const parts = normalized.split('/').filter(Boolean)
    if (parts.length === 0) continue
    archiveRoot ??= parts[0]
    if (parts[0] !== archiveRoot) throw new Error('GitHub 仓库快照结构无效。')
    if (entry.isDirectory || parts.length === 1) continue
    const relative = parts.slice(1)
    if (relative.some(part => part === '.' || part === '..')) throw new Error('GitHub 仓库快照包含不安全路径。')
    const output = path.resolve(root, ...relative)
    if (!output.startsWith(`${root}${path.sep}`)) throw new Error('GitHub 仓库快照包含路径穿越。')
    await mkdir(path.dirname(output), { recursive: true })
    await writeFileCompat(output, entry.getData())
  }
}

async function writeFileCompat(filePath: string, data: Buffer): Promise<void> {
  const fs = await import('node:fs/promises')
  await fs.writeFile(filePath, data)
}

async function repoInfo(auth: GitHubAuthService, repository: string, branch?: string): Promise<{ branch: string; commit: string | null }> {
  const [owner, repo] = repository.split('/')
  const response = await auth.fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, { headers: { Accept: 'application/vnd.github+json' } })
  if (!response.ok) throw new Error(`无法读取 GitHub 仓库 ${repository}（HTTP ${response.status}）。`)
  const body = object(await response.json().catch(() => null))
  const resolvedBranch = branch ?? string(body?.default_branch) ?? 'main'
  const commitResponse = await auth.fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(resolvedBranch)}`, { headers: { Accept: 'application/vnd.github+json' } })
  const commitBody = object(await commitResponse.json().catch(() => null))
  return { branch: resolvedBranch, commit: string(commitBody?.sha) }
}

async function npmVersion(auth: GitHubAuthService, packageName: string, requested: string | null): Promise<string | null> {
  if (requested && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(requested)) return requested
  try {
    const response = await auth.fetch(`https://registry.npmjs.org/${encodeURIComponent(packageName)}`, { headers: { Accept: 'application/json' } })
    if (!response.ok) return null
    const body = object(await response.json().catch(() => null))
    const latest = object(body?.['dist-tags'])?.latest
    return string(latest)
  } catch {
    return null
  }
}

async function npmRepository(auth: GitHubAuthService, packageName: string): Promise<string | null> {
  try {
    const response = await auth.fetch(`https://registry.npmjs.org/${encodeURIComponent(packageName)}`, { headers: { Accept: 'application/json' } })
    if (!response.ok) return null
    const body = object(await response.json().catch(() => null))
    const repository = body?.repository
    const raw = typeof repository === 'string' ? repository : object(repository)?.url
    const declared = githubRepo(string(raw))
    if (declared) return declared
  } catch {
    // Continue with GitHub search when npm metadata is unavailable.
  }
  // A few packages in the wild omit `repository` when publishing. GitHub's
  // repository search is a conservative fallback: only an exact repository
  // basename match is accepted, never a fuzzy result.
  try {
    const shortName = packageName.split('/').at(-1) ?? packageName
    const response = await auth.fetch(`https://api.github.com/search/repositories?q=${encodeURIComponent(`${shortName} in:name`)}&per_page=10`, { headers: { Accept: 'application/vnd.github+json' } })
    if (!response.ok) return null
    const body = object(await response.json().catch(() => null))
    const items = Array.isArray(body?.items) ? body.items : []
    const exact = items.find(item => {
      const record = object(item)
      const fullName = string(record?.full_name)
      return fullName && fullName.split('/').at(-1)?.toLowerCase() === shortName.toLowerCase()
    })
    return githubRepo(string(object(exact)?.full_name))
  } catch { return null }
}

async function snapshot(options: NonstandardPackOptions, url: string): Promise<Snapshot> {
  const parsed = parseGitHubImportUrl(url)
  const repository = parsed.fullName
  const info = await repoInfo(options.githubAuth, repository, parsed.defaultBranch)
  const buffer = await (async () => {
    const response = await options.githubAuth.fetch(`https://codeload.github.com/${repository}/zip/${encodeURIComponent(info.commit ?? info.branch)}`, { headers: { 'User-Agent': 'DSH-Launcher' } })
    if (!response.ok) throw new Error(`下载 GitHub 仓库快照失败（HTTP ${response.status}）。`)
    const declared = Number(response.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > MAX_ARCHIVE_BYTES) throw new Error('整合包仓库快照过大。')
    return Buffer.from(await response.arrayBuffer())
  })().catch(async () => downloadGitHubArchive(repository, info.commit ?? info.branch, MAX_ARCHIVE_BYTES))
  const root = await mkdtemp(path.join(options.pluginSourceRoot, 'pack-'))
  await unpack(buffer, root)
  const packageJson = await readJson(path.join(root, 'package.json')) ?? {}
  const sourceJson = await readJson(path.join(root, 'dsh-source.json'))
  const bundlesRaw = await readJson(path.join(root, 'config', 'bundles.json'))
  const gitmodules = await readFile(path.join(root, '.gitmodules'), 'utf8').catch(() => null)
  return { root, repository, branch: info.branch, commit: info.commit, packageJson, sourceJson, bundles: bundlesRaw as DistributionManifest | null, gitmodules }
}

function packageNameFromEntry(entry: DistributionEntry): string | null {
  const value = string(entry.packageName) ?? string(entry.pkg)
  if (!value || value.startsWith('http') || value.includes('/') && SAFE_REPOSITORY.test(value) && !value.startsWith('@')) return null
  return value
}

function entrySource(entry: DistributionEntry): 'npm' | 'github' | 'link' | null {
  const source = string(entry.source)?.toLowerCase()
  return source === 'npm' || source === 'github' || source === 'link' ? source : null
}

function profilesFrom(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function addEntry(entries: NonstandardPackPluginPreview[], entry: DistributionEntry, category: PackComponentCategory, order: number): void {
  const id = string(entry.id) ?? `component-${order + 1}`
  const source = entrySource(entry)
  const pkg = packageNameFromEntry(entry)
  const repo = source === 'github' ? githubRepo(string(entry.pkg)) : null
  const enabled = profilesFrom(entry.profile).length === 0 || profilesFrom(entry.profile).includes('web') || profilesFrom(entry.profile).includes('desktop')
  if (!pkg && !repo && source !== 'link') return
  entries.push({ componentId: id, packageName: pkg ?? id, displayName: id, category, enabled, order, repository: repo, subdirectory: source === 'link' ? string(entry.pkg) : null, version: string(entry.version), commit: null, source: 'unavailable', sourceLabel: '正在解析来源', targetId: null })
}

async function findLocalPackages(root: string): Promise<Map<string, { directory: string; manifest: Record<string, unknown> }>> {
  const result = new Map<string, { directory: string; manifest: Record<string, unknown> }>()
  const files = await walk(root)
  for (const relative of files.filter(item => item.endsWith('package.json'))) {
    const directory = path.dirname(path.join(root, relative))
    const manifest = await readJson(path.join(root, relative))
    if (!manifest) continue
    const dsh = object(manifest.dsh)
    const bundle = object(dsh?.bundle)
    const hasBundle = Boolean(bundle?.patch) || Boolean(object(dsh?.profile)) || /^@?dsh[-/]/i.test(string(manifest.name) ?? '')
    const name = string(manifest.name)
    if (name && hasBundle) result.set(name, { directory, manifest })
  }
  return result
}

function marketMatch(catalog: DshMarketCatalog, item: NonstandardPackPluginPreview): { source: 'market' | 'github'; repository: string | null; targetId: string | null } | null {
  const needle = item.packageName.toLowerCase()
  const match = catalog.plugins.find(plugin => plugin.npm?.toLowerCase() === needle || plugin.name.toLowerCase() === needle || (item.repository && plugin.url.toLowerCase().includes(item.repository.toLowerCase())))
  if (!match) return null
  const urlMatch = /github\.com\/([^/]+\/[^/]+)/i.exec(match.url)
  return { source: match.npm ? 'market' : 'github', repository: match.npm ? null : (urlMatch?.[1]?.replace(/\.git$/, '') ?? item.repository), targetId: match.npm ?? match.name }
}

export async function analyzeNonstandardPackRepository(options: NonstandardPackOptions, url: string): Promise<NonstandardPackImportPreview> {
  const snap = await snapshot(options, url)
  const rootManifest = snap.packageJson
  const standard = await access(path.join(snap.root, 'dsh-profile.yaml')).then(() => true).catch(() => false) || await access(path.join(snap.root, 'dsh-pack.yaml')).then(() => true).catch(() => false)
  const kind = standard ? 'standard-profile' : snap.bundles ? 'distribution' : snap.gitmodules ? 'meta-repo' : 'unknown'
  const name = string(rootManifest.name)?.replace(/^@[^/]+\//, '') ?? snap.repository.split('/')[1]
  const dshDependencies = object(rootManifest.dependencies)
  const dshVersion = string(dshDependencies?.['@deepseek-ai/dsh'])
  const dshSourceVersion = string(snap.sourceJson?.version)
  const warnings = dshVersion && dshSourceVersion && dshVersion !== dshSourceVersion ? [`DSH 运行时 ${dshVersion} 与源码基线 ${dshSourceVersion} 不一致，仅记录警告。`] : []
  const plugins: NonstandardPackPluginPreview[] = []
  const skipped: NonstandardPackSkippedComponent[] = []
  const bundles = snap.bundles ?? {}
  let order = 0
  for (const category of ['core', 'optional'] as const) {
    const values = Array.isArray(bundles[category]) ? bundles[category] : []
    for (const raw of values) {
      if (!object(raw)) continue
      const entry = raw as DistributionEntry
      if (string(entry.install)?.toLowerCase() === 'manual' || string(entry.id)?.toLowerCase() === 'dsh-browser') {
        skipped.push({ id: string(entry.id) ?? `component-${order + 1}`, name: string(entry.id) ?? '未命名组件', category: 'application', reason: '该组件需要手动安装（浏览器扩展或桌面组件），不会作为 DSH 插件安装。' })
        continue
      }
      addEntry(plugins, entry, category, order++)
    }
  }
  if (!snap.bundles && snap.gitmodules) {
    const meta = await analyzeMetaRepository(snap.repository, snap.branch, options.installer.analyzePlugin, options.installer.analyzeSkill, options.githubAuth.fetch).catch(() => null)
    for (const target of meta?.pluginAnalysis?.targets ?? []) {
      const repository = target.sourceRepository ?? null
      plugins.push({ componentId: target.id, packageName: target.packageName, displayName: target.packageName, category: 'vendored', enabled: true, order: order++, repository: repository ?? null, subdirectory: target.subdirectory, version: target.version, commit: target.commit, source: target.source === 'npm' ? 'unavailable' : 'github', sourceLabel: target.source === 'npm' ? '正在解析 npm 来源' : 'GitHub', targetId: target.id, ...(target.source === 'npm' && !target.version ? { reason: 'meta-repo 子模块缺少精确 npm 版本。' } : {}) })
    }
    for (const target of meta?.presetAnalysis?.targets ?? []) skipped.push({ id: target.id, name: target.name, category: 'preset', reason: 'meta-repo 子模块中的 Agent 预设，导入时跳过。' })
  }
  const localPackages = await findLocalPackages(snap.root)
  for (const [packageName, local] of localPackages) {
    const linked = plugins.find(plugin => plugin.subdirectory && path.normalize(plugin.subdirectory) === path.normalize(path.relative(snap.root, local.directory).replace(/\\/g, '/')))
    if (linked) {
      linked.packageName = packageName
      linked.displayName = string(local.manifest.description) ?? packageName
      linked.version = string(local.manifest.version)
      linked.source = 'local'
      linked.sourceLabel = '整合包本地源码'
      linked.targetId = packageName
      continue
    }
    if (plugins.some(plugin => plugin.packageName === packageName)) continue
    plugins.push({ componentId: packageName, packageName, displayName: string(local.manifest.description) ?? packageName, category: 'workspace', enabled: true, order: order++, repository: snap.repository, subdirectory: path.relative(snap.root, local.directory).replace(/\\/g, '/'), version: string(local.manifest.version), commit: snap.commit, source: 'local', sourceLabel: '整合包本地源码', targetId: packageName })
  }
  for (const plugin of plugins.filter(item => item.source === 'unavailable')) {
    const local = localPackages.get(plugin.packageName) ?? [...localPackages.entries()].find(([name]) => name.toLowerCase() === plugin.componentId.toLowerCase() || name.split('/').at(-1)?.toLowerCase() === plugin.componentId.toLowerCase())?.[1]
    if (local) {
      plugin.packageName = string(local.manifest.name) ?? plugin.packageName
      plugin.displayName = string(local.manifest.description) ?? plugin.packageName
      plugin.subdirectory = path.relative(snap.root, local.directory).replace(/\\/g, '/')
      plugin.repository = snap.repository
      plugin.commit = snap.commit
      plugin.source = 'local'
      plugin.sourceLabel = '整合包本地源码'
      plugin.targetId = plugin.packageName
    }
  }
  const presetValues = Array.isArray(bundles.presets) ? bundles.presets : []
  for (const raw of presetValues) if (object(raw)) skipped.push({ id: string((raw as Record<string, unknown>).id) ?? 'preset', name: string((raw as Record<string, unknown>).id) ?? 'preset', category: 'preset', reason: 'Agent 预设由独立预设流程处理，暂不作为插件安装。' })
  const catalog = await options.dshMarket.load().catch(() => ({ updated: '', count: 0, categories: {}, plugins: [] } as DshMarketCatalog))
  for (const plugin of plugins) {
    const match = marketMatch(catalog, plugin)
    if (match) { plugin.source = match.source; plugin.sourceLabel = match.source === 'market' ? 'DSH Market' : 'GitHub'; plugin.targetId = match.targetId ?? plugin.targetId; if (match.repository) plugin.repository = match.repository }
    if (plugin.source === 'local') continue
    if (plugin.source === 'market' && !plugin.repository) {
      plugin.version = await npmVersion(options.githubAuth, plugin.packageName, plugin.version)
      if (!plugin.version) { plugin.source = 'unavailable'; plugin.sourceLabel = '无法安装'; plugin.reason = '无法解析 npm 的精确版本。' }
      continue
    }
    if (plugin.source === 'unavailable' && !plugin.repository) {
      const repository = await npmRepository(options.githubAuth, plugin.packageName)
      if (repository) {
        plugin.repository = repository
        plugin.source = 'github'
        plugin.sourceLabel = 'GitHub（npm 元数据）'
        plugin.commit = (await repoInfo(options.githubAuth, repository).catch(() => null))?.commit ?? snap.commit
      }
    }
    if (plugin.repository && plugin.source === 'github' && !plugin.commit) {
      const pinned = await repoInfo(options.githubAuth, plugin.repository).catch(() => null)
      plugin.commit = pinned?.commit ?? snap.commit
    }
    if (plugin.repository || plugin.packageName) { plugin.source = plugin.repository ? 'github' : 'unavailable'; plugin.sourceLabel = plugin.repository ? 'GitHub' : '无法安装'; if (!plugin.repository) plugin.reason = '没有可验证的 npm 包名或 GitHub 仓库。'; continue }
    plugin.source = 'unavailable'; plugin.sourceLabel = '无法安装'; plugin.reason = '缺少可验证的安装来源。'
  }
  if (bundles.modelPresetLink && object(bundles.modelPresetLink)) {
    const linkedPlugin = string(object(bundles.modelPresetLink)?.plugin)
    if (!linkedPlugin || !plugins.some(plugin => plugin.packageName === linkedPlugin)) skipped.push({ id: 'modelPresetLink', name: linkedPlugin ?? 'modelPresetLink', category: 'unknown', reason: '模型预设联动配置已记录，需作为普通插件单独安装。' })
  }
  const blockers = kind === 'unknown' ? ['仓库未识别为标准 Profile、meta-repo 或独立 DSH 发行版。'] : plugins.filter(plugin => plugin.source === 'unavailable').map(plugin => `${plugin.packageName}：${plugin.reason ?? '无安装来源'}`)
  return { repository: snap.repository, branch: snap.branch, commit: snap.commit, kind, name, description: string(rootManifest.description) ?? '', profileName: assertMeaningfulPackName(name), dshVersion, dshSourceVersion, warnings, plugins, skipped, blockers }
}

function uniqueProfileName(base: string, existing: string[]): string {
  const used = new Set(existing)
  if (!used.has(base)) return base
  let index = 2
  while (used.has(`${base}-${index}`)) index += 1
  return `${base}-${index}`
}

export async function importNonstandardPackRepository(options: NonstandardPackOptions, url: string, input: { name?: string; packageNames?: string[]; installDsh?: boolean } = {}): Promise<ProfileSummary> {
  const preview = await analyzeNonstandardPackRepository(options, url)
  if (preview.blockers.length > 0 && preview.plugins.every(plugin => plugin.source === 'unavailable')) throw new Error(preview.blockers.join('；'))
  const settings = await options.readSettings()
  const summaries = await options.profiles.list()
  const requested = input.name?.trim() ? assertMeaningfulPackName(input.name.trim()) : preview.profileName
  const profileName = uniqueProfileName(requested, summaries.map(summary => summary.name))
  if (preview.dshVersion && input.installDsh !== false && options.ensureDshVersion) await options.ensureDshVersion(preview.dshVersion)
  await options.profiles.create({
    name: profileName,
    description: preview.description,
    dshVersion: preview.dshVersion,
    empty: true,
    packName: preview.name,
    distributionKind: preview.kind === 'meta-repo' ? 'meta-repo' : 'distribution',
    source: { kind: 'import', format: 'distribution', reference: url, packName: preview.name, distributionKind: preview.kind === 'meta-repo' ? 'meta-repo' : 'distribution' },
  })
  const wanted = input.packageNames ? new Set(input.packageNames) : null
  const failures: string[] = []
  for (const plugin of preview.plugins) {
    if (wanted && !wanted.has(plugin.packageName)) continue
    if (plugin.source === 'unavailable') { failures.push(`${plugin.packageName}：${plugin.reason ?? '无安装来源'}`); continue }
    try {
      if (plugin.source === 'local') {
        const snap = await snapshot(options, url)
        const local = (await findLocalPackages(snap.root)).get(plugin.packageName)
        if (!local) throw new Error('整合包内没有找到本地插件本体。')
        await options.installer.installLocalPlugin({ packageName: plugin.packageName, directory: local.directory, repository: preview.repository, commit: preview.commit ?? undefined, version: plugin.version ?? undefined }, profileName)
      } else if (plugin.source === 'market' && options.dshMarket.install && plugin.targetId) {
        await options.dshMarket.install(plugin.targetId, profileName)
      } else if (!plugin.repository) {
        await options.installer.installNpmPackage({ packageName: plugin.packageName, version: plugin.version ?? undefined, repository: `npm:${plugin.packageName}` }, profileName)
      } else {
        const analysis = await options.installer.analyzePlugin(plugin.repository, preview.branch)
        const target = analysis.targets.find(item => item.packageName === plugin.packageName) ?? analysis.targets[0]
        if (!target) throw new Error('GitHub 仓库没有检测到可安装的 Bundle。')
        await options.installer.installPluginTarget({ repository: plugin.repository, defaultBranch: preview.branch, targetId: target.id, commit: plugin.commit ?? undefined, version: plugin.version ?? undefined }, profileName)
      }
      const receipt = await readFile(options.pluginReceiptsPath, 'utf8').catch(() => '')
      void receipt
      const actualSource = plugin.source === 'market' ? 'market' : plugin.source === 'local' ? 'local' : 'github'
      await recordPluginInstall(options.pluginReceiptsPath, { repository: plugin.repository ?? `npm:${plugin.packageName}`, packageName: plugin.packageName, profileName, source: plugin.source === 'local' ? 'local-directory' : plugin.source === 'market' && !plugin.repository ? 'npm' : 'github', subdirectory: plugin.subdirectory, version: plugin.version, commit: plugin.commit ?? '', targetId: plugin.targetId ?? plugin.packageName, installedAt: new Date().toISOString(), packName: preview.name, packRepository: preview.repository, packCommit: preview.commit, componentId: plugin.componentId, actualSource })
      if (!plugin.enabled) await togglePlugin(settings.dshHome, profileName, plugin.packageName, false)
    } catch (error) {
      failures.push(`${plugin.packageName}：${error instanceof Error ? error.message : '安装失败'}`)
    }
  }
  const installed = await readProfile(settings.dshHome, profileName, options.pluginReceiptsPath)
  const desiredOrder = installed.activeBundles.slice().sort((a, b) => {
    const left = preview.plugins.find(plugin => plugin.packageName === a)?.order ?? Number.MAX_SAFE_INTEGER
    const right = preview.plugins.find(plugin => plugin.packageName === b)?.order ?? Number.MAX_SAFE_INTEGER
    return left - right
  })
  if (desiredOrder.length > 0 && desiredOrder.length === installed.activeBundles.length) await reorderPlugins(settings.dshHome, profileName, desiredOrder, options.pluginReceiptsPath)
  // Successful items remain in the isolated Profile. Failed items are kept in
  // the caller's operation log; they are deliberately not added to bundles.
  const finalState = failures.length === 0 ? 'complete' : installed.plugins.some(plugin => !plugin.builtin && plugin.compatible) ? 'partial' : 'failed'
  const metadata = await options.profiles.metadata(profileName)
  const profileDirectory = path.join(settings.dshHome, 'profiles', profileName)
  await writeProfileYamlMetadata(profileDirectory, { importState: finalState, importFailures: failures })
  return { ...metadata, importState: finalState, importFailures: failures }
}

async function writeProfileYamlMetadata(directory: string, fields: { importState: 'complete' | 'partial' | 'failed'; importFailures: string[] }): Promise<void> {
  const filePath = path.join(directory, 'profile.yaml')
  const current = await readJson(filePath) ?? {}
  const fs = await import('node:fs/promises')
  await fs.writeFile(filePath, `${JSON.stringify({ ...current, ...fields, updatedAt: new Date().toISOString() }, null, 2)}\n`, 'utf8')
}

export async function resolvePackPluginSources(preview: NonstandardPackImportPreview): Promise<NonstandardPackPluginPreview[]> {
  return preview.plugins.map(plugin => ({ ...plugin }))
}

export function createNonstandardPackService(options: NonstandardPackOptions): NonstandardPackService {
  return {
    analyze: url => analyzeNonstandardPackRepository(options, url),
    import: (url, input) => importNonstandardPackRepository(options, url, input),
    resolve: preview => resolvePackPluginSources(preview),
  }
}
