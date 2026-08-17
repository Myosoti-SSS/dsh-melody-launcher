import { describe, expect, it } from 'vitest'
import {
  buildSearchQuery,
  buildSearchUrl,
  CATALOG_MAX_PAGE,
  CATALOG_SOURCE_PAGE_SIZE,
  describeSearchFailure,
  mapCatalogRepository,
  searchCatalogRepositories,
  type GitHubRepositoryItem,
} from '../electron/discovery'
import { FEATURED_REPOSITORIES, prependFeatured } from '../electron/featured'

const item: GitHubRepositoryItem = {
  id: 42,
  full_name: 'someone/dsh-example',
  name: 'dsh-example',
  owner: { login: 'someone' },
  description: 'An example plugin',
  html_url: 'https://github.com/someone/dsh-example',
  stargazers_count: 12,
  size: 1536,
  language: 'TypeScript',
  updated_at: '2026-08-01T00:00:00Z',
  topics: ['dsh-plugin'],
  default_branch: 'main',
}

function searchResponse(items: GitHubRepositoryItem[], total = items.length, remaining = 8): Response {
  return new Response(JSON.stringify({ total_count: total, items }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'x-ratelimit-remaining': String(remaining),
    },
  })
}

function searchFetch(plugin: Response, skill: Response): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url)
    const query = url.searchParams.get('q') ?? ''
    return (query.includes('topic:dsh-skill') ? skill : plugin).clone()
  }) as typeof fetch
}

describe('buildSearchQuery', () => {
  it('scopes searches to the requested topic', () => {
    expect(buildSearchQuery('', 'dsh-plugin')).toBe('topic:dsh-plugin')
    expect(buildSearchQuery('   ', 'dsh-skill')).toBe('topic:dsh-skill')
  })

  it('appends a sanitized name and description filter', () => {
    expect(buildSearchQuery('memory', 'dsh-plugin')).toBe('topic:dsh-plugin memory in:name,description')
    expect(buildSearchQuery('user:evil org:target', 'dsh-plugin')).toBe('topic:dsh-plugin user evil org target in:name,description')
    expect(buildSearchQuery('记忆', 'dsh-skill')).toBe('topic:dsh-skill 记忆 in:name,description')
  })

  it('caps the query length', () => {
    expect(buildSearchQuery('a'.repeat(200), 'dsh-plugin')).toBe(`topic:dsh-plugin ${'a'.repeat(80)} in:name,description`)
  })
})

describe('buildSearchUrl', () => {
  it('uses fifteen rows per source and carries the requested sort', () => {
    const url = buildSearchUrl('memory', 'updated', 2, 'dsh-plugin')
    expect(url.origin + url.pathname).toBe('https://api.github.com/search/repositories')
    expect(url.searchParams.get('sort')).toBe('updated')
    expect(url.searchParams.get('order')).toBe('desc')
    expect(url.searchParams.get('per_page')).toBe(String(CATALOG_SOURCE_PAGE_SIZE))
    expect(url.searchParams.get('page')).toBe('2')
  })

  it('clamps pages to each topic search window', () => {
    expect(buildSearchUrl('', 'stars', 0, 'dsh-plugin').searchParams.get('page')).toBe('1')
    expect(buildSearchUrl('', 'stars', 999, 'dsh-plugin').searchParams.get('page')).toBe(String(CATALOG_MAX_PAGE))
  })
})

describe('catalog repository mapping', () => {
  it('maps candidate source labels and placeholders', () => {
    expect(mapCatalogRepository({ ...item, description: null, topics: undefined }, ['plugin'])).toMatchObject({
      id: 42,
      fullName: 'someone/dsh-example',
      description: '此仓库没有提供说明。',
      topics: [],
      sizeKb: 1536,
      kind: 'repository',
      candidateTypes: ['plugin'],
    })
  })

  it('marks the official repository as DSH core', () => {
    const mapped = mapCatalogRepository({ ...item, full_name: 'deepseek-ai/deepseek-harness' }, ['plugin'])
    expect(mapped.kind).toBe('dsh')
    expect(mapped.candidateTypes).toEqual([])
  })
})

