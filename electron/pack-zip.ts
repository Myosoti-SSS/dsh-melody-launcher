// 整合包（Pack）压缩包的纯函数域：读取检查 / 解出插件本体 / 重新打包。
// 不依赖 Electron，仅 adm-zip + node:fs。

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import AdmZip from 'adm-zip'
import type { PackManifest } from '../src/types'
import { isSafePackageName } from './profile'
import { PACK_MANIFEST_FILENAME, parsePackManifest, serializePackManifest } from './pack-manifest'

export interface PackZipLimits {
  maxArchiveBytes: number
  maxFiles: number
  maxUnpackedBytes: number
}

export const DEFAULT_PACK_ZIP_LIMITS: PackZipLimits = {
  maxArchiveBytes: 64 * 1024 * 1024,
  maxFiles: 12_000,
  maxUnpackedBytes: 256 * 1024 * 1024,
}

export interface PackZipInspection {
  manifest: PackManifest
  hasBodies: boolean
  bodyPackageNames: string[]
}

const PLUGIN_BODIES_PREFIX = 'plugin-bodies/'

/**
 * zip 条目路径安全校验：归一化 + 拒绝 `..` / 绝对路径 / 反斜杠 / 空段。
 * 与 skill-catalog 的 safeArchivePath 同源，额外拒绝了空段与 `.` 段。
 */
function safeArchivePath(value: string): string | null {
  if (value.includes('\\')) return null
  const segments = value.split('/')
  if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) return null
  const normalized = path.posix.normalize(value).replace(/^\.\//, '')
  if (!normalized || normalized === '..' || normalized.startsWith('../') || path.posix.isAbsolute(normalized)) return null
  return normalized
}

function assertInside(root: string, target: string): void {
  const resolvedRoot = path.resolve(root)
  const resolvedTarget = path.resolve(target)
  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error('解出路径超出了允许范围。')
  }
}

interface OpenPackZip {
  entries: AdmZip.IZipEntry[]
  stripRoot: string | null
}

function openArchive(buffer: Uint8Array, limits: PackZipLimits): OpenPackZip {
  if (buffer.byteLength > limits.maxArchiveBytes) throw new Error('整合包压缩包过大。')
  const archive = new AdmZip(Buffer.from(buffer))
  const entries = archive.getEntries()
  if (entries.length === 0) throw new Error('整合包压缩包为空。')
  if (entries.length > limits.maxFiles) throw new Error('整合包文件数量超过安全限制。')

  let unpackedBytes = 0
  for (const entry of entries) {
    if (entry.isDirectory) continue
    if (!safeArchivePath(entry.entryName)) throw new Error('整合包包含不安全路径。')
    unpackedBytes += Number(entry.header.size) || 0
  }
  if (unpackedBytes > limits.maxUnpackedBytes) throw new Error('整合包解压体积超过安全限制。')

  // 检测整体套一层顶层目录：全部条目共享同一首段且它不是清单/plugin-bodies 时视为包裹层。
  const firstSegments = new Set<string>()
  for (const entry of entries) {
    if (entry.isDirectory) continue
    const safe = safeArchivePath(entry.entryName)
    if (!safe) continue
    firstSegments.add(safe.split('/')[0])
  }
  let stripRoot: string | null = null
  if (firstSegments.size === 1) {
    const only = [...firstSegments][0]
    if (only !== PACK_MANIFEST_FILENAME && !only.startsWith(PLUGIN_BODIES_PREFIX)) stripRoot = only
  }
  return { entries, stripRoot }
}

function relForEntry(safe: string, stripRoot: string | null): string {
  return stripRoot && safe.startsWith(`${stripRoot}/`) ? safe.slice(stripRoot.length + 1) : safe
}

interface DecodedBody {
  pkg: string
  rel: string
}

/**
 * 解析 plugin-bodies/<...> 的相对路径，兼容 `@scope/pkg`（嵌套）与 `@scope-pkg`（单段编码）两种形态。
 * 约定：首段是裸 scope（无 `-`）且紧跟合法包名段时按嵌套解析；否则带 `-` 的首段按 `@scope-pkg` 编码解析。
 */
function decodeBodyEntry(rel: string): DecodedBody | null {
  const rest = rel.slice(PLUGIN_BODIES_PREFIX.length)
  if (!rest) return null
  const segments = rest.split('/')
  const first = segments[0]
  if (first.startsWith('@')) {
    if (!first.includes('-') && segments.length >= 2 && isSafePackageName(segments[1])) {
      return { pkg: `${first}/${segments[1]}`, rel: segments.slice(2).join('/') }
    }
    if (first.includes('-')) {
      const decoded = first.replace('-', '/')
      if (isSafePackageName(decoded)) return { pkg: decoded, rel: segments.slice(1).join('/') }
    }
    return null
  }
  if (isSafePackageName(first)) return { pkg: first, rel: segments.slice(1).join('/') }
  return null
}

