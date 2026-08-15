import { readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { parse, stringify } from 'yaml'
import { repositoryFullNameFromSpecifier } from './profile'

const BUILD_KEY_PATTERN = /(?:@[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+|[A-Za-z0-9._-]+)@[^\s,]+/gi
const BUILD_KEY_VALID_PATTERN = /^(?:@[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+|[A-Za-z0-9._-]+)@[^\s,]+$/i

export function ignoredBuildKeys(output: string): string[] {
  const plainText = output.replace(/\x1b\[[0-9;]*m/g, '')
  const sections = [...plainText.matchAll(/Ignored build scripts:\s*([^\r\n]+)/gi)]
  return [...new Set(sections.flatMap(match => match[1].match(BUILD_KEY_PATTERN) ?? []))]
}

function buildKeyRepository(buildKey: string): string | undefined {
  const separator = buildKey.search(/@(?=(?:git\+)?https?:\/\/|github:)/i)
  return separator < 0 ? undefined : repositoryFullNameFromSpecifier(buildKey.slice(separator + 1))
}

export async function approveIgnoredGitHubBuilds(
  workspacePath: string,
  output: string,
  repository: string,
): Promise<string[]> {
  const expectedRepository = repository.toLowerCase()
  const matchingKeys = ignoredBuildKeys(output).filter(key => buildKeyRepository(key)?.toLowerCase() === expectedRepository)
  if (matchingKeys.length === 0) return []

  return approveBuildKeys(workspacePath, matchingKeys)
}

export async function approveBuildKeys(workspacePath: string, buildKeys: string[]): Promise<string[]> {
  const matchingKeys = [...new Set(buildKeys)].filter(key => BUILD_KEY_VALID_PATTERN.test(key))
  if (matchingKeys.length === 0 || matchingKeys.length > 64) return []

  let source = ''
  try {
    source = await readFile(workspacePath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const parsed = source.trim() ? parse(source) : {}
  const workspace = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  const currentAllowBuilds = workspace.allowBuilds
  const allowBuilds = currentAllowBuilds && typeof currentAllowBuilds === 'object' && !Array.isArray(currentAllowBuilds)
    ? currentAllowBuilds as Record<string, unknown>
    : {}
  const changed = matchingKeys.filter(key => allowBuilds[key] !== true)
  if (changed.length === 0) return []
  for (const key of changed) allowBuilds[key] = true
  workspace.allowBuilds = allowBuilds

  const temporaryPath = `${workspacePath}.dsh-launcher.tmp`
  await writeFile(temporaryPath, stringify(workspace, { lineWidth: 0 }), 'utf8')
  try {
    await rename(temporaryPath, workspacePath)
  } catch {
    await writeFile(workspacePath, stringify(workspace, { lineWidth: 0 }), 'utf8')
    await unlink(temporaryPath).catch(() => undefined)
  }
  return changed
}
