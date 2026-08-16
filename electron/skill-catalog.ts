import path from 'node:path'
import AdmZip from 'adm-zip'
import type { SkillInstallTarget, SkillRepositoryAnalysis } from '../src/types'
import { downloadGitHubArchive, githubArchiveUrl } from './github-archive'
import { isSafeRepositoryName } from './profile'
import { parseSkillDocument } from './skill-format'

const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024
const MAX_FILES = 12_000
const MAX_UNPACKED_BYTES = 256 * 1024 * 1024
const MAX_SKILL_DOCUMENT_BYTES = 2 * 1024 * 1024
const MAX_CANDIDATES = 128

function safeRevision(value: string): boolean {
  return value.length > 0
    && value.length <= 160
    && !value.includes('..')
    && /^[A-Za-z0-9._/-]+$/.test(value)
}

function safeArchivePath(value: string): string | null {
  const normalized = path.posix.normalize(value.replace(/\\/g, '/')).replace(/^\.\//, '')
  if (!normalized || normalized === '..' || normalized.startsWith('../') || path.posix.isAbsolute(normalized)) return null
  return normalized
}

/** 判定一个 .md 文件是否为「flat skill 候选」。导出供 raw 包扫描（pack-scan.ts）复用。 */
export function likelyFlatSkill(filePath: string): boolean {
  if (!filePath.toLowerCase().endsWith('.md') || /(?:^|\/)skill\.md$/i.test(filePath)) return false
  const lower = filePath.toLowerCase()
  if (/(?:^|\/)(?:readme|license|contributing|changelog)(?:\.[^/]*)?\.md$/.test(lower)) return false
  const segments = lower.split('/')
  return segments.length === 1
    || (segments.length <= 3 && ['skills', '.dsh', '.agents'].includes(segments[0]))
}

/** 同名 skill 候选去重：路径浅优先，其次 bundle 优先于 flat。导出供 raw 包扫描复用。 */
export function preferTarget(left: SkillInstallTarget, right: SkillInstallTarget): SkillInstallTarget {
  const leftDepth = left.sourcePath.split('/').length
  const rightDepth = right.sourcePath.split('/').length
  if (leftDepth !== rightDepth) return leftDepth < rightDepth ? left : right
  if (left.format !== right.format) return left.format === 'bundle' ? left : right
  return left.sourcePath.localeCompare(right.sourcePath) <= 0 ? left : right
}

async function readArchive(response: Response): Promise<Buffer> {
  if (!response.ok || !response.body) throw new Error(`下载 Skill 仓库失败（HTTP ${response.status}）。`)
  const declaredSize = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredSize) && declaredSize > MAX_ARCHIVE_BYTES) {
    throw new Error('仓库压缩包过大，已停止 Skill 检测。')
  }

  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let received = 0
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    received += chunk.value.byteLength
    if (received > MAX_ARCHIVE_BYTES) {
      await reader.cancel().catch(() => undefined)
      throw new Error('仓库压缩包过大，已停止 Skill 检测。')
    }
    chunks.push(Buffer.from(chunk.value))
  }
  return Buffer.concat(chunks, received)
}

export async function analyzeSkillRepository(
  repository: string,
  defaultBranch: string,
  fetchImpl?: typeof fetch,
): Promise<SkillRepositoryAnalysis> {
  if (!isSafeRepositoryName(repository) || !safeRevision(defaultBranch)) throw new Error('仓库名称或默认分支无效。')

  const archiveBuffer = fetchImpl
    ? await readArchive(await fetchImpl(githubArchiveUrl(repository, defaultBranch), { headers: { 'User-Agent': 'DSH-Launcher' } }))
    : await downloadGitHubArchive(repository, defaultBranch, MAX_ARCHIVE_BYTES)
  const archive = new AdmZip(archiveBuffer)
  const entries = archive.getEntries()
  if (entries.length > MAX_FILES) throw new Error('仓库文件数量超过安全限制，已停止 Skill 检测。')

  let unpackedBytes = 0
  const repositoryFiles: Array<{ sourcePath: string; entry: AdmZip.IZipEntry }> = []
  let archiveRoot: string | null = null
  for (const entry of entries) {
    const archivePath = safeArchivePath(entry.entryName)
    if (!archivePath) throw new Error('仓库压缩包包含不安全路径。')
    const root = archivePath.split('/')[0]
    if (!archiveRoot) archiveRoot = root
    if (root !== archiveRoot) throw new Error('仓库压缩包结构无效。')
    if (entry.isDirectory) continue

    unpackedBytes += Number(entry.header.size) || 0
    if (unpackedBytes > MAX_UNPACKED_BYTES) throw new Error('仓库解压体积超过安全限制，已停止 Skill 检测。')
    const sourcePath = archivePath.slice(archiveRoot.length + 1)
    if (sourcePath) repositoryFiles.push({ sourcePath, entry })
  }

  const candidates = [
    ...repositoryFiles.filter(file => /(?:^|\/)SKILL\.md$/i.test(file.sourcePath)),
    ...repositoryFiles.filter(file => likelyFlatSkill(file.sourcePath)),
  ].slice(0, MAX_CANDIDATES)

  const discovered = new Map<string, SkillInstallTarget>()
  for (const { sourcePath, entry } of candidates) {
    const documentBytes = Number(entry.header.size) || 0
    if (documentBytes > MAX_SKILL_DOCUMENT_BYTES) continue
    const parsed = parseSkillDocument(entry.getData().toString('utf8'))
    if (!parsed) continue
    const format = path.posix.basename(sourcePath).toLowerCase() === 'skill.md' ? 'bundle' : 'flat'
    const target: SkillInstallTarget = {
      id: `${parsed.name}:${sourcePath}`,
      name: parsed.name,
      description: parsed.description,
      sourcePath,
      format,
      revision: defaultBranch,
      modelInvocable: parsed.modelInvocable,
      userInvocable: parsed.userInvocable,
    }
    const existing = discovered.get(parsed.name)
    discovered.set(parsed.name, existing ? preferTarget(existing, target) : target)
  }

  const targets = [...discovered.values()].sort((left, right) => left.name.localeCompare(right.name))
  if (targets.length > 0) {
    return {
      repository,
      defaultBranch,
      installability: targets.length === 1 ? 'ready' : 'choice',
      summary: targets.length === 1
        ? `确认是 DSH Skill：${targets[0].name}`
        : `确认包含 ${targets.length} 个有效 DSH Skills。`,
      targets,
    }
  }
  return {
    repository,
    defaultBranch,
    installability: 'invalid',
    summary: '没有找到符合 DSH 规范的 SKILL.md 或单文件 Skill。',
    targets: [],
  }
}
