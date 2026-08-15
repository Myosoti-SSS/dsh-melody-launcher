import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { parse } from 'yaml'
import type { InstalledSkill } from '../src/types'

export interface ParsedSkill {
  name: string
  description: string
  modelInvocable: boolean
  userInvocable: boolean
  content: string
}

export function isSkillName(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
}

function frontmatterBoolean(data: Record<string, unknown>, key: string): boolean | undefined {
  if (!Object.hasOwn(data, key)) return undefined
  const value = data[key]
  if (typeof value === 'boolean') return value
  if (value === 1 || value === '1') return true
  if (value === 0 || value === '0') return false
  if (typeof value === 'string') {
    if (['true', 'yes', 'on'].includes(value.toLowerCase())) return true
    if (['false', 'no', 'off'].includes(value.toLowerCase())) return false
  }
  throw new TypeError(`frontmatter field "${key}" must be a boolean`)
}

function invocationPolicy(data: Record<string, unknown>): Pick<ParsedSkill, 'modelInvocable' | 'userInvocable'> {
  const legacyKeys = ['disableModelInvocation', 'modelInvocable', 'userInvocable']
  if (legacyKeys.some(key => Object.hasOwn(data, key))) throw new Error('legacy invocation frontmatter is unsupported')
  return {
    modelInvocable: frontmatterBoolean(data, 'disable-model-invocation') !== true,
    userInvocable: frontmatterBoolean(data, 'user-invocable') !== false,
  }
}

export function parseSkillDocument(raw: string): ParsedSkill | null {
  const firstLineEnd = raw.indexOf('\n')
  if (firstLineEnd < 0 || raw.slice(0, firstLineEnd).replace(/\r$/, '') !== '---') return null
  const start = firstLineEnd + 1
  let lineStart = start
  let closingStart = -1
  let bodyStart = raw.length
  while (lineStart <= raw.length) {
    const nextNewline = raw.indexOf('\n', lineStart)
    const lineEnd = nextNewline < 0 ? raw.length : nextNewline
    if (raw.slice(lineStart, lineEnd).replace(/\r$/, '') === '---') {
      closingStart = lineStart
      bodyStart = nextNewline < 0 ? raw.length : nextNewline + 1
      break
    }
    if (nextNewline < 0) break
    lineStart = nextNewline + 1
  }
  if (closingStart < 0) return null

  let data: unknown
  try {
    data = parse(raw.slice(start, closingStart))
  } catch {
    return null
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null
  const fields = data as Record<string, unknown>
  const name = fields.name
  const description = fields.description
  if (typeof name !== 'string' || !name || !isSkillName(name)) return null
  if (typeof description !== 'string' || !description) return null
  try {
    return {
      name,
      description,
      ...invocationPolicy(fields),
      content: raw.slice(bodyStart).trim(),
    }
  } catch {
    return null
  }
}

export async function readInstalledSkills(dshHome: string): Promise<InstalledSkill[]> {
  const root = path.join(dshHome, 'skills')
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }

  const installed: InstalledSkill[] = []
  for (const entry of entries) {
    const format = entry.isDirectory() ? 'bundle' : entry.isFile() && entry.name.toLowerCase().endsWith('.md') ? 'flat' : null
    if (!format || entry.name === '.system') continue
    const skillPath = format === 'bundle' ? path.join(root, entry.name, 'SKILL.md') : path.join(root, entry.name)
    try {
      const parsed = parseSkillDocument(await readFile(skillPath, 'utf8'))
      if (!parsed) continue
      installed.push({
        name: parsed.name,
        description: parsed.description,
        path: format === 'bundle' ? path.dirname(skillPath) : skillPath,
        format,
        modelInvocable: parsed.modelInvocable,
        userInvocable: parsed.userInvocable,
      })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  return installed.sort((left, right) => left.name.localeCompare(right.name))
}
