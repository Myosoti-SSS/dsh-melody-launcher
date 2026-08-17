import { describe, expect, it, vi } from 'vitest'
import {
  APPLICATION_MANIFEST_PATH,
  analyzeApplicationRepository,
  applicationTargetFromManifest,
  DSH_DESKTOP_PACKAGE,
  DSH_DESKTOP_REPOSITORY,
} from '../electron/application-catalog'

const commit = 'a'.repeat(40)

function response(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function repositoryFetch(repository: string, manifest: unknown | null): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    if (url.includes(`/repos/${repository}/commits/`)) return response({ sha: commit })
    if (url.includes(`/${commit}/${APPLICATION_MANIFEST_PATH}`)) {
      return manifest == null ? response({ message: 'not found' }, 404) : response(manifest)
    }
    return response({ message: 'not found' }, 404)
  }) as typeof fetch
}

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    id: 'demo-host',
    name: 'Demo Host',
    description: 'A managed DSH host.',
    type: 'application',
    launchMode: 'after-runtime',
    install: { provider: 'npm', package: '@demo/dsh-host', version: '1.2.3' },
    launch: { bin: 'dsh-host', args: ['--quiet'] },
    platforms: ['win32', 'darwin', 'linux'],
    provides: ['demoRuntime'],
    ...overrides,
  }
}

describe('application addon catalog', () => {
  it('recognizes DSH Desktop as a replacement host without network access', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    const analysis = await analyzeApplicationRepository(DSH_DESKTOP_REPOSITORY, 'main', fetchImpl)

    expect(fetchImpl).not.toHaveBeenCalled()
    expect(analysis.installability).toBe('ready')
    expect(analysis.targets[0]).toMatchObject({
      packageName: DSH_DESKTOP_PACKAGE,
      launchMode: 'runtime-replacement',
      verified: true,
    })
  })

  it('loads and validates the generic addon manifest', async () => {
    const analysis = await analyzeApplicationRepository(
      'demo/dsh-host',
      'main',
      repositoryFetch('demo/dsh-host', manifest()),
      'win32',
    )

    expect(analysis.installability).toBe('ready')
    expect(analysis.targets[0]).toMatchObject({
      addonId: 'demo-host',
      packageName: '@demo/dsh-host',
      launchMode: 'after-runtime',
      launchArgs: ['--quiet'],
      supported: true,
    })
  })

  it('treats a missing manifest as a fully checked non-addon repository', async () => {
    const analysis = await analyzeApplicationRepository(
      'demo/plugin-only',
      'main',
      repositoryFetch('demo/plugin-only', null),
    )
    expect(analysis.installability).toBe('invalid')
    expect(analysis.targets).toEqual([])
  })

  it('keeps platform incompatibility distinct from an invalid manifest', () => {
    const target = applicationTargetFromManifest(
      'demo/windows-host',
      manifest({ platforms: ['win32'] }),
      'linux',
    )
    expect(target.supported).toBe(false)
    expect(() => applicationTargetFromManifest(
      'demo/unsafe-host',
      manifest({ launch: { bin: '../escape' } }),
      'win32',
    )).toThrow(/启动入口无效/)
  })
})