describe('unified catalog search', () => {
  it('merges both topics, deduplicates hybrid repositories, and sorts the page', async () => {
    const core = { ...item, id: 1, full_name: 'deepseek-ai/deepseek-harness', stargazers_count: 100 }
    const plugin = { ...item, id: 2, full_name: 'demo/plugin', stargazers_count: 20 }
    const hybrid = { ...item, id: 3, full_name: 'demo/hybrid', stargazers_count: 30, topics: ['dsh-plugin', 'dsh-skill'] }
    const skill = { ...item, id: 4, full_name: 'demo/skill', stargazers_count: 10, topics: ['dsh-skill'] }
    const result = await searchCatalogRepositories('', 'stars', 1, searchFetch(
      searchResponse([plugin, hybrid, core], 3, 7),
      searchResponse([skill, hybrid], 2, 5),
    ))

    expect(result.repositories.map(repo => repo.fullName)).toEqual([
      'yjh051108/dsh-routing-suite',
      'deepseek-ai/deepseek-harness',
      'demo/hybrid',
      'demo/plugin',
      'demo/skill',
    ])
    expect(result.repositories.find(repo => repo.fullName === 'demo/hybrid')?.candidateTypes).toEqual(['skill', 'plugin'])
    expect(result.topicTotals).toEqual({ plugin: 3, skill: 2 })
    expect(result.rateRemaining).toBe(5)
    expect(result.warnings).toEqual([])
  })

  it('calculates page count from the larger capped topic', async () => {
    const result = await searchCatalogRepositories('', 'stars', 1, searchFetch(
      searchResponse([], 3_257),
      searchResponse([], 15),
    ))
    expect(result.pageCount).toBe(CATALOG_MAX_PAGE)
  })

  it('keeps the working source when the other source fails', async () => {
    const skill = { ...item, topics: ['dsh-skill'] }
    const result = await searchCatalogRepositories('', 'stars', 1, searchFetch(
      new Response('failed', { status: 500 }),
      searchResponse([skill], 1),
    ))
    // 内置 featured 条目恒在顶部，所以除 skill 源结果外还多一条内置行。
    expect(result.repositories).toHaveLength(2)
    expect(result.repositories.some(repo => repo.fullName === 'someone/dsh-example')).toBe(true)
    expect(result.repositories[0].featured).toBe(true)
    expect(result.topicTotals).toEqual({ plugin: 0, skill: 1 })
    expect(result.warnings[0]).toMatch(/Plugin 来源检索失败/)
  })

  it('fails only when both topic searches fail', async () => {
    await expect(searchCatalogRepositories('', 'stars', 1, searchFetch(
      new Response('failed', { status: 500 }),
      new Response('limited', { status: 403 }),
    ))).rejects.toThrow(/Plugin 来源检索失败.*Skill 来源检索失败/)
  })
})

describe('featured 内置条目', () => {
  it('prependFeatured 把内置条目前插到结果顶部', () => {
    const row = mapCatalogRepository({ ...item, id: 2, full_name: 'demo/plugin' }, ['plugin'])
    const result = prependFeatured([row])
    expect(result[0].fullName).toBe(FEATURED_REPOSITORIES[0].fullName)
    expect(result[0].featured).toBe(true)
    expect(result[1].fullName).toBe('demo/plugin')
  })

  it('prependFeatured 与结果里同名仓库去重（忽略大小写）', () => {
    const featuredName = FEATURED_REPOSITORIES[0].fullName
    const duplicated = mapCatalogRepository({ ...item, id: 2, full_name: featuredName.toUpperCase() }, ['plugin'])
    expect(prependFeatured([duplicated])).toHaveLength(FEATURED_REPOSITORIES.length)
  })

  it('检索结果在顶部固定返回内置条目', async () => {
    const plugin = { ...item, id: 2, full_name: 'demo/plugin' }
    const result = await searchCatalogRepositories('', 'stars', 1, searchFetch(
      searchResponse([plugin], 1),
      searchResponse([], 0),
    ))
    expect(result.repositories[0].fullName).toBe('yjh051108/dsh-routing-suite')
    expect(result.repositories[0].featured).toBe(true)
    expect(result.repositories[1].fullName).toBe('demo/plugin')
  })
})

describe('describeSearchFailure', () => {
  it('explains a rate limit separately from other failures', () => {
    expect(describeSearchFailure(403).message).toMatch(/额度/)
    expect(describeSearchFailure(500).message).toMatch(/500/)
  })
})
