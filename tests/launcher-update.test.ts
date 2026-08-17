import { mkdtempSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildApplyScript,
  checkLauncherUpdate,
  createLauncherUpdater,
  resolvePortableAsset,
} from '../electron/launcher-update'

const PORTABLE = 'DSH-Launcher-0.1.10-portable.exe'

/** 构造 /releases/latest 的响应，可替换资产/版本。默认体积与下载测试的数据（9 字节）一致。 */
function releaseBody(remoteTag = 'v0.1.10', assetName = PORTABLE, assetSize = 9): unknown {
  return {
    tag_name: remoteTag,
    html_url: `https://github.com/rirko/dsh-melody-launcher/releases/tag/${remoteTag}`,
    assets: assetName
      ? [{ name: assetName, browser_download_url: `https://github.com/rirko/dsh-melody-launcher/releases/download/${remoteTag}/${assetName}`, size: assetSize }]
      : [],
  }
}

function latestFetch(body: unknown, status = 200): typeof fetch {
  return (async input => {
    const url = String(input)
    if (url.endsWith('/repos/rirko/dsh-melody-launcher/releases/latest')) {
      return new Response(status === 200 ? JSON.stringify(body) : '', { status })
    }
    return new Response('', { status: 404 })
  }) as typeof fetch
}

describe('resolvePortableAsset', () => {
  it('picks the -portable.exe asset from the release', () => {
    expect(resolvePortableAsset(releaseBody() as never)).toEqual({
      name: PORTABLE,
      size: 9,
      url: `https://github.com/rirko/dsh-melody-launcher/releases/download/v0.1.10/${PORTABLE}`,
    })
  })

  it('throws when no portable exe asset exists', () => {
    expect(() => resolvePortableAsset(releaseBody('v0.1.10', '') as never)).toThrow('没有可下载的便携版安装包')
  })

  it('throws when the tag is missing', () => {
    expect(() => resolvePortableAsset(releaseBody('') as never)).toThrow('缺少版本号')
  })
})

describe('checkLauncherUpdate', () => {
  it('reports update-available with asset details when remote is newer', async () => {
    const status = await checkLauncherUpdate(() => '0.1.9', latestFetch(releaseBody()))
    expect(status).toMatchObject({
      state: 'update-available',
      localVersion: '0.1.9',
      remoteVersion: '0.1.10',
      assetName: PORTABLE,
      assetSize: 9,
      releaseUrl: 'https://github.com/rirko/dsh-melody-launcher/releases/tag/v0.1.10',
    })
  })

  it('reports up-to-date when versions match (leading v tolerated)', async () => {
    const status = await checkLauncherUpdate(() => '0.1.9', latestFetch(releaseBody('v0.1.9')))
    expect(status.state).toBe('up-to-date')
    expect(status.remoteVersion).toBe('0.1.9')
    expect(status.assetName).toBeNull()
  })

  it('reports up-to-date when the local version is newer', async () => {
    const status = await checkLauncherUpdate(() => '0.1.11', latestFetch(releaseBody('v0.1.10')))
    expect(status.state).toBe('up-to-date')
  })

  it('returns an error state instead of throwing on HTTP failure', async () => {
    const status = await checkLauncherUpdate(() => '0.1.9', latestFetch(releaseBody(), 403))
    expect(status.state).toBe('error')
    expect(status.message).toContain('额度')
  })

  it('returns an error state when the release has no portable asset', async () => {
    const status = await checkLauncherUpdate(() => '0.1.9', latestFetch(releaseBody('v0.1.10', '')))
    expect(status.state).toBe('error')
    expect(status.message).toContain('没有可下载的便携版安装包')
  })

  it('returns an error state on malformed JSON', async () => {
    const malformed = (async input => {
      if (String(input).endsWith('/releases/latest')) return new Response('not json', { status: 200 })
      return new Response('', { status: 404 })
    }) as typeof fetch
    const status = await checkLauncherUpdate(() => '0.1.9', malformed)
    expect(status.state).toBe('error')
  })
})

/** 分块发送内容的假 fetch，模拟 GitHub 资产下载。 */
function chunkedAssetFetch(chunkSize = 3, total = 9): typeof fetch {
  return (async input => {
    const url = String(input)
    if (url.endsWith('/releases/latest')) return new Response(JSON.stringify(releaseBody()), { status: 200 })
    if (url.includes('/releases/download/')) {
      const body = new Uint8Array(total)
      body.fill(0x41) // 'A'
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          let offset = 0
          while (offset < total) {
            controller.enqueue(body.slice(offset, Math.min(offset + chunkSize, total)))
            offset += chunkSize
          }
          controller.close()
        },
      })
      return new Response(stream, { status: 200, headers: { 'content-length': String(total) } })
    }
    return new Response('', { status: 404 })
  }) as typeof fetch
}

