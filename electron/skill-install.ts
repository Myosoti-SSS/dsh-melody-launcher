import { createWriteStream } from 'node:fs'
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { once } from 'node:events'
import path from 'node:path'
import AdmZip from 'adm-zip'
import type { InstalledSkill, SkillInstallTarget } from '../src/types'
import { downloadGitHubArchive, githubArchiveUrl } from './github-archive'
import { isSafeRepositoryName } from './profile'
import { isSkillName, parseSkillDocument } from './skill-format'

const MAX_FILES = 5000
const MAX_UNPACKED_BYTES = 100 * 1024 * 1024
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024
const MAX_ARCHIVE_FILES = 12_000

async function exists(target: string): Promise<boolean> {
  try {
    await access(target)
    return true
  } catch {
    return false
  }
}

function assertInside(root: string, target: string): void {
  const resolvedRoot = path.resolve(root)
  const resolvedTarget = path.resolve(target)
  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error('Skill 安装路径超出了允许范围。')
  }
}

function safeArchivePath(value: string): string | null {
  const normalized = path.posix.normalize(value.replace(/\\/g, '/')).replace(/^\.\//, '')
  if (!normalized || normalized === '..' || normalized.startsWith('../') || path.posix.isAbsolute(normalized)) return null
  return normalized
}

function safeRevision(value: string): boolean {
  return value.length > 0
    && value.length <= 160
    && !value.includes('..')
    && /^[A-Za-z0-9._/-]+$/.test(value)
}

async function downloadArchive(
  repository: string,
  revision: string,
  destination: string,
  onProgress: (percent: number, message: string) => void,
  fetchImpl?: typeof fetch,
): Promise<void> {
  if (!fetchImpl) {
    const archive = await downloadGitHubArchive(repository, revision, MAX_ARCHIVE_BYTES, (received, total) => {
      if (total) onProgress(18 + Math.round(Math.min(1, received / total) * 42), `正在下载 Skill ${Math.round(received / total * 100)}%`)
    })
    await writeFile(destination, archive, { flag: 'wx' })
    return
  }
  const response = await fetchImpl(githubArchiveUrl(repository, revision), {
    headers: { 'User-Agent': 'DSH-Launcher' },
  })
  if (!response.ok || !response.body) throw new Error(`下载 Skill 仓库失败（HTTP ${response.status}）。`)
  const total = Number(response.headers.get('content-length'))
  if (Number.isFinite(total) && total > MAX_ARCHIVE_BYTES) throw new Error('Skill 仓库压缩包过大，已停止安装。')
  const writer = createWriteStream(destination, { flags: 'wx' })
  const reader = response.body.getReader()
  let received = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      received += chunk.value.byteLength
      if (received > MAX_ARCHIVE_BYTES) {
        await reader.cancel().catch(() => undefined)
        throw new Error('Skill 仓库压缩包过大，已停止安装。')
      }
      if (!writer.write(Buffer.from(chunk.value))) await once(writer, 'drain')
      if (Number.isFinite(total) && total > 0) {
        onProgress(18 + Math.round(Math.min(1, received / total) * 42), `正在下载 Skill ${Math.round(received / total * 100)}%`)
      }
    }
    writer.end()
    await once(writer, 'finish')
  } catch (error) {
    writer.destroy()
    throw error
  }
}

async function replacePath(staged: string, destination: string): Promise<void> {
  const backup = `${destination}.dsh-launcher-backup-${process.pid}-${Date.now()}`
  const hadDestination = await exists(destination)
  if (hadDestination) await rename(destination, backup)
  try {
    await rename(staged, destination)
    if (hadDestination) await rm(backup, { recursive: true, force: true })
  } catch (error) {
    if (hadDestination && await exists(backup) && !await exists(destination)) await rename(backup, destination)
    throw error
  }
}

