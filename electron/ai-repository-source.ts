import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import AdmZip from 'adm-zip'
import { downloadGitHubArchive, githubArchiveUrl } from './github-archive'
import { isSafeRepositoryName } from './profile'

const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024
const MAX_FILES = 12_000
const MAX_UNPACKED_BYTES = 256 * 1024 * 1024

export interface AiRepositorySource {
  taskRoot: string
  repositoryPath: string
}

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

async function readArchiveResponse(
  response: Response,
  onProgress?: (received: number, total: number | null) => void,
): Promise<Buffer> {
  if (!response.ok || !response.body) throw new Error(`下载 AI 研究仓库失败（HTTP ${response.status}）。`)
  const declaredSize = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredSize) && declaredSize > MAX_ARCHIVE_BYTES) {
    throw new Error('仓库压缩包过大，已停止 AI 研究。')
  }
  const total = Number.isFinite(declaredSize) && declaredSize > 0 ? declaredSize : null
  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let received = 0
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    received += chunk.value.byteLength
    if (received > MAX_ARCHIVE_BYTES) {
      await reader.cancel().catch(() => undefined)
      throw new Error('仓库压缩包过大，已停止 AI 研究。')
    }
    chunks.push(Buffer.from(chunk.value))
    onProgress?.(received, total)
  }
  return Buffer.concat(chunks, received)
}

/**
 * Download and safely unpack a public GitHub repository into a temporary
 * directory inside DSH_HOME. The AI reads this local copy, so repository
 * inspection does not depend on its shell/network channel.
 */
export async function prepareAiRepositorySource(
  sourceRoot: string,
  repository: string,
  revision: string,
  onProgress?: (received: number, total: number | null) => void,
  fetchImpl?: typeof fetch,
): Promise<AiRepositorySource> {
  if (!isSafeRepositoryName(repository) || !safeRevision(revision)) {
    throw new Error('AI 研究仓库或分支名称无效。')
  }
  await mkdir(sourceRoot, { recursive: true })
  const taskRoot = await mkdtemp(path.join(sourceRoot, 'session-'))
  const repositoryPath = path.join(taskRoot, 'repository')
  try {
    const archiveBuffer = fetchImpl
      ? await readArchiveResponse(await fetchImpl(githubArchiveUrl(repository, revision), {
        headers: { 'User-Agent': 'DSH-Launcher' },
      }), onProgress)
      : await downloadGitHubArchive(repository, revision, MAX_ARCHIVE_BYTES, onProgress)
    const entries = new AdmZip(archiveBuffer).getEntries()
    if (entries.length > MAX_FILES) throw new Error('仓库文件数量超过安全限制，已停止 AI 研究。')

    let archiveRoot: string | null = null
    let unpackedBytes = 0
    let copiedFiles = 0
    for (const entry of entries) {
      const archivePath = safeArchivePath(entry.entryName)
      if (!archivePath) throw new Error('AI 研究仓库压缩包包含不安全路径。')
      const root = archivePath.split('/')[0]
      if (!archiveRoot) archiveRoot = root
      if (root !== archiveRoot) throw new Error('AI 研究仓库压缩包结构无效。')
      if (entry.isDirectory) continue

      const relativePath = archivePath.slice(root.length + 1)
      if (!relativePath) continue
      const safeRelative = safeArchivePath(relativePath)
      if (!safeRelative) throw new Error('AI 研究仓库包含不安全路径。')
      copiedFiles += 1
      const declaredBytes = Number(entry.header.size) || 0
      if (unpackedBytes + declaredBytes > MAX_UNPACKED_BYTES) {
        throw new Error('仓库解压体积超过安全限制，已停止 AI 研究。')
      }
      const data = entry.getData()
      unpackedBytes += data.byteLength
      if (copiedFiles > MAX_FILES || unpackedBytes > MAX_UNPACKED_BYTES) {
        throw new Error('仓库解压体积超过安全限制，已停止 AI 研究。')
      }
      const outputPath = path.join(repositoryPath, ...safeRelative.split('/'))
      const resolvedRoot = path.resolve(repositoryPath)
      const resolvedOutput = path.resolve(outputPath)
      if (!resolvedOutput.startsWith(`${resolvedRoot}${path.sep}`)) {
        throw new Error('AI 研究仓库文件超出了允许范围。')
      }
      await mkdir(path.dirname(outputPath), { recursive: true })
      await writeFile(outputPath, data)
    }
    if (!archiveRoot || copiedFiles === 0) throw new Error('AI 研究仓库压缩包为空。')
    return { taskRoot, repositoryPath }
  } catch (error) {
    await rm(taskRoot, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
}