/** 读取并检查整合包：解析清单、检测 plugin-bodies，全程 zip-slip + 限额校验。 */
export function inspectPackZip(buffer: Uint8Array, limits: PackZipLimits = DEFAULT_PACK_ZIP_LIMITS): PackZipInspection {
  const { entries, stripRoot } = openArchive(buffer, limits)
  let manifestText: string | null = null
  const bodyPackageNames = new Set<string>()
  for (const entry of entries) {
    if (entry.isDirectory) continue
    const safe = safeArchivePath(entry.entryName)
    if (!safe) continue
    const rel = relForEntry(safe, stripRoot)
    if (rel === PACK_MANIFEST_FILENAME) {
      manifestText = entry.getData().toString('utf8')
    } else if (rel.startsWith(PLUGIN_BODIES_PREFIX)) {
      const decoded = decodeBodyEntry(rel)
      if (decoded) bodyPackageNames.add(decoded.pkg)
    }
  }
  if (!manifestText) throw new Error(`压缩包内没有找到 ${PACK_MANIFEST_FILENAME}。`)
  const manifest = parsePackManifest(manifestText)
  return {
    manifest,
    hasBodies: bodyPackageNames.size > 0,
    bodyPackageNames: [...bodyPackageNames],
  }
}

/** 把 plugin-bodies/<packageName>/… 解到 workDir/<packageName>/（带 zip-slip 与限额），返回 包名→目录。 */
export async function extractPackBodies(
  buffer: Uint8Array,
  workDir: string,
  limits: PackZipLimits = DEFAULT_PACK_ZIP_LIMITS,
): Promise<Map<string, string>> {
  const { entries, stripRoot } = openArchive(buffer, limits)
  const resolvedWorkDir = path.resolve(workDir)
  await mkdir(resolvedWorkDir, { recursive: true })
  const result = new Map<string, string>()
  for (const entry of entries) {
    if (entry.isDirectory) continue
    const safe = safeArchivePath(entry.entryName)
    if (!safe) throw new Error('整合包包含不安全路径。')
    const rel = relForEntry(safe, stripRoot)
    if (!rel.startsWith(PLUGIN_BODIES_PREFIX)) continue
    const decoded = decodeBodyEntry(rel)
    if (!decoded || !decoded.rel) continue
    const packageDirectory = path.join(resolvedWorkDir, ...decoded.pkg.split('/'))
    assertInside(resolvedWorkDir, packageDirectory)
    const target = path.join(packageDirectory, ...decoded.rel.split('/'))
    assertInside(resolvedWorkDir, target)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, entry.getData())
    result.set(decoded.pkg, packageDirectory)
  }
  return result
}

/** 用 adm-zip 打包：dsh-pack.yaml + plugin-bodies/<packageName>/…（无 body 时即 manifest-only 包）。 */
export function buildPackZip(manifest: PackManifest, bodyDirs: Map<string, string>): Uint8Array {
  const zip = new AdmZip()
  zip.addFile(PACK_MANIFEST_FILENAME, Buffer.from(serializePackManifest(manifest), 'utf8'))
  for (const [packageName, directory] of bodyDirs) {
    const base = `${PLUGIN_BODIES_PREFIX}${packageName}`
    const stack: Array<{ dir: string; rel: string }> = [{ dir: directory, rel: '' }]
    while (stack.length > 0) {
      const current = stack.pop()!
      let childNames: string[] = []
      try {
        childNames = readdirSync(current.dir)
      } catch (error) {
        throw new Error(`无法读取插件本体目录：${current.dir}。`)
      }
      for (const childName of childNames) {
        const childPath = path.join(current.dir, childName)
        let stats
        try {
          stats = statSync(childPath)
        } catch (error) {
          throw new Error(`无法读取插件本体文件：${childPath}。`)
        }
        const childRel = current.rel ? `${current.rel}/${childName}` : childName
        if (stats.isDirectory()) {
          stack.push({ dir: childPath, rel: childRel })
        } else if (stats.isFile()) {
          zip.addFile(`${base}/${childRel}`, readFileSync(childPath))
        }
      }
    }
  }
  return new Uint8Array(zip.toBuffer())
}
