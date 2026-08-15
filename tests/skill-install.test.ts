import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import AdmZip from 'adm-zip'
import { afterEach, expect, it } from 'vitest'
import { readInstalledSkills } from '../electron/skill-format'
import { installSkillFromRepository } from '../electron/skill-install'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

it('installs only the selected skill bundle and preserves its resources', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-skill-install-'))
  temporaryRoots.push(root)
  const dshHome = path.join(root, 'home')
  const cacheRoot = path.join(root, 'cache')
  const commit = 'c'.repeat(40)
  const zip = new AdmZip()
  zip.addFile('skill-pack-main/academic/SKILL.md', Buffer.from('---\nname: academic\ndescription: Academic workflow.\n---\nUse the reference.\n'))
  zip.addFile('skill-pack-main/academic/references/guide.md', Buffer.from('# Guide\n'))
  zip.addFile('skill-pack-main/unrelated/file.txt', Buffer.from('do not install'))
  const archive = zip.toBuffer()
  // 见 skill-catalog.test.ts：Buffer 现在是泛型，不再是合法的 BodyInit。
  const fetchImpl = (async () => new Response(new Uint8Array(archive), {
    status: 200,
    headers: { 'content-length': String(archive.byteLength) },
  })) as typeof fetch

  const installed = await installSkillFromRepository(cacheRoot, dshHome, 'demo/skill-pack', {
    id: 'academic:academic/SKILL.md',
    name: 'academic',
    description: 'Academic workflow.',
    sourcePath: 'academic/SKILL.md',
    format: 'bundle',
    revision: commit,
    modelInvocable: true,
    userInvocable: true,
  }, () => undefined, fetchImpl)

  expect(installed.name).toBe('academic')
  expect(await readFile(path.join(dshHome, 'skills', 'academic', 'references', 'guide.md'), 'utf8')).toBe('# Guide\n')
  await expect(readFile(path.join(dshHome, 'skills', 'academic', 'unrelated', 'file.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  expect((await readInstalledSkills(dshHome)).map(skill => skill.name)).toEqual(['academic'])
})
