import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseSkillDocument, readInstalledSkills } from '../electron/skill-format'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('DSH skill format', () => {
  it('parses the official frontmatter and invocation policy', () => {
    expect(parseSkillDocument(`---
name: release-check
description: Verify a release before publishing.
disable-model-invocation: false
user-invocable: no
---
# Release check
`)).toMatchObject({
      name: 'release-check',
      description: 'Verify a release before publishing.',
      modelInvocable: true,
      userInvocable: false,
      content: '# Release check',
    })
  })

  it('rejects malformed skills rather than trusting the filename', () => {
    expect(parseSkillDocument('name: missing-frontmatter')).toBeNull()
    expect(parseSkillDocument('---\nname: NotKebab\ndescription: invalid\n---\n')).toBeNull()
    expect(parseSkillDocument('---\nname: valid-name\ndescription: ok\nuserInvocable: true\n---\n')).toBeNull()
  })

  it('discovers only valid one-level local skills', async () => {
    const dshHome = await mkdtemp(path.join(os.tmpdir(), 'dsh-skill-format-'))
    temporaryRoots.push(dshHome)
    await mkdir(path.join(dshHome, 'skills', 'bundle-skill'), { recursive: true })
    await writeFile(path.join(dshHome, 'skills', 'bundle-skill', 'SKILL.md'), '---\nname: bundle-skill\ndescription: Bundled instructions.\n---\nBody\n')
    await writeFile(path.join(dshHome, 'skills', 'flat-skill.md'), '---\nname: flat-skill\ndescription: Flat instructions.\n---\nBody\n')
    await writeFile(path.join(dshHome, 'skills', 'README.md'), '# Not a skill\n')

    const installed = await readInstalledSkills(dshHome)
    expect(installed.map(skill => [skill.name, skill.format])).toEqual([
      ['bundle-skill', 'bundle'],
      ['flat-skill', 'flat'],
    ])
  })
})
