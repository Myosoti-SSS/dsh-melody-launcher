import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseDocument } from 'yaml'
import type { CredentialStatus } from '../src/types'

const DEEPSEEK_CREDENTIAL = 'DEEPSEEK_API_KEY'
const CREDENTIAL_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

function credentialsPath(dshHome: string): string {
  return path.join(dshHome, '.credentials.yaml')
}

async function readCredentialSource(dshHome: string): Promise<string | null> {
  try {
    return await readFile(credentialsPath(dshHome), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

function parseCredentials(source: string) {
  const document = parseDocument(source || '{}\n', { uniqueKeys: true })
  if (document.errors.length > 0) {
    throw new Error('DSH 凭据文件格式无效，请先在 DSH 中修复后重试。')
  }

  const value = document.toJS() as unknown
  if (value === null) return { document, values: {} as Record<string, string> }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('DSH 凭据文件必须是 Key 与密钥组成的映射。')
  }

  const values = value as Record<string, unknown>
  for (const [name, secret] of Object.entries(values)) {
    if (!CREDENTIAL_NAME.test(name) || typeof secret !== 'string' || secret.length === 0) {
      throw new Error('DSH 凭据文件包含无效条目，请先在 DSH 中修复后重试。')
    }
  }
  return { document, values: values as Record<string, string> }
}

async function writeCredentialDocument(dshHome: string, content: string): Promise<void> {
  await mkdir(dshHome, { recursive: true, mode: 0o700 })
  const target = credentialsPath(dshHome)
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`
  try {
    await writeFile(temporary, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    await rename(temporary, target)
    await chmod(target, 0o600)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
}

export async function getDeepSeekCredentialStatus(dshHome: string): Promise<CredentialStatus> {
  const source = await readCredentialSource(dshHome)
  if (source === null) return { configured: false }
  const { values } = parseCredentials(source)
  return { configured: Boolean(values[DEEPSEEK_CREDENTIAL]) }
}

export async function setDeepSeekApiKey(dshHome: string, apiKey: string): Promise<CredentialStatus> {
  const normalized = apiKey.trim()
  if (!normalized) throw new Error('API Key 不能为空。')
  const source = await readCredentialSource(dshHome)
  const { document } = parseCredentials(source ?? '{}\n')
  document.set(DEEPSEEK_CREDENTIAL, normalized)
  await writeCredentialDocument(dshHome, document.toString({ lineWidth: 0 }))
  return { configured: true }
}

export async function clearDeepSeekApiKey(dshHome: string): Promise<CredentialStatus> {
  const source = await readCredentialSource(dshHome)
  if (source === null) return { configured: false }
  const { document } = parseCredentials(source)
  document.delete(DEEPSEEK_CREDENTIAL)
  await writeCredentialDocument(dshHome, document.toString({ lineWidth: 0 }))
  return { configured: false }
}
