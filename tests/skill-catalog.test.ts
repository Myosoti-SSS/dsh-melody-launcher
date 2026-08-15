import AdmZip from 'adm-zip'
import { describe, expect, it } from 'vitest'
import { analyzeSkillRepository } from '../electron/skill-catalog'

function archiveResponse(files: Record<string, string>, root = 'skill-pack-main'): Response {
  const zip = new AdmZip()
  for (const [filePath, contents] of Object.entries(files)) {
    zip.addFile(`${root}/${filePath}`, Buffer.from(contents))
  }
  const archive = zip.toBuffer()
  return new Response(archive, {
    status: 200,
    headers: { 'content-length': String(archive.byteLength) },
  })
}

function mockFetch(response: Response, expectedUrl: string): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    expect(url).toBe(expectedUrl)
    return response.clone()
  }) as typeof fetch
}

describe('GitHub skill analysis', () => {
  it('finds multiple valid skill bundles and ignores ordinary markdown', async () => {
    const repository = 'demo/skill-pack'
    const analysis = await analyzeSkillRepository(repository, 'main', mockFetch(archiveResponse({
      'README.md': '# Readme',
      'academic/SKILL.md': '---\nname: academic\ndescription: Academic workflow.\n---\nBody',
      'skills/release/SKILL.md': '---\nname: release-check\ndescription: Release workflow.\n---\nBody',
    }), 'https://codeload.github.com/demo/skill-pack/zip/refs/heads/main'))

    expect(analysis.installability).toBe('choice')
    expect(analysis.targets.map(target => target.name)).toEqual(['academic', 'release-check'])
    expect(analysis.targets.every(target => target.format === 'bundle')).toBe(true)
    expect(analysis.targets.every(target => target.revision === 'main')).toBe(true)
  })

  it('marks a topic repository without valid frontmatter as invalid', async () => {
    const repository = 'demo/not-a-skill'
    const analysis = await analyzeSkillRepository(repository, 'main', mockFetch(archiveResponse({
      'README.md': '# Index',
      'SKILL.md': '# Missing frontmatter',
    }, 'not-a-skill-main'), 'https://codeload.github.com/demo/not-a-skill/zip/refs/heads/main'))

    expect(analysis.installability).toBe('invalid')
    expect(analysis.targets).toEqual([])
  })

  it('supports a flat markdown skill in the repository root', async () => {
    const repository = 'demo/flat-skill'
    const analysis = await analyzeSkillRepository(repository, 'feature/skills', mockFetch(archiveResponse({
      'quick-review.md': '---\nname: quick-review\ndescription: Review a change.\nuser-invocable: false\n---\nBody',
    }, 'flat-skill-feature-skills'), 'https://codeload.github.com/demo/flat-skill/zip/refs/heads/feature/skills'))

    expect(analysis.installability).toBe('ready')
    expect(analysis.targets[0]).toMatchObject({
      name: 'quick-review',
      format: 'flat',
      sourcePath: 'quick-review.md',
      revision: 'feature/skills',
      userInvocable: false,
    })
  })

  it('rejects an oversized archive before reading it', async () => {
    const response = new Response('small body', {
      status: 200,
      headers: { 'content-length': String(65 * 1024 * 1024) },
    })
    await expect(analyzeSkillRepository(
      'demo/too-large',
      'main',
      mockFetch(response, 'https://codeload.github.com/demo/too-large/zip/refs/heads/main'),
    )).rejects.toThrow('压缩包过大')
  })
})
