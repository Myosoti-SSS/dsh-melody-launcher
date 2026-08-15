import type { RepositoryResult, SkillRepositoryResult } from '../src/types'
import { isDshRepository } from './dsh-install'

/** GitHub 插件 / Skill 目录检索。解析与映射是纯函数，网络调用单独一层。 */

const SEARCH_ENDPOINT = 'https://api.github.com/search/repositories'
const PLUGIN_TOPIC = 'dsh-plugin'
const SKILL_TOPIC = 'dsh-skill'
const PAGE_SIZE = 30

export type DiscoverySort = 'stars' | 'updated'

/** GitHub Search API 返回的仓库条目中本模块用到的字段。 */
export interface GitHubRepositoryItem {
  id: number
  full_name: string
  name: string
  owner: { login: string }
  description: string | null
  html_url: string
  stargazers_count: number
  language: string | null
  updated_at: string
  topics?: string[]
  default_branch: string
}

export interface DiscoveryResponse {
  repositories: RepositoryResult[]
  totalCount: number
  rateRemaining?: number
}

export interface SkillDiscoveryResponse {
  repositories: SkillRepositoryResult[]
  totalCount: number
  rateRemaining?: number
}

/**
 * 构造检索式。用户输入会被裁剪到 80 字符并剔除除字母、数字、点、下划线、
 * 空格和连字符以外的内容，避免注入额外的搜索限定符。
 */
export function buildSearchQuery(query: string, topic: string): string {
  const normalized = query.trim().replace(/[^\p{L}\p{N}._ -]/gu, ' ').slice(0, 80)
  return `topic:${topic}${normalized ? ` ${normalized} in:name,description` : ''}`
}

export function buildSearchUrl(query: string, sort: DiscoverySort, page: number, topic: string): URL {
  const normalizedPage = Math.min(34, Math.max(1, Math.floor(Number(page) || 1)))
  const url = new URL(SEARCH_ENDPOINT)
  url.searchParams.set('q', buildSearchQuery(query, topic))
  url.searchParams.set('sort', sort)
  url.searchParams.set('order', 'desc')
  url.searchParams.set('per_page', String(PAGE_SIZE))
  url.searchParams.set('page', String(normalizedPage))
  return url
}

export function mapRepository(item: GitHubRepositoryItem): RepositoryResult {
  return {
    id: item.id,
    fullName: item.full_name,
    name: item.name,
    owner: item.owner.login,
    description: item.description ?? '此仓库没有提供说明。',
    url: item.html_url,
    stars: item.stargazers_count,
    language: item.language,
    updatedAt: item.updated_at,
    topics: item.topics ?? [],
    defaultBranch: item.default_branch,
    kind: isDshRepository(item.full_name) ? 'dsh' : 'plugin',
  }
}

export function mapSkillRepository(item: GitHubRepositoryItem): SkillRepositoryResult {
  return {
    id: item.id,
    fullName: item.full_name,
    name: item.name,
    owner: item.owner.login,
    description: item.description ?? '此仓库没有提供说明。',
    url: item.html_url,
    stars: item.stargazers_count,
    language: item.language,
    updatedAt: item.updated_at,
    topics: item.topics ?? [],
    defaultBranch: item.default_branch,
  }
}

export function describeSearchFailure(status: number): Error {
  if (status === 403) return new Error('GitHub 请求额度暂时用尽，请稍后重试。')
  return new Error(`GitHub 返回 ${status}，暂时无法获取插件。`)
}

/** 执行一次 GitHub 搜索，解析仓库列表与速率余量。 */
async function searchRepositories(
  url: URL,
): Promise<{ repositories: GitHubRepositoryItem[]; totalCount: number; rateRemaining?: number }> {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'DSH-Launcher',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })
  if (!response.ok) throw describeSearchFailure(response.status)

  const data = await response.json() as { total_count: number; items: GitHubRepositoryItem[] }
  const remaining = Number(response.headers.get('x-ratelimit-remaining'))
  return {
    repositories: data.items,
    totalCount: data.total_count,
    rateRemaining: Number.isFinite(remaining) ? remaining : undefined,
  }
}

export async function searchPluginRepositories(
  query: string,
  sort: DiscoverySort,
  page: number,
): Promise<DiscoveryResponse> {
  const found = await searchRepositories(buildSearchUrl(query, sort, page, PLUGIN_TOPIC))
  return {
    repositories: found.repositories.map(mapRepository),
    totalCount: found.totalCount,
    rateRemaining: found.rateRemaining,
  }
}

export async function searchSkillRepositories(
  query: string,
  sort: DiscoverySort,
  page: number,
): Promise<SkillDiscoveryResponse> {
  const found = await searchRepositories(buildSearchUrl(query, sort, page, SKILL_TOPIC))
  return {
    repositories: found.repositories.map(mapSkillRepository),
    totalCount: found.totalCount,
    rateRemaining: found.rateRemaining,
  }
}
