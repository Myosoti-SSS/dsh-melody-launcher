import { describe, expect, it } from 'vitest'
import {
  buildSearchQuery,
  buildSearchUrl,
  describeSearchFailure,
  mapRepository,
  mapSkillRepository,
  type GitHubRepositoryItem,
} from '../electron/discovery'

const item: GitHubRepositoryItem = {
  id: 42,
  full_name: 'someone/dsh-example',
  name: 'dsh-example',
  owner: { login: 'someone' },
  description: 'An example plugin',
  html_url: 'https://github.com/someone/dsh-example',
  stargazers_count: 12,
  language: 'TypeScript',
  updated_at: '2026-08-01T00:00:00Z',
  topics: ['dsh-plugin'],
  default_branch: 'main',
}

describe('buildSearchQuery', () => {
  it('always scopes the search to the dsh-plugin topic', () => {
    expect(buildSearchQuery('', 'dsh-plugin')).toBe('topic:dsh-plugin')
    expect(buildSearchQuery('   ', 'dsh-plugin')).toBe('topic:dsh-plugin')
  })

  it('appends a name and description filter for a real query', () => {
    expect(buildSearchQuery('memory', 'dsh-plugin')).toBe('topic:dsh-plugin memory in:name,description')
  })

  it('strips characters that could inject extra search qualifiers', () => {
    expect(buildSearchQuery('user:evil org:target', 'dsh-plugin')).toBe('topic:dsh-plugin user evil org target in:name,description')
  })

  it('keeps CJK characters', () => {
    expect(buildSearchQuery('记忆', 'dsh-plugin')).toBe('topic:dsh-plugin 记忆 in:name,description')
  })

  it('caps the query length', () => {
    const query = buildSearchQuery('a'.repeat(200), 'dsh-plugin')
    expect(query).toBe(`topic:dsh-plugin ${'a'.repeat(80)} in:name,description`)
  })

  it('scopes the search to the dsh-skill topic for skills', () => {
    expect(buildSearchQuery('', 'dsh-skill')).toBe('topic:dsh-skill')
  })
})

describe('buildSearchUrl', () => {
  it('carries the sort order and page size', () => {
    const url = buildSearchUrl('memory', 'updated', 2, 'dsh-plugin')
    expect(url.origin + url.pathname).toBe('https://api.github.com/search/repositories')
    expect(url.searchParams.get('sort')).toBe('updated')
    expect(url.searchParams.get('order')).toBe('desc')
    expect(url.searchParams.get('per_page')).toBe('30')
    expect(url.searchParams.get('page')).toBe('2')
    expect(url.searchParams.get('q')).toBe('topic:dsh-plugin memory in:name,description')
  })

  it('clamps the page to the GitHub search window', () => {
    expect(buildSearchUrl('', 'stars', 0, 'dsh-plugin').searchParams.get('page')).toBe('1')
    expect(buildSearchUrl('', 'stars', 999, 'dsh-plugin').searchParams.get('page')).toBe('34')
  })

  it('uses the dsh-skill topic when browsing skills', () => {
    expect(buildSearchUrl('', 'stars', 1, 'dsh-skill').searchParams.get('q')).toBe('topic:dsh-skill')
  })
})

describe('mapRepository', () => {
  it('maps a plugin repository', () => {
    expect(mapRepository(item)).toEqual({
      id: 42,
      fullName: 'someone/dsh-example',
      name: 'dsh-example',
      owner: 'someone',
      description: 'An example plugin',
      url: 'https://github.com/someone/dsh-example',
      stars: 12,
      language: 'TypeScript',
      updatedAt: '2026-08-01T00:00:00Z',
      topics: ['dsh-plugin'],
      defaultBranch: 'main',
      kind: 'plugin',
    })
  })

  it('marks the official repository as the DSH core', () => {
    expect(mapRepository({ ...item, full_name: 'deepseek-ai/deepseek-harness' }).kind).toBe('dsh')
  })

  it('substitutes placeholders for missing fields', () => {
    const mapped = mapRepository({ ...item, description: null, topics: undefined })
    expect(mapped.description).toBe('此仓库没有提供说明。')
    expect(mapped.topics).toEqual([])
  })
})

describe('mapSkillRepository', () => {
  it('maps a skill repository without a plugin kind field', () => {
    expect(mapSkillRepository(item)).toEqual({
      id: 42,
      fullName: 'someone/dsh-example',
      name: 'dsh-example',
      owner: 'someone',
      description: 'An example plugin',
      url: 'https://github.com/someone/dsh-example',
      stars: 12,
      language: 'TypeScript',
      updatedAt: '2026-08-01T00:00:00Z',
      topics: ['dsh-plugin'],
      defaultBranch: 'main',
    })
  })

  it('substitutes placeholders for missing fields', () => {
    const mapped = mapSkillRepository({ ...item, description: null, topics: undefined })
    expect(mapped.description).toBe('此仓库没有提供说明。')
    expect(mapped.topics).toEqual([])
  })
})

describe('describeSearchFailure', () => {
  it('explains a rate limit separately from other failures', () => {
    expect(describeSearchFailure(403).message).toMatch(/额度/)
    expect(describeSearchFailure(500).message).toMatch(/500/)
  })
})
