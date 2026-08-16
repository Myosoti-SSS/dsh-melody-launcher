import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import AdmZip from 'adm-zip'
import { describe, expect, it } from 'vitest'
import { prepareAiRepositorySource } from '../electron/ai-repository-source'

function archive(entries: Record<string, string>): Buffer {
  const zip = new AdmZip()
  for (const [name, content] of Object.entries(entries)) zip.addFile(name, Buffer.from(content))
  return zip.toBuffer()
}

function archiveFetch(buffer: Buffer): typeof fetch {
  const body = Uint8Array.from(buffer).buffer
  return async () => new Response(body, {
    status: 200,
    headers: { 'content-length': String(buffer.length) },
  })
}

describe('prepareAiRepositorySource', () => {
  it('安全解压仓库到独立临时目录', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'dsh-ai-source-test-'))
    try {
      const buffer = archive({
        'repo-main/README.md': '# demo',
        'repo-main/src/index.ts': 'export const ok = true\n',
      })
      const progress: number[] = []
      const source = await prepareAiRepositorySource(
        root,
        'demo/repo',
        'main',
        received => progress.push(received),
        archiveFetch(buffer),
      )
      expect(source.taskRoot.startsWith(root)).toBe(true)
      expect(await readFile(path.join(source.repositoryPath, 'README.md'), 'utf8')).toBe('# demo')
      expect(await readFile(path.join(source.repositoryPath, 'src', 'index.ts'), 'utf8')).toContain('ok = true')
      expect(progress.length).toBeGreaterThan(0)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('拒绝会逃出仓库根目录的压缩包路径并清理临时目录', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'dsh-ai-source-unsafe-'))
    try {
      const buffer = archive({
        'repo-main/README.md': '# demo',
        'repo-main/../escape.txt': 'escape',
      })
      await expect(prepareAiRepositorySource(
        root,
        'demo/repo',
        'main',
        undefined,
        archiveFetch(buffer),
      )).rejects.toThrow(/不安全路径|结构无效/)
      expect(existsSync(path.join(root, 'escape.txt'))).toBe(false)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
