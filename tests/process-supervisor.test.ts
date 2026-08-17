import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { configureProcessTracker, spawnCommand } from '../electron/process'
import { createProcessSupervisor, type ProcessSupervisor } from '../electron/process-supervisor'

let temporaryDirectory = ''
let supervisor: ProcessSupervisor | null = null

afterEach(async () => {
  configureProcessTracker(null)
  await supervisor?.shutdown()
  supervisor = null
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true })
  temporaryDirectory = ''
})

describe('process supervisor', () => {
  it('ends a tracked long-running process during launcher shutdown', async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'dsh-process-supervisor-'))
    const workingDirectory = path.join(temporaryDirectory, 'working')
    await mkdir(workingDirectory)
    supervisor = await createProcessSupervisor({
      root: path.join(temporaryDirectory, 'supervisor'),
      executable: process.execPath,
    })
    configureProcessTracker(supervisor)

    const child = spawnCommand(process.execPath, ['-e', 'process.stdout.write("ready\\n"); setInterval(() => {}, 1000)'], {
      cwd: workingDirectory,
      env: process.env,
    })
    const ready = new Promise<void>((resolve, reject) => {
      child.once('error', reject)
      child.stdout.on('data', chunk => {
        if (chunk.toString('utf8').includes('ready')) resolve()
      })
    })
    const exited = new Promise<void>((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', () => resolve())
    })
    await ready

    await supervisor.shutdown()
    await exited

    expect(child.exitCode !== null || child.signalCode !== null).toBe(true)
  }, 20_000)
})
