import { describe, expect, it } from 'vitest'
import { analyzeRepository } from '../electron/plugin-catalog'

const commit = 'a'.repeat(40)

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function mockFetch(routes: Record<string, Response | (() => Response)>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const route = routes[url]
    if (!route) return json({ message: `No route for ${url}` }, 404)
    return typeof route === 'function' ? route() : route.clone()
  }) as typeof fetch
}

function commitUrl(repository: string): string {
  return `https://api.github.com/repos/${repository}/commits/main`
}

function treeUrl(repository: string): string {
  return `https://api.github.com/repos/${repository}/git/trees/${commit}?recursive=1`
}

function rawUrl(repository: string, filePath: string): string {
  return `https://raw.githubusercontent.com/${repository}/${commit}/${filePath}`
}

describe('repository plugin analysis', () => {
  it('prefers a verified npm release for a root bundle', async () => {
    const repository = 'demo/root-plugin'
    const manifest = {
      name: '@demo/root-plugin',
      version: '1.2.0',
      repository: `https://github.com/${repository}`,
      dsh: { bundle: { patch: './cordis.patch.yml' }, client: { platform: 'web' } },
      engines: { node: '>=22.19' },
    }
    const analysis = await analyzeRepository(repository, 'main', 'web', mockFetch({
      [commitUrl(repository)]: json({ sha: commit }),
      [rawUrl(repository, 'package.json')]: json(manifest),
      [treeUrl(repository)]: json({ tree: [
        { path: 'package.json', type: 'blob' },
        { path: 'cordis.patch.yml', type: 'blob' },
      ] }),
      ['https://registry.npmjs.org/%40demo%2Froot-plugin/latest']: json(manifest),
    }))

    expect(analysis.installability).toBe('ready')
    expect(analysis.targets[0]).toMatchObject({
      packageName: '@demo/root-plugin',
      source: 'npm',
      profileName: 'web',
      subdirectory: null,
    })
  })

  it('finds a private bundle in a repository subdirectory', async () => {
    const repository = 'demo/skin-collection'
    const analysis = await analyzeRepository(repository, 'main', 'web', mockFetch({
      [commitUrl(repository)]: json({ sha: commit }),
      [rawUrl(repository, 'package.json')]: json({}, 404),
      [treeUrl(repository)]: json({ tree: [
        { path: 'maid/package.json', type: 'blob' },
        { path: 'maid/cordis.patch.yml', type: 'blob' },
      ] }),
      [rawUrl(repository, 'maid/package.json')]: json({
        name: '@demo/maid-skin',
        version: '0.1.0',
        private: true,
        dsh: { bundle: { patch: './cordis.patch.yml' }, client: { platform: 'web' } },
      }),
    }))

    expect(analysis.installability).toBe('ready')
    expect(analysis.targets[0]).toMatchObject({
      source: 'archive-subdirectory',
      subdirectory: 'maid',
      profileName: 'web',
    })
  })

  it('deduplicates package names and ignores scaffold placeholders', async () => {
    const repository = 'demo/plugin-collection'
    const skinManifest = {
      name: '@demo/skin',
      version: '2.0.0',
      repository: `https://github.com/${repository}`,
      dsh: { bundle: { patch: './cordis.patch.yml' }, client: { platform: 'web' } },
    }
    const templateManifest = {
      name: '@demo/dsh-client-ui-__NAME__',
      version: '0.0.0',
      private: true,
      dsh: { bundle: { patch: './cordis.patch.yml' }, client: { platform: 'web' } },
    }
    const analysis = await analyzeRepository(repository, 'main', 'web', mockFetch({
      [commitUrl(repository)]: json({ sha: commit }),
      [rawUrl(repository, 'package.json')]: json({}, 404),
      [treeUrl(repository)]: json({ tree: [
        { path: 'packages/skin/package.json', type: 'blob' },
        { path: 'packages/skin/cordis.patch.yml', type: 'blob' },
        { path: 'legacy/packages/skin/package.json', type: 'blob' },
        { path: 'legacy/packages/skin/cordis.patch.yml', type: 'blob' },
        { path: 'scripts/plugin-template/package.json', type: 'blob' },
        { path: 'scripts/plugin-template/cordis.patch.yml', type: 'blob' },
      ] }),
      [rawUrl(repository, 'packages/skin/package.json')]: json(skinManifest),
      [rawUrl(repository, 'legacy/packages/skin/package.json')]: json(skinManifest),
      [rawUrl(repository, 'scripts/plugin-template/package.json')]: json(templateManifest),
      ['https://registry.npmjs.org/%40demo%2Fskin/latest']: json(skinManifest),
    }))

    expect(analysis.installability).toBe('ready')
    expect(analysis.targets).toHaveLength(1)
    expect(analysis.targets[0]).toMatchObject({
      packageName: '@demo/skin',
      source: 'npm',
      subdirectory: 'packages/skin',
    })
  })

  it('separates dynamic session plugins from persistent bundles', async () => {
    const repository = 'demo/dynamic-plugin'
    const analysis = await analyzeRepository(repository, 'main', 'web', mockFetch({
      [commitUrl(repository)]: json({ sha: commit }),
      [rawUrl(repository, 'package.json')]: json({
        name: 'dynamic-plugin',
        dsh: { type: 'dynamic-plugin', host: './host.js', client: './client.js' },
      }),
    }))

    expect(analysis.installability).toBe('dynamic')
    expect(analysis.targets).toEqual([])
  })

  it('rejects the full DeepSeek Harness workspace as a plugin', async () => {
    const repository = 'demo/harness-desktop'
    const analysis = await analyzeRepository(repository, 'main', 'web', mockFetch({
      [commitUrl(repository)]: json({ sha: commit }),
      [rawUrl(repository, 'package.json')]: json({
        name: '@deepseek-ai/dsh-root',
        private: true,
        workspaces: ['packages/*'],
      }),
    }))

    expect(analysis.installability).toBe('application')
    expect(analysis.targets).toEqual([])
  })

  it('falls back to a published root plugin when GitHub API quota is exhausted', async () => {
    const repository = 'demo/dsh-tui'
    const manifest = {
      name: '@demo/dsh-tui',
      version: '0.6.1',
      repository: `https://github.com/${repository}.git`,
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    }
    const analysis = await analyzeRepository(repository, 'main', 'web', mockFetch({
      [commitUrl(repository)]: json({ message: 'rate limited' }, 403),
      ['https://raw.githubusercontent.com/demo/dsh-tui/main/package.json']: json(manifest),
      ['https://registry.npmjs.org/%40demo%2Fdsh-tui/latest']: json(manifest),
    }))

    expect(analysis).toMatchObject({ installability: 'ready' })
    expect(analysis.targets[0]).toMatchObject({
      packageName: '@demo/dsh-tui',
      source: 'npm',
      profileName: 'cc-tui',
      commit: 'main',
    })
  })
})
