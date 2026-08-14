import { describe, expect, it } from 'vitest'
import path from 'node:path'
import {
  NODE_RUNTIME_VERSION,
  nodeArchiveName,
  parseNodeArchiveChecksum,
  requiresNodeRuntime,
  resolveNodeExecutable,
} from '../electron/node-runtime'

describe('node runtime', () => {
  it('selects the official Windows archive for the current architecture', () => {
    expect(nodeArchiveName('x64')).toBe(`node-${NODE_RUNTIME_VERSION}-win-x64.zip`)
    expect(nodeArchiveName('arm64')).toBe(`node-${NODE_RUNTIME_VERSION}-win-arm64.zip`)
  })

  it('reads the archive checksum from Node.js SHASUMS256.txt', () => {
    const archive = nodeArchiveName('x64')
    const checksum = 'a'.repeat(64)
    expect(parseNodeArchiveChecksum(`${'b'.repeat(64)}  other.zip\n${checksum}  ${archive}\n`, archive)).toBe(checksum)
    expect(parseNodeArchiveChecksum('', archive)).toBeNull()
  })

  it('maps npm and npx commands to absolute runtime executables', () => {
    const root = path.join('C:', 'portable-node')
    const runtime = {
      root,
      node: path.join(root, 'node.exe'),
      npm: path.join(root, 'npm.cmd'),
      npx: path.join(root, 'npx.cmd'),
      managed: true,
    }
    expect(resolveNodeExecutable('npx.cmd', runtime)).toBe(runtime.npx)
    expect(resolveNodeExecutable('C:\\old\\npm.cmd', runtime)).toBe(runtime.npm)
    expect(resolveNodeExecutable('custom.exe', runtime)).toBe('custom.exe')
  })

  it('detects commands that need Node.js on PATH', () => {
    expect(requiresNodeRuntime('npx.cmd', ['--yes', '@deepseek-ai/dsh', 'web'])).toBe(true)
    expect(requiresNodeRuntime('C:\\runtime\\dsh.cmd', ['web'])).toBe(true)
    expect(requiresNodeRuntime('custom.exe', ['serve'])).toBe(false)
  })
})
