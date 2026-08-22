import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import AdmZip from 'adm-zip'
import { afterEach, describe, expect, it } from 'vitest'
import { analyzeNonstandardPackRepository } from '../electron/nonstandard-pack'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
}

describe('nonstandard pack repository analysis', () => {
  it('识别 bundles.json、手动组件和仓库内 Bundle', async () => {
    const archive = new AdmZip()
    const root = 'owner-pack-main/'
    archive.addFile(`${root}package.json`, Buffer.from(JSON.stringify({ name: '@oh-dsh/desktop', description: 'test pack', dependencies: { '@deepseek-ai/dsh': '0.1.0-rc.6' } })))
    archive.addFile(`${root}dsh-source.json`, Buffer.from(JSON.stringify({ version: '0.1.0-rc.5' })))
    archive.addFile(`${root}config/bundles.json`, Buffer.from(JSON.stringify({
      core: [{ id: 'demo-plugin', pkg: 'owner/demo-plugin', source: 'github', profile: ['web'] }],
      optional: [{ id: 'browser', pkg: 'owner/browser', source: 'github', install: 'manual' }],
      presets: [{ id: 'router-standard' }],
    })))
    archive.addFile(`${root}plugins/local-plugin/package.json`, Buffer.from(JSON.stringify({ name: 'dsh-local-plugin', version: '1.0.0', dsh: { bundle: { patch: 'bundle.json' } } })))
    archive.addFile(`${root}plugins/local-plugin/bundle.json`, Buffer.from('{}'))
    const buffer = archive.toBuffer()
    const rootPath = await mkdtemp(path.join(process.cwd(), 'nonstandard-test-'))
    temporaryRoots.push(rootPath)
    const fetchImpl = async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input)
      if (url.includes('/repos/owner/pack')) return response({ default_branch: 'main' })
      if (url.includes('/commits/main')) return response({ sha: 'a'.repeat(40) })
      if (url.includes('codeload.github.com/owner/pack')) return new Response(new Uint8Array(buffer))
      if (url.includes('registry.npmjs.org')) return response({ 'dist-tags': { latest: '1.0.0' } })
      return response({}, 404)
    }
    const preview = await analyzeNonstandardPackRepository({
      githubAuth: { fetch: fetchImpl } as never,
      installer: { analyzePlugin: async () => ({ targets: [] }), analyzeSkill: async () => ({ targets: [] }) } as never,
      dshMarket: { load: async () => ({ updated: '', count: 0, categories: {}, plugins: [] }) },
      profiles: {} as never,
      readSettings: async () => ({}) as never,
      pluginReceiptsPath: path.join(rootPath, 'receipts.json'),
      pluginSourceRoot: rootPath,
    }, 'https://github.com/owner/pack')
    expect(preview.kind).toBe('distribution')
    expect(preview.dshVersion).toBe('0.1.0-rc.6')
    expect(preview.warnings).toHaveLength(1)
    expect(preview.plugins.some(plugin => plugin.packageName === 'dsh-local-plugin' && plugin.source === 'local')).toBe(true)
    expect(preview.skipped.some(item => item.name === 'browser')).toBe(true)
    expect(preview.skipped.some(item => item.name === 'router-standard')).toBe(true)
  })
})
