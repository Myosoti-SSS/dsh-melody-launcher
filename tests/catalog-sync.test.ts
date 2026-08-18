import { mkdtemp, readdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { CatalogRepositoryAnalysis } from '../src/types'
import { createCatalogSyncService, repositoryPath } from '../electron/catalog-sync'

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function analysis(repository = 'demo/example'): CatalogRepositoryAnalysis {
  return {
    repository,
    defaultBranch: 'main',
    kind: 'plugin',
    componentKinds: ['plugin'],
    summary: '检测到一个 Plugin。',
    pluginAnalysis: {
      repository,
      defaultBranch: 'main',
      installability: 'ready',
      summary: 'ready',
      targets: [],
    },
    skillAnalysis: null,
    applicationAnalysis: null,
    warnings: [],
  }
}

function remoteRecord(repositoryUpdatedAt: string): string {
  return Buffer.from(JSON.stringify({
    schemaVersion: 1,
    repository: 'demo/example',
    defaultBranch: 'main',
    repositoryUpdatedAt,
    analyzedAt: '2026-08-18T00:01:00.000Z',
    submittedBy: 'reviewer',
    analysis: analysis(),
  })).toString('base64')
}

describe('GitHub shared catalog analysis', () => {
  it('uses a merged fresh record before running local analysis', async () => {
    const fetchImpl = vi.fn(async () => json({ content: remoteRecord('2026-08-18T00:00:00.000Z') })) as unknown as typeof fetch
    const analyzeLocal = vi.fn(async () => analysis())
    const service = createCatalogSyncService({
      fetchImpl,
      getAuthStatus: async () => ({ authenticated: false, login: null }),
    })

    const result = await service.resolve(
      'demo/example',
      'main',
      '2026-08-17T00:00:00.000Z',
      analyzeLocal,
    )

    expect(result.sync).toMatchObject({ source: 'github', state: 'remote' })
    expect(analyzeLocal).not.toHaveBeenCalled()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('rescans a stale record and keeps working when the user is signed out', async () => {
    const fetchImpl = vi.fn(async () => json({ content: remoteRecord('2026-08-16T00:00:00.000Z') })) as unknown as typeof fetch
    const analyzeLocal = vi.fn(async () => analysis())
    const service = createCatalogSyncService({
      fetchImpl,
      getAuthStatus: async () => ({ authenticated: false, login: null }),
    })

    const result = await service.resolve(
      'demo/example',
      'main',
      '2026-08-18T00:00:00.000Z',
      analyzeLocal,
    )

    expect(analyzeLocal).toHaveBeenCalledOnce()
    expect(result.sync).toMatchObject({ source: 'local', state: 'not-authenticated' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('submits a missing record through the user fork and opens a pull request', async () => {
    let uploaded: Record<string, unknown> | null = null
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const method = init?.method ?? 'GET'
      if (url.includes(`/contents/${repositoryPath('demo/example')}?ref=main`) && url.includes('/rirko/')) return json({}, 404)
      if (url.endsWith('/repos/rirko/dsh-melody-launcher')) return json({ default_branch: 'main' })
      if (url.endsWith('/repos/contributor/dsh-melody-launcher')) return json({ default_branch: 'main', parent: { full_name: 'rirko/dsh-melody-launcher' } })
      if (url.includes('/repos/rirko/dsh-melody-launcher/git/ref/heads/main')) return json({ object: { sha: 'a'.repeat(40) } })
      if (url.includes('/repos/contributor/dsh-melody-launcher/git/ref/heads/catalog-sync%2Fdemo-example')) return json({}, 404)
      if (url.endsWith('/repos/contributor/dsh-melody-launcher/git/refs') && method === 'POST') return json({ ref: 'ok' }, 201)
      if (url.includes('/repos/contributor/dsh-melody-launcher/contents/') && method === 'GET') return json({}, 404)
      if (url.includes('/repos/contributor/dsh-melody-launcher/contents/') && method === 'PUT') {
        uploaded = JSON.parse(String(init?.body)) as Record<string, unknown>
        return json({ content: { sha: 'b'.repeat(40) } }, 201)
      }
      if (url.includes('/repos/rirko/dsh-melody-launcher/pulls?')) return json([])
      if (url.endsWith('/repos/rirko/dsh-melody-launcher/pulls') && method === 'POST') {
        return json({ html_url: 'https://github.com/rirko/dsh-melody-launcher/pull/99' }, 201)
      }
      throw new Error(`unexpected request: ${method} ${url}`)
    }) as unknown as typeof fetch
    const service = createCatalogSyncService({
      fetchImpl,
      getAuthStatus: async () => ({ authenticated: true, login: 'contributor' }),
    })

    const result = await service.resolve(
      'demo/example',
      'main',
      '2026-08-18T00:00:00.000Z',
      async () => analysis(),
    )

    expect(result.sync).toEqual({
      source: 'local',
      state: 'published',
      message: '检测完成，结果已提交到 GitHub，等待合并。',
      pullRequestUrl: 'https://github.com/rirko/dsh-melody-launcher/pull/99',
    })
    const uploadedBody = uploaded as unknown as Record<string, unknown>
    expect(uploadedBody).toMatchObject({
      message: 'catalog: update demo/example',
      branch: 'catalog-sync/demo-example',
    })
    const record = JSON.parse(Buffer.from(String(uploadedBody.content), 'base64').toString('utf8'))
    expect(record).toMatchObject({
      schemaVersion: 1,
      repository: 'demo/example',
      repositoryUpdatedAt: '2026-08-18T00:00:00.000Z',
      submittedBy: 'contributor',
    })
  })

  it('queues multiple detections locally and flushes them as one commit and PR', async () => {
    const pendingDir = await mkdtemp(path.join(os.tmpdir(), 'dsh-launcher-catalog-pending-'))
    try {
      let blobCount = 0
      let batchCommitCount = 0
      let batchPullCount = 0
      const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        const method = init?.method ?? 'GET'
        if (url.includes('/contents/catalog/analysis/') && !url.includes('catalog-sync')) return json({}, 404)
        if (url.endsWith('/repos/rirko/dsh-melody-launcher')) return json({ default_branch: 'main' })
        if (url.includes('/git/ref/heads/main')) return json({ object: { sha: 'a'.repeat(40) } })
        if (url.includes('/git/ref/heads/plugin-update') && method === 'GET') return json({}, 404)
        if (url.endsWith('/git/refs') && method === 'POST') return json({ object: { sha: 'b'.repeat(40) } }, 201)
        if (url.includes('/git/commits/b') && method === 'GET') return json({ tree: { sha: 'c'.repeat(40) } })
        if (url.endsWith('/git/blobs') && method === 'POST') return json({ sha: `blob-${++blobCount}` }, 201)
        if (url.endsWith('/git/trees') && method === 'POST') return json({ sha: 'd'.repeat(40) }, 201)
        if (url.endsWith('/git/commits') && method === 'POST') {
          batchCommitCount += 1
          return json({ sha: 'e'.repeat(40) }, 201)
        }
        if (url.includes('/git/refs/heads/plugin-update') && method === 'PATCH') return json({}, 200)
        if (url.includes('/pulls?') && method === 'GET') return json([])
        if (url.endsWith('/pulls') && method === 'POST') {
          batchPullCount += 1
          return json({ html_url: 'https://github.com/rirko/dsh-melody-launcher/pull/100' }, 201)
        }
        throw new Error(`unexpected request: ${method} ${url}`)
      }) as unknown as typeof fetch
      const service = createCatalogSyncService({
        fetchImpl,
        pendingDir,
        getAuthStatus: async () => ({ authenticated: true, login: 'rirko' }),
      })

      await expect(service.resolve('demo/example', 'main', '2026-08-18T00:00:00.000Z', async () => analysis())).resolves.toMatchObject({
        sync: { state: 'queued' },
      })
      await expect(service.resolve('demo/second', 'main', '2026-08-18T00:00:00.000Z', async () => analysis('demo/second'))).resolves.toMatchObject({
        sync: { state: 'queued' },
      })
      expect((await readdir(pendingDir)).filter(name => name.endsWith('.json'))).toHaveLength(2)

      const flushed = await service.flushPending()
      expect(flushed).toMatchObject({ submitted: 2, pullRequestUrl: 'https://github.com/rirko/dsh-melody-launcher/pull/100' })
      expect(batchCommitCount).toBe(1)
      expect(batchPullCount).toBe(1)
      expect((await readdir(pendingDir)).filter(name => name.endsWith('.json'))).toHaveLength(0)
    } finally {
      await rm(pendingDir, { recursive: true, force: true })
    }
  })
})
