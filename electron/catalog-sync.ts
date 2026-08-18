import type { CatalogRepositoryAnalysis, CatalogSyncInfo } from '../src/types'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { LAUNCHER_REPOSITORY } from '../src/constants'

const GITHUB_API_ROOT = 'https://api.github.com'
const CATALOG_BRANCH = 'main'
const CATALOG_DIRECTORY = 'catalog/analysis'
// v2：聚合仓库不再让子模块分析覆盖根仓库的应用加载项，旧共享结果必须重新检测。
const RECORD_VERSION = 2
// Git ref names cannot contain spaces, so normalize the requested
// "plugin update" branch to a valid GitHub branch name.
const BATCH_BRANCH = 'plugin-update'

interface CatalogRecord {
  schemaVersion: 2
  repository: string
  defaultBranch: string
  repositoryUpdatedAt: string | null
  analyzedAt: string
  submittedBy: string | null
  analysis: CatalogRepositoryAnalysis
}

interface GitHubRepositoryResponse {
  default_branch?: unknown
  name?: unknown
  parent?: { full_name?: unknown }
}

interface GitHubRefResponse {
  object?: { sha?: unknown }
}

interface GitHubContentResponse {
  content?: unknown
  sha?: unknown
}

interface GitHubPullRequest {
  html_url?: unknown
}

interface GitHubCommitResponse {
  tree?: { sha?: unknown }
}

interface GitHubBlobResponse {
  sha?: unknown
}

interface GitHubTreeResponse {
  sha?: unknown
}

interface GitHubCommitCreateResponse {
  sha?: unknown
}

export interface CatalogSyncService {
  resolve(
    repository: string,
    defaultBranch: string,
    repositoryUpdatedAt: string | undefined,
    analyzeLocal: () => Promise<CatalogRepositoryAnalysis>,
    onRemoteProgress?: (message: string) => void,
  ): Promise<CatalogRepositoryAnalysis>
  flushPending(): Promise<{ submitted: number; pullRequestUrl?: string; message: string }>
}

function apiUrl(path: string): string {
  return `${GITHUB_API_ROOT}${path}`
}

function repositoryPath(repository: string): string {
  const normalized = repository.trim().toLowerCase()
  const encoded = normalized.replace(/[^a-z0-9._-]+/g, '__')
  return `${CATALOG_DIRECTORY}/${encoded}.json`
}

function pendingFilePath(pendingDir: string, repository: string): string {
  const normalized = repository.trim().toLowerCase()
  const encoded = normalized.replace(/[^a-z0-9._-]+/g, '__')
  return path.join(pendingDir, `${encoded}.json`)
}

function branchName(repository: string): string {
  const normalized = repository.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-')
  return `catalog-sync/${normalized}`.slice(0, 220)
}

function isCatalogKind(value: unknown): value is CatalogRepositoryAnalysis['kind'] {
  return value === 'plugin'
    || value === 'skill'
    || value === 'application'
    || value === 'preset'
    || value === 'hybrid'
    || value === 'dsh'
    || value === 'invalid'
}

function isAnalysis(value: unknown, repository: string, defaultBranch: string): value is CatalogRepositoryAnalysis {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<CatalogRepositoryAnalysis>
  return typeof candidate.repository === 'string'
    && candidate.repository.toLowerCase() === repository.toLowerCase()
    && candidate.defaultBranch === defaultBranch
    && isCatalogKind(candidate.kind)
    && Array.isArray(candidate.componentKinds)
    && typeof candidate.summary === 'string'
    && Array.isArray(candidate.warnings)
}

function decodeContent(content: string): string {
  return Buffer.from(content.replace(/\s/g, ''), 'base64').toString('utf8')
}

function encodeContent(value: unknown): string {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8').toString('base64')
}

function stripSync(analysis: CatalogRepositoryAnalysis): CatalogRepositoryAnalysis {
  const { sync: _sync, ...persisted } = analysis
  return persisted
}