describe('createLauncherUpdater download', () => {
  it('downloads via chunked asset fetch and reports byte-accurate progress', async () => {
    const userDataPath = mkdtempSync(path.join(os.tmpdir(), 'launcher-update-'))
    const progresses: Array<{ phase: string; percent: number }> = []
    const updater = createLauncherUpdater({
      getVersion: () => '0.1.9',
      userDataPath,
      githubFetch: chunkedAssetFetch(3, 9),
      emitProgress: p => progresses.push(p),
    })
    await updater.check()
    const status = await updater.download()
    expect(status.state).toBe('downloaded')
    expect(progresses.length).toBeGreaterThan(0)
    expect(progresses.every(p => p.phase === 'downloading')).toBe(true)
    expect(progresses.at(-1)?.percent).toBe(100)
    const saved = await import('node:fs/promises').then(fs => fs.readFile(path.join(userDataPath, 'launcher-update', PORTABLE)))
    expect(saved.length).toBe(9)
    expect(saved[0]).toBe(0x41)
  })
  async function setUp(tag = 'v0.1.10') {
    const userDataPath = mkdtempSync(path.join(os.tmpdir(), 'launcher-update-'))
    const progresses: Array<{ phase: string; percent: number }> = []
    const updater = createLauncherUpdater({
      getVersion: () => '0.1.9',
      userDataPath,
      githubFetch: latestFetch(releaseBody(tag)),
      emitProgress: p => progresses.push(p),
    })
    return { updater, userDataPath, progresses }
  }

  it('re-download does nothing when the temp file already matches the size', async () => {
    const { updater, userDataPath } = await setUp()
    const updateRoot = path.join(userDataPath, 'launcher-update')
    await mkdir(updateRoot, { recursive: true })
    await writeFile(path.join(updateRoot, PORTABLE), new Uint8Array(9).fill(0x42))
    await updater.check()
    const status = await updater.download()
    expect(status.state).toBe('downloaded')
    // 内容保持原样（幂等，未重下）。
    const saved = await import('node:fs/promises').then(fs => fs.readFile(path.join(updateRoot, PORTABLE)))
    expect(saved[0]).toBe(0x42)
  })

  it('returns the current status without downloading when no update is pending', async () => {
    const { updater } = await setUp('v0.1.9')
    await updater.check()
    const status = await updater.download()
    expect(status.state).toBe('up-to-date')
  })

  it('fails over to error state when the downloaded bytes mismatch the asset size', async () => {
    const userDataPath = mkdtempSync(path.join(os.tmpdir(), 'launcher-update-'))
    // 声明 1000 字节，实际只发 5 字节。
    const lying = (async input => {
      const url = String(input)
      if (url.endsWith('/releases/latest')) return new Response(JSON.stringify(releaseBody()), { status: 200 })
      if (url.includes('/releases/download/')) {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) { controller.enqueue(new Uint8Array([1, 2, 3, 4, 5])); controller.close() },
        })
        return new Response(stream, { status: 200, headers: { 'content-length': '1000' } })
      }
      return new Response('', { status: 404 })
    }) as typeof fetch
    const updater = createLauncherUpdater({
      getVersion: () => '0.1.9',
      userDataPath,
      githubFetch: lying,
      emitProgress: () => undefined,
    })
    await updater.check()
    const status = await updater.download()
    expect(status.state).toBe('error')
    expect(status.message).toContain('下载内容不完整')
  })
})

describe('apply', () => {
  it('builds a batch script that waits, moves, starts and self-deletes', () => {
    const script = buildApplyScript('DSH-Launcher-0.1.9-portable.exe', 'C:\\temp\\new.exe', 'C:\\Launcher\\DSH-Launcher-0.1.9-portable.exe')
    expect(script).toContain('@echo off')
    expect(script).toContain('%SystemRoot%\\System32\\tasklist.exe /fi "imagename eq DSH-Launcher-0.1.9-portable.exe"')
    expect(script).toContain('move /y "C:\\temp\\new.exe" "C:\\Launcher\\DSH-Launcher-0.1.9-portable.exe"')
    expect(script).toContain('start "" "C:\\Launcher\\DSH-Launcher-0.1.9-portable.exe"')
    expect(script).toContain('del "%~f0"')
  })

  it('throws when called without a downloaded update', async () => {
    const userDataPath = mkdtempSync(path.join(os.tmpdir(), 'launcher-update-'))
    const updater = createLauncherUpdater({
      getVersion: () => '0.1.9',
      userDataPath,
      githubFetch: latestFetch(releaseBody()),
      emitProgress: () => undefined,
    })
    await expect(updater.apply()).rejects.toThrow('没有已下载的启动器更新')
  })

  it('writes the apply script, spawns it and exits the app', async () => {
    const userDataPath = mkdtempSync(path.join(os.tmpdir(), 'launcher-update-'))
    const updateRoot = path.join(userDataPath, 'launcher-update')
    await mkdir(updateRoot, { recursive: true })
    await writeFile(path.join(updateRoot, PORTABLE), new Uint8Array(9))

    const spawned: Array<{ command: string; args: string[] }> = []
    let exitCode: number | undefined
    let unrefCalled = false
    const fakeSpawn = ((command: string, args: string[]) => {
      spawned.push({ command, args })
      return { unref: () => { unrefCalled = true } }
    }) as never
    const fakeExit = ((code: number) => { exitCode = code }) as never

    const updater = createLauncherUpdater({
      getVersion: () => '0.1.9',
      userDataPath,
      getExecPath: () => 'C:\\Launcher\\DSH-Launcher-0.1.9-portable.exe',
      githubFetch: latestFetch(releaseBody()),
      emitProgress: () => undefined,
      spawnProcess: fakeSpawn,
      exitProcess: fakeExit,
    })
    await updater.check()
    await updater.download()
    // 强制走「已存在同大小 temp」分支，保证 pending 仍指向 0.1.10。
    await updater.apply()

    expect(spawned).toHaveLength(1)
    expect(spawned[0].command).toBe('cmd.exe')
    expect(spawned[0].args[0]).toBe('/c')
    expect(String(spawned[0].args[1])).toContain(`apply-${process.pid}.cmd`)
    expect(unrefCalled).toBe(true)
    expect(exitCode).toBe(0)

    const script = await import('node:fs/promises').then(fs => fs.readFile(spawned[0].args[1] as string, 'utf8'))
    expect(script).toContain('move /y')
    expect(script).toContain('start ""')
  })
})
