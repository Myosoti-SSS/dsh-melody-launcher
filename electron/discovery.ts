import type { RepositoryResult } from '../src/types'
import { isDshRepository } from './dsh-install'

/** GitHub 插件目录检索。解析与映射是纯函数，网络调用单独一层。 */

const SEARCH_ENDPOINT = 'https://api.github.com/search/repositories'
const PLUGIN_TOPIC = 'dsh-plugin'
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

/**
 * 构造检索式。用户输入会被裁剪到 80 字符并剔除除字母、数字、点、下划线、
 * 空格和连字符以外的内容，避免注入额外的搜索限定符。
 */
export function buildSearchQuery(query: string): string {
  const normalized = query.trim().replace(/[^\p{L}\p{N}._ -]/gu, ' ').slice(0, 80)
  return `topic:${PLUGIN_TOPIC}${normalized ? ` ${normalized} in:name,description` : ''}`
}

export function buildSearchUrl(query: string, sort: DiscoverySort): URL {
  const url = new URL(SEARCH_ENDPOINT)
  url.searchParams.set('q', buildSearchQuery(query))
  url.searchParams.set('sort', sort)
  url.searchParams.set('order', 'desc')
  url.searchParams.set('per_page', String(PAGE_SIZE))
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

export function describeSearchFailure(status: number): Error {
  if (status === 403) return new Error('GitHub 请求额度暂时用尽，请稍后重试。')
  return new Error(`GitHub 返回 ${status}，暂时无法获取插件。`)
}

export async function searchPluginRepositories(query: string, sort: DiscoverySort): Promise<DiscoveryResponse> {
  const response = await fetch(buildSearchUrl(query, sort), {
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
    repositories: data.items.map(mapRepository),
    totalCount: data.total_count,
    rateRemaining: Number.isFinite(remaining) ? remaining : undefined,
  }
}