function isFresh(remoteUpdatedAt: string | null, currentUpdatedAt: string | undefined): boolean {
  if (!currentUpdatedAt) return true
  if (!remoteUpdatedAt) return false
  const remote = Date.parse(remoteUpdatedAt)
  const current = Date.parse(currentUpdatedAt)
  if (!Number.isFinite(remote)) return false
  return !Number.isFinite(current) || remote >= current
}

async function readResponseJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

function errorDetail(value: unknown): string {
  if (value && typeof value === 'object' && typeof (value as { message?: unknown }).message === 'string') {
    return (value as { message: string }).message
  }
  return 'GitHub 请求失败。'
}

export function createCatalogSyncService(options: {
  fetchImpl: typeof fetch
  getAuthStatus: () => Promise<{ authenticated: boolean; login: string | null }>
  /** 本地批量检测待提交目录。未传入时保留旧的即时发布行为，便于独立调用方兼容。 */
  pendingDir?: string
  onFlush?: (result: { submitted: number; pullRequestUrl?: string; message: string }) => void
}): CatalogSyncService {
  const fetchImpl = options.fetchImpl
  const pendingDir = options.pendingDir ? path.resolve(options.pendingDir) : null
  let pendingFlush: Promise<{ submitted: number; pullRequestUrl?: string; message: string }> | null = null
  let publishQueue: Promise<void> = Promise.resolve()

  const enqueuePublish = <T>(task: () => Promise<T>): Promise<T> => {
    const result = publishQueue.then(task, task)
    publishQueue = result.then(() => undefined, () => undefined)
    return result
  }

  const request = async (url: string, init?: RequestInit): Promise<{ response: Response; body: unknown }> => {
    const response = await fetchImpl(url, {
      ...init,
      headers: {
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'DSH-Launcher',
        'X-GitHub-Api-Version': '2022-11-28',
        ...init?.headers,
      },
    })
    return { response, body: await readResponseJson(response) }
  }

  const buildRecord = (
    repository: string,
    defaultBranch: string,
    repositoryUpdatedAt: string | undefined,
    analysis: CatalogRepositoryAnalysis,
    submittedBy: string | null,
  ): CatalogRecord => ({
    schemaVersion: RECORD_VERSION,
    repository,
    defaultBranch,
    repositoryUpdatedAt: repositoryUpdatedAt ?? null,
    analyzedAt: new Date().toISOString(),
    submittedBy,
    analysis: stripSync(analysis),
  })

  const sameRecordContent = (left: CatalogRecord, right: CatalogRecord): boolean => (
    left.repository.toLowerCase() === right.repository.toLowerCase()
    && left.defaultBranch === right.defaultBranch
    && left.repositoryUpdatedAt === right.repositoryUpdatedAt
    && JSON.stringify(left.analysis) === JSON.stringify(right.analysis)
  )

  const queueRecord = async (record: CatalogRecord): Promise<boolean> => {
    if (!pendingDir) return false
    await mkdir(pendingDir, { recursive: true })
    const filePath = pendingFilePath(pendingDir, record.repository)
    try {
      const existing = JSON.parse(await readFile(filePath, 'utf8')) as CatalogRecord
      if (sameRecordContent(existing, record)) return false
    } catch { /* first result or an incomplete previous file */ }
    await writeFile(filePath, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
    return true
  }

  const readPending = async (): Promise<Array<{ record: CatalogRecord; filePath: string }>> => {
    if (!pendingDir) return []
    let entries
    try { entries = await readdir(pendingDir, { withFileTypes: true }) } catch { return [] }
    const result: Array<{ record: CatalogRecord; filePath: string }> = []
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.json')) continue
      const filePath = path.join(pendingDir, entry.name)
      try {
        const value = JSON.parse(await readFile(filePath, 'utf8')) as Partial<CatalogRecord>
        if (value.schemaVersion !== RECORD_VERSION
          || typeof value.repository !== 'string'
          || typeof value.defaultBranch !== 'string'
          || !isAnalysis(value.analysis, value.repository, value.defaultBranch)) continue
        result.push({ record: value as CatalogRecord, filePath })
      } catch { /* leave malformed files for manual inspection */ }
    }
    return result.sort((left, right) => left.record.repository.localeCompare(right.record.repository))
  }

  const readRemote = async (
    repository: string,
    defaultBranch: string,
  ): Promise<{ analysis: CatalogRepositoryAnalysis; repositoryUpdatedAt: string | null } | null> => {
    const path = repositoryPath(repository)
    const { response, body } = await request(apiUrl(`/repos/${LAUNCHER_REPOSITORY}/contents/${path}?ref=${CATALOG_BRANCH}`))
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`共享检测目录读取失败（HTTP ${response.status}）：${errorDetail(body)}`)
    const content = body && typeof body === 'object' ? (body as GitHubContentResponse).content : undefined
    if (typeof content !== 'string') throw new Error('共享检测目录文件内容无效。')
    let record: Partial<CatalogRecord>
    try {
      record = JSON.parse(decodeContent(content)) as Partial<CatalogRecord>
    } catch {
      throw new Error('共享检测目录文件不是有效 JSON。')
    }
    if (record.schemaVersion !== RECORD_VERSION
      || typeof record.repository !== 'string'
      || record.repository.toLowerCase() !== repository.toLowerCase()
      || record.defaultBranch !== defaultBranch
      || !isAnalysis(record.analysis, repository, defaultBranch)) {
      throw new Error('共享检测目录文件校验失败。')
    }
    return {
      analysis: record.analysis,
      repositoryUpdatedAt: typeof record.repositoryUpdatedAt === 'string' ? record.repositoryUpdatedAt : null,
    }
  }

  const ensureFork = async (login: string): Promise<{ owner: string; name: string; defaultBranch: string }> => {
    const [, upstreamName] = LAUNCHER_REPOSITORY.split('/')
    const forkPath = `/repos/${login}/${upstreamName}`
    let result = await request(apiUrl(forkPath))
    if (result.response.status === 404) {
      result = await request(apiUrl(`/repos/${LAUNCHER_REPOSITORY}/forks`), { method: 'POST', body: JSON.stringify({}) })
      if (!result.response.ok && result.response.status !== 202) {
        throw new Error(`无法创建 GitHub fork（HTTP ${result.response.status}）：${errorDetail(result.body)}`)
      }
      for (let attempt = 0; attempt < 8; attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 350))
        result = await request(apiUrl(forkPath))
        if (result.response.ok) break
      }
    }
    if (!result.response.ok || !result.body || typeof result.body !== 'object') {
      throw new Error(`无法访问 GitHub fork（HTTP ${result.response.status}）。`)
    }
    const body = result.body as GitHubRepositoryResponse
    if (typeof body.parent?.full_name !== 'string'
      || body.parent.full_name.toLowerCase() !== LAUNCHER_REPOSITORY.toLowerCase()) {
      throw new Error(`GitHub 仓库 ${login}/${upstreamName} 不是共享目录仓库的 fork，已停止提交以免覆盖其它项目。`)
    }
    const defaultBranch = typeof body.default_branch === 'string' && body.default_branch ? body.default_branch : CATALOG_BRANCH
    return { owner: login, name: upstreamName!, defaultBranch }
  }

  const publish = async (
    repository: string,
    defaultBranch: string,
    repositoryUpdatedAt: string | undefined,
    analysis: CatalogRepositoryAnalysis,
  ): Promise<CatalogSyncInfo> => {
    const auth = await options.getAuthStatus()
    if (!auth.authenticated || !auth.login) {
      return { source: 'local', state: 'not-authenticated', message: '检测完成；登录 GitHub 后会自动提交共享检测结果。' }
    }

    const upstream = await request(apiUrl(`/repos/${LAUNCHER_REPOSITORY}`))
    if (!upstream.response.ok || !upstream.body || typeof upstream.body !== 'object') {
      throw new Error(`共享检测目录仓库不可用（HTTP ${upstream.response.status}）。`)
    }
    const upstreamBody = upstream.body as GitHubRepositoryResponse
    const upstreamBranch = typeof upstreamBody.default_branch === 'string' && upstreamBody.default_branch
      ? upstreamBody.default_branch
      : CATALOG_BRANCH
    const [upstreamOwner] = LAUNCHER_REPOSITORY.split('/')
    const target = auth.login.toLowerCase() === upstreamOwner?.toLowerCase()
      ? { owner: upstreamOwner!, name: LAUNCHER_REPOSITORY.split('/')[1]!, defaultBranch: upstreamBranch }
      : await ensureFork(auth.login)
    const targetRepository = `${target.owner}/${target.name}`
    const refPath = `/repos/${targetRepository}/git/ref/heads/${encodeURIComponent(branchName(repository))}`
    const baseRef = await request(apiUrl(`/repos/${LAUNCHER_REPOSITORY}/git/ref/heads/${encodeURIComponent(upstreamBranch)}`))
    if (!baseRef.response.ok || !baseRef.body || typeof baseRef.body !== 'object') {
      throw new Error(`共享检测目录基线分支不可用（HTTP ${baseRef.response.status}）。`)
    }
    const baseSha = (baseRef.body as GitHubRefResponse).object?.sha
    if (typeof baseSha !== 'string' || !baseSha) throw new Error('GitHub 没有返回共享目录基线版本。')

    let ref = await request(apiUrl(refPath))
    if (ref.response.status === 404) {
      ref = await request(apiUrl(`/repos/${targetRepository}/git/refs`), {
        method: 'POST',
        body: JSON.stringify({ ref: `refs/heads/${branchName(repository)}`, sha: baseSha }),
      })
    }
    if (!ref.response.ok && ref.response.status !== 201) {
      throw new Error(`无法创建共享检测分支（HTTP ${ref.response.status}）：${errorDetail(ref.body)}`)
    }

    const filePath = repositoryPath(repository)
    const fileUrl = apiUrl(`/repos/${targetRepository}/contents/${filePath}`)
    const existing = await request(`${fileUrl}?ref=${encodeURIComponent(branchName(repository))}`)
    if (!existing.response.ok && existing.response.status !== 404) {
      throw new Error(`无法读取共享检测分支文件（HTTP ${existing.response.status}）：${errorDetail(existing.body)}`)
    }
    const existingSha = existing.response.ok && existing.body && typeof existing.body === 'object'
      ? (existing.body as GitHubContentResponse).sha
      : undefined
    const record = buildRecord(repository, defaultBranch, repositoryUpdatedAt, analysis, auth.login)
    const update = await request(fileUrl, {
      method: 'PUT',
      body: JSON.stringify({
        message: `catalog: update ${repository}`,
        content: encodeContent(record),
        branch: branchName(repository),
        ...(typeof existingSha === 'string' && existingSha ? { sha: existingSha } : {}),
      }),
    })
    if (!update.response.ok) throw new Error(`共享检测结果提交失败（HTTP ${update.response.status}）：${errorDetail(update.body)}`)

    const pullQuery = new URLSearchParams({ head: `${target.owner}:${branchName(repository)}`, base: upstreamBranch, state: 'open', per_page: '1' })
    const pulls = await request(apiUrl(`/repos/${LAUNCHER_REPOSITORY}/pulls?${pullQuery.toString()}`))
    if (!pulls.response.ok) {
      throw new Error(`无法查询共享检测 PR（HTTP ${pulls.response.status}）：${errorDetail(pulls.body)}`)
    }
    let pullRequestUrl: string | undefined
    if (Array.isArray(pulls.body) && pulls.body.length > 0) {
      const first = pulls.body[0] as GitHubPullRequest
      if (typeof first.html_url === 'string') pullRequestUrl = first.html_url
    } else {
      const created = await request(apiUrl(`/repos/${LAUNCHER_REPOSITORY}/pulls`), {
        method: 'POST',
        body: JSON.stringify({
          title: `catalog: ${repository}`,
          head: `${target.owner}:${branchName(repository)}`,
          base: upstreamBranch,
          body: `由 DSH Melody Launcher 自动提交的检测结果。\n\n- 仓库：${repository}\n- 分支：${defaultBranch}\n- 提交者：@${auth.login}`,
        }),
      })
      if (!created.response.ok) throw new Error(`共享检测 PR 创建失败（HTTP ${created.response.status}）：${errorDetail(created.body)}`)
      const pull = created.body as GitHubPullRequest
      if (typeof pull.html_url === 'string') pullRequestUrl = pull.html_url
    }
    return {
      source: 'local',
      state: 'published',
      message: pullRequestUrl ? '检测完成，结果已提交到 GitHub，等待合并。' : '检测完成，结果已提交到 GitHub。',
      pullRequestUrl,
    }
  }

  const publishBatch = async (
    entries: Array<{ record: CatalogRecord; filePath: string }>,
  ): Promise<{ submitted: number; pullRequestUrl?: string; message: string }> => {
    const auth = await options.getAuthStatus()
    if (!auth.authenticated || !auth.login) {
      return { submitted: 0, message: '未登录 GitHub，检测结果暂存在本地待提交目录。' }
    }

    const upstream = await request(apiUrl(`/repos/${LAUNCHER_REPOSITORY}`))
    if (!upstream.response.ok || !upstream.body || typeof upstream.body !== 'object') {
      throw new Error(`共享检测目录仓库不可用（HTTP ${upstream.response.status}）。`)
    }
    const upstreamBody = upstream.body as GitHubRepositoryResponse
    const upstreamBranch = typeof upstreamBody.default_branch === 'string' && upstreamBody.default_branch
      ? upstreamBody.default_branch
      : CATALOG_BRANCH
    const [upstreamOwner] = LAUNCHER_REPOSITORY.split('/')
    const target = auth.login.toLowerCase() === upstreamOwner?.toLowerCase()
      ? { owner: upstreamOwner!, name: LAUNCHER_REPOSITORY.split('/')[1]!, defaultBranch: upstreamBranch }
      : await ensureFork(auth.login)
    const targetRepository = `${target.owner}/${target.name}`
    const baseRef = await request(apiUrl(`/repos/${LAUNCHER_REPOSITORY}/git/ref/heads/${encodeURIComponent(upstreamBranch)}`))
    if (!baseRef.response.ok || !baseRef.body || typeof baseRef.body !== 'object') {
      throw new Error(`共享检测目录基线分支不可用（HTTP ${baseRef.response.status}）。`)
    }
    const baseSha = (baseRef.body as GitHubRefResponse).object?.sha
    if (typeof baseSha !== 'string' || !baseSha) throw new Error('GitHub 没有返回共享目录基线版本。')

    const refPath = `/repos/${targetRepository}/git/ref/heads/${encodeURIComponent(BATCH_BRANCH)}`
    let ref = await request(apiUrl(refPath))
    if (ref.response.status === 404) {
      ref = await request(apiUrl(`/repos/${targetRepository}/git/refs`), {
        method: 'POST',
        body: JSON.stringify({ ref: `refs/heads/${BATCH_BRANCH}`, sha: baseSha }),
      })
    }
    if (!ref.response.ok && ref.response.status !== 201) {
      throw new Error(`无法创建共享检测批量分支（HTTP ${ref.response.status}）：${errorDetail(ref.body)}`)
    }
    const branchSha = ref.body && typeof ref.body === 'object' ? (ref.body as GitHubRefResponse).object?.sha : undefined
    if (typeof branchSha !== 'string' || !branchSha) throw new Error('GitHub 没有返回批量分支版本。')

    const commitResponse = await request(apiUrl(`/repos/${targetRepository}/git/commits/${encodeURIComponent(branchSha)}`))
    const treeSha = commitResponse.body && typeof commitResponse.body === 'object'
      ? (commitResponse.body as GitHubCommitResponse).tree?.sha
      : undefined
    if (!commitResponse.response.ok || typeof treeSha !== 'string' || !treeSha) {
      throw new Error(`无法读取共享检测批量分支树（HTTP ${commitResponse.response.status}）。`)
    }

    const treeEntries: Array<{ path: string; mode: '100644'; type: 'blob'; sha: string }> = []
    for (const entry of entries) {
      const blob = await request(apiUrl(`/repos/${targetRepository}/git/blobs`), {
        method: 'POST',
        body: JSON.stringify({ content: encodeContent(entry.record), encoding: 'base64' }),
      })
      const sha = blob.body && typeof blob.body === 'object' ? (blob.body as GitHubBlobResponse).sha : undefined
      if (!blob.response.ok || typeof sha !== 'string' || !sha) {
        throw new Error(`共享检测结果上传失败（HTTP ${blob.response.status}）：${errorDetail(blob.body)}`)
      }
      treeEntries.push({ path: repositoryPath(entry.record.repository), mode: '100644', type: 'blob', sha })
    }

    const tree = await request(apiUrl(`/repos/${targetRepository}/git/trees`), {
      method: 'POST',
      body: JSON.stringify({ base_tree: treeSha, tree: treeEntries }),
    })
    const newTreeSha = tree.body && typeof tree.body === 'object' ? (tree.body as GitHubTreeResponse).sha : undefined
    if (!tree.response.ok || typeof newTreeSha !== 'string' || !newTreeSha) {
      throw new Error(`共享检测批量目录树创建失败（HTTP ${tree.response.status}）：${errorDetail(tree.body)}`)
    }

    const commit = await request(apiUrl(`/repos/${targetRepository}/git/commits`), {
      method: 'POST',
      body: JSON.stringify({
        message: `catalog: batch update (${entries.length} repositories)`,
        tree: newTreeSha,
        parents: [branchSha],
      }),
    })
    const newCommitSha = commit.body && typeof commit.body === 'object' ? (commit.body as GitHubCommitCreateResponse).sha : undefined
    if (!commit.response.ok || typeof newCommitSha !== 'string' || !newCommitSha) {
      throw new Error(`共享检测批量提交创建失败（HTTP ${commit.response.status}）：${errorDetail(commit.body)}`)
    }
    const updateRef = await request(apiUrl(`/repos/${targetRepository}/git/refs/heads/${encodeURIComponent(BATCH_BRANCH)}`), {
      method: 'PATCH',
      body: JSON.stringify({ sha: newCommitSha, force: false }),
    })
    if (!updateRef.response.ok) throw new Error(`共享检测批量分支更新失败（HTTP ${updateRef.response.status}）：${errorDetail(updateRef.body)}`)

    const pullQuery = new URLSearchParams({ head: `${target.owner}:${BATCH_BRANCH}`, base: upstreamBranch, state: 'open', per_page: '1' })
    const pulls = await request(apiUrl(`/repos/${LAUNCHER_REPOSITORY}/pulls?${pullQuery.toString()}`))
    if (!pulls.response.ok) throw new Error(`无法查询共享检测批量 PR（HTTP ${pulls.response.status}）：${errorDetail(pulls.body)}`)
    let pullRequestUrl: string | undefined
    if (Array.isArray(pulls.body) && pulls.body.length > 0) {
      const first = pulls.body[0] as GitHubPullRequest
      if (typeof first.html_url === 'string') pullRequestUrl = first.html_url
    } else {
      const created = await request(apiUrl(`/repos/${LAUNCHER_REPOSITORY}/pulls`), {
        method: 'POST',
        body: JSON.stringify({
          title: `catalog: batch update (${entries.length})`,
          head: `${target.owner}:${BATCH_BRANCH}`,
          base: upstreamBranch,
          body: `由 DSH Melody Launcher 自动批量提交的检测结果。\n\n- 仓库数量：${entries.length}\n- 提交者：@${auth.login}`,
        }),
      })
      if (!created.response.ok) throw new Error(`共享检测批量 PR 创建失败（HTTP ${created.response.status}）：${errorDetail(created.body)}`)
      const pull = created.body as GitHubPullRequest
      if (typeof pull.html_url === 'string') pullRequestUrl = pull.html_url
    }

    await Promise.all(entries.map(entry => rm(entry.filePath, { force: true })))
    return {
      submitted: entries.length,
      pullRequestUrl,
      message: pullRequestUrl
        ? `已将 ${entries.length} 条检测结果合并为一次提交，并提交批量 PR。`
        : `已将 ${entries.length} 条检测结果合并为一次提交。`,
    }
  }

  return {
    async resolve(repository, defaultBranch, repositoryUpdatedAt, analyzeLocal, onRemoteProgress) {
      let remote: Awaited<ReturnType<typeof readRemote>> = null
      onRemoteProgress?.('正在读取 GitHub 共享检测结果')
      try {
        remote = await readRemote(repository, defaultBranch)
      } catch { /* 共享目录不可用时继续走本地检测。 */ }
      if (remote && isFresh(remote.repositoryUpdatedAt, repositoryUpdatedAt)) {
        if (pendingDir) await rm(pendingFilePath(pendingDir, repository), { force: true }).catch(() => undefined)
        return {
          ...remote.analysis,
          sync: {
            source: 'github',
            state: 'remote',
            message: '已使用 GitHub 共享检测结果。',
          },
        }
      }

      let local: CatalogRepositoryAnalysis
      try {
        local = await analyzeLocal()
      } catch (error) {
        if (remote) {
          return {
            ...remote.analysis,
            sync: {
              source: 'github',
              state: 'stale-fallback',
              message: '本地重新检测失败，暂时使用 GitHub 上的上一份结果。',
            },
          }
        }
        throw error
      }

      try {
        if (pendingDir) {
          const auth = await options.getAuthStatus()
          const record = buildRecord(repository, defaultBranch, repositoryUpdatedAt, local, auth.login)
          const changed = await queueRecord(record)
          return {
            ...local,
            sync: {
              source: 'local',
              state: 'queued',
              message: changed ? '检测结果已保存到本地，启动 DSH 时会批量提交。' : '检测结果未变化，已保留本地批量提交队列。',
            },
          }
        }
        const sync = await enqueuePublish(() => publish(repository, defaultBranch, repositoryUpdatedAt, local))
        return { ...local, sync }
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        return {
          ...local,
          sync: {
            source: 'local',
            state: 'unavailable',
            message: `检测完成，但共享结果提交失败：${detail}`,
          },
        }
      }
    },
    async flushPending() {
      if (pendingFlush) return pendingFlush
      pendingFlush = (async () => {
      const entries = await readPending()
      if (!pendingDir || entries.length === 0) return { submitted: 0, message: '没有新的共享检测结果需要提交。' }
      return enqueuePublish(() => publishBatch(entries))
        .catch(error => ({
          submitted: 0,
          message: `共享检测批量提交失败，结果仍保存在本地：${error instanceof Error ? error.message : String(error)}`,
        }))
      })()
      try {
        const result = await pendingFlush
        if (result.submitted > 0 || result.message.includes('失败')) options.onFlush?.(result)
        return result
      } finally {
        pendingFlush = null
      }
    },
  }
}

export { CATALOG_BRANCH, CATALOG_DIRECTORY, LAUNCHER_REPOSITORY, repositoryPath }