export async function installSkillFromRepository(
  cacheRoot: string,
  dshHome: string,
  repository: string,
  target: SkillInstallTarget,
  onProgress: (percent: number, message: string) => void,
  fetchImpl?: typeof fetch,
): Promise<InstalledSkill> {
  if (!isSafeRepositoryName(repository) || !safeRevision(target.revision) || !isSkillName(target.name)) {
    throw new Error('Skill 仓库、版本或名称无效。')
  }
  const sourcePath = safeArchivePath(target.sourcePath)
  if (!sourcePath) throw new Error('Skill 来源路径无效。')

  await mkdir(cacheRoot, { recursive: true })
  const skillRoot = path.join(dshHome, 'skills')
  const stagingRoot = path.join(dshHome, '.skill-staging', `${process.pid}-${Date.now()}`)
  const zipPath = path.join(cacheRoot, `.skill-${process.pid}-${Date.now()}.zip`)
  assertInside(cacheRoot, zipPath)
  assertInside(dshHome, stagingRoot)
  await mkdir(stagingRoot, { recursive: true })

  try {
    onProgress(12, '正在下载 Skill 仓库')
    await downloadArchive(repository, target.revision, zipPath, onProgress, fetchImpl)
    onProgress(64, '正在核对 Skill 文件')
    const archive = new AdmZip(zipPath)
    const entries = archive.getEntries()
    if (entries.length > MAX_ARCHIVE_FILES) throw new Error('Skill 仓库文件数量超过安全限制。')
    const firstFile = entries.find(entry => !entry.isDirectory)
    const archiveRoot = firstFile?.entryName.split('/')[0]
    if (!archiveRoot) throw new Error('Skill 仓库压缩包结构无效。')

    const sourceDirectory = target.format === 'bundle'
      ? path.posix.dirname(sourcePath) === '.' ? '' : path.posix.dirname(sourcePath)
      : null
    const staged = target.format === 'bundle'
      ? path.join(stagingRoot, target.name)
      : path.join(stagingRoot, `${target.name}.md`)
    let copiedFiles = 0
    let unpackedBytes = 0

    for (const entry of entries) {
      if (entry.isDirectory) continue
      const archivePath = safeArchivePath(entry.entryName)
      if (!archivePath || !archivePath.startsWith(`${archiveRoot}/`)) throw new Error('Skill 压缩包包含不安全路径。')
      const repositoryPath = archivePath.slice(archiveRoot.length + 1)
      let relativePath: string | null = null
      if (target.format === 'flat') {
        if (repositoryPath === sourcePath) relativePath = path.basename(staged)
      } else if (!sourceDirectory) {
        relativePath = repositoryPath
      } else if (repositoryPath.startsWith(`${sourceDirectory}/`)) {
        relativePath = repositoryPath.slice(sourceDirectory.length + 1)
      }
      if (!relativePath) continue
      const safeRelative = safeArchivePath(relativePath)
      if (!safeRelative) throw new Error('Skill 组件包含不安全路径。')
      copiedFiles += 1
      unpackedBytes += Number(entry.header.size) || 0
      if (copiedFiles > MAX_FILES || unpackedBytes > MAX_UNPACKED_BYTES) throw new Error('Skill 组件体积或文件数量超过安全限制。')
      const outputPath = target.format === 'flat' ? staged : path.join(staged, ...safeRelative.split('/'))
      assertInside(stagingRoot, outputPath)
      await mkdir(path.dirname(outputPath), { recursive: true })
      await writeFile(outputPath, entry.getData())
    }

    const stagedSkillFile = target.format === 'bundle' ? path.join(staged, 'SKILL.md') : staged
    const parsed = parseSkillDocument(await readFile(stagedSkillFile, 'utf8'))
    if (!parsed || parsed.name !== target.name) throw new Error('下载内容不再是检测时确认的 Skill。')

    onProgress(84, '正在写入 DSH Skill 目录')
    await mkdir(skillRoot, { recursive: true })
    const destination = target.format === 'bundle'
      ? path.join(skillRoot, target.name)
      : path.join(skillRoot, `${target.name}.md`)
    const conflicting = target.format === 'bundle'
      ? path.join(skillRoot, `${target.name}.md`)
      : path.join(skillRoot, target.name)
    assertInside(skillRoot, destination)
    assertInside(skillRoot, conflicting)
    const disabledRoot = path.join(skillRoot, '.disabled')
    const disabledDestination = target.format === 'bundle'
      ? path.join(disabledRoot, target.name)
      : path.join(disabledRoot, `${target.name}.md`)
    const disabledConflicting = target.format === 'bundle'
      ? path.join(disabledRoot, `${target.name}.md`)
      : path.join(disabledRoot, target.name)
    assertInside(skillRoot, disabledDestination)
    assertInside(skillRoot, disabledConflicting)
    await replacePath(staged, destination)
    await rm(conflicting, { recursive: true, force: true })
    await rm(disabledDestination, { recursive: true, force: true })
    await rm(disabledConflicting, { recursive: true, force: true })
    onProgress(96, '正在验证本地 Skill')
    return {
      name: parsed.name,
      description: parsed.description,
      path: destination,
      format: target.format,
      enabled: true,
      modelInvocable: parsed.modelInvocable,
      userInvocable: parsed.userInvocable,
    }
  } finally {
    await rm(zipPath, { force: true }).catch(() => undefined)
    await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined)
  }
}
