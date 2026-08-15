import { describe, expect, it } from 'vitest'
import { classifyCatalogRepository } from '../electron/catalog-analysis'
import type { RepositoryAnalysis, SkillRepositoryAnalysis } from '../src/types'

function plugin(installability: RepositoryAnalysis['installability']): RepositoryAnalysis {
  return {
    repository: 'demo/resource',
    defaultBranch: 'main',
    installability,
    summary: `plugin ${installability}`,
    targets: ['ready', 'choice'].includes(installability) ? [{
      id: '@demo/plugin:.',
      packageName: '@demo/plugin',
      version: '1.0.0',
      source: 'npm',
      profileName: 'web',
      platform: 'web',
      subdirectory: null,
      commit: 'a'.repeat(40),
      requiresBuild: false,
      buildScripts: [],
      nodeRange: null,
    }] : [],
  }
}

function skill(installability: SkillRepositoryAnalysis['installability']): SkillRepositoryAnalysis {
  return {
    repository: 'demo/resource',
    defaultBranch: 'main',
    installability,
    summary: `skill ${installability}`,
    targets: installability === 'invalid' ? [] : [{
      id: 'demo-skill:SKILL.md',
      name: 'demo-skill',
      description: 'Demo skill.',
      sourcePath: 'SKILL.md',
      format: 'bundle',
      revision: 'main',
      modelInvocable: true,
      userInvocable: true,
    }],
  }
}

const fulfilled = <T>(value: T): PromiseFulfilledResult<T> => ({ status: 'fulfilled', value })
const rejected = (message: string): PromiseRejectedResult => ({ status: 'rejected', reason: new Error(message) })

describe('catalog repository classification', () => {
  it('classifies plugin-only and skill-only repositories', () => {
    expect(classifyCatalogRepository('demo/plugin', 'main', fulfilled(plugin('ready')), fulfilled(skill('invalid'))).kind).toBe('plugin')
    expect(classifyCatalogRepository('demo/skill', 'main', fulfilled(plugin('invalid')), fulfilled(skill('ready'))).kind).toBe('skill')
  })

  it('keeps both component groups for a hybrid repository', () => {
    const result = classifyCatalogRepository('demo/hybrid', 'main', fulfilled(plugin('ready')), fulfilled(skill('choice')))
    expect(result.kind).toBe('hybrid')
    expect(result.pluginAnalysis?.targets).toHaveLength(1)
    expect(result.skillAnalysis?.targets).toHaveLength(1)
  })

  it('recognizes a dynamic session plugin but leaves it without install targets', () => {
    const result = classifyCatalogRepository('demo/dynamic', 'main', fulfilled(plugin('dynamic')), fulfilled(skill('invalid')))
    expect(result.kind).toBe('plugin')
    expect(result.pluginAnalysis?.installability).toBe('dynamic')
    expect(result.pluginAnalysis?.targets).toEqual([])
  })

  it('does not classify an ordinary application as a plugin', () => {
    const result = classifyCatalogRepository('demo/application', 'main', fulfilled(plugin('application')), fulfilled(skill('invalid')))
    expect(result.kind).toBe('invalid')
  })

  it('marks a fully checked repository without components as invalid', () => {
    const result = classifyCatalogRepository('demo/invalid', 'main', fulfilled(plugin('invalid')), fulfilled(skill('invalid')))
    expect(result.kind).toBe('invalid')
    expect(result.warnings).toEqual([])
  })

  it('keeps a valid type and warning when the other detector fails', () => {
    const result = classifyCatalogRepository('demo/partial', 'main', fulfilled(plugin('ready')), rejected('archive unavailable'))
    expect(result.kind).toBe('plugin')
    expect(result.warnings[0]).toMatch(/Skill 检测失败.*archive unavailable/)
  })

  it('does not report invalid when an unfinished detector could change the result', () => {
    expect(() => classifyCatalogRepository(
      'demo/unfinished',
      'main',
      fulfilled(plugin('invalid')),
      rejected('network'),
    )).toThrow(/检测未完成/)
    expect(() => classifyCatalogRepository(
      'demo/failed',
      'main',
      rejected('api'),
      rejected('archive'),
    )).toThrow(/检测未完成/)
  })

  it('always recognizes the official DSH repository without detector output', () => {
    const result = classifyCatalogRepository(
      'deepseek-ai/deepseek-harness',
      'master',
      rejected('skipped'),
      rejected('skipped'),
    )
    expect(result.kind).toBe('dsh')
    expect(result.warnings).toEqual([])
  })
})
