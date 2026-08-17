import { describe, expect, it } from 'vitest'
import { classifyCatalogRepository } from '../electron/catalog-analysis'
import type { ApplicationRepositoryAnalysis, RepositoryAnalysis, SkillRepositoryAnalysis } from '../src/types'

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

function application(installability: ApplicationRepositoryAnalysis['installability']): ApplicationRepositoryAnalysis {
  return {
    repository: 'demo/resource',
    defaultBranch: 'main',
    installability,
    summary: `application ${installability}`,
    targets: installability === 'invalid' ? [] : [{
      id: 'demo-app:.',
      addonId: 'demo-app',
      name: 'Demo App',
      description: 'Demo application.',
      provider: 'npm',
      packageName: 'demo-app',
      version: '1.0.0',
      binName: 'demo-app',
      launchMode: 'standalone',
      launchArgs: [],
      platforms: ['win32', 'darwin', 'linux'],
      supported: installability !== 'unsupported',
      verified: true,
      provides: [],
    }],
  }
}

const fulfilled = <T>(value: T): PromiseFulfilledResult<T> => ({ status: 'fulfilled', value })
const rejected = (message: string): PromiseRejectedResult => ({ status: 'rejected', reason: new Error(message) })
const classify = (
  repository: string,
  pluginResult: PromiseSettledResult<RepositoryAnalysis>,
  skillResult: PromiseSettledResult<SkillRepositoryAnalysis>,
  applicationResult: PromiseSettledResult<ApplicationRepositoryAnalysis> = fulfilled(application('invalid')),
) => classifyCatalogRepository(repository, 'main', pluginResult, skillResult, applicationResult)

describe('catalog repository classification', () => {
  it('classifies plugin-only and skill-only repositories', () => {
    expect(classify('demo/plugin', fulfilled(plugin('ready')), fulfilled(skill('invalid'))).kind).toBe('plugin')
    expect(classify('demo/skill', fulfilled(plugin('invalid')), fulfilled(skill('ready'))).kind).toBe('skill')
  })

  it('keeps both component groups for a hybrid repository', () => {
    const result = classify('demo/hybrid', fulfilled(plugin('ready')), fulfilled(skill('choice')))
    expect(result.kind).toBe('hybrid')
    expect(result.pluginAnalysis?.targets).toHaveLength(1)
    expect(result.skillAnalysis?.targets).toHaveLength(1)
  })

  it('recognizes a dynamic session plugin but leaves it without install targets', () => {
    const result = classify('demo/dynamic', fulfilled(plugin('dynamic')), fulfilled(skill('invalid')))
    expect(result.kind).toBe('plugin')
    expect(result.pluginAnalysis?.installability).toBe('dynamic')
    expect(result.pluginAnalysis?.targets).toEqual([])
  })

  it('does not classify an ordinary application as a plugin', () => {
    const result = classify('demo/application', fulfilled(plugin('application')), fulfilled(skill('invalid')))
    expect(result.kind).toBe('invalid')
  })

  it('marks a fully checked repository without components as invalid', () => {
    const result = classify('demo/invalid', fulfilled(plugin('invalid')), fulfilled(skill('invalid')))
    expect(result.kind).toBe('invalid')
    expect(result.warnings).toEqual([])
  })

  it('keeps a valid type and warning when the other detector fails', () => {
    const result = classify('demo/partial', fulfilled(plugin('ready')), rejected('archive unavailable'))
    expect(result.kind).toBe('plugin')
    expect(result.warnings[0]).toMatch(/Skill 检测失败.*archive unavailable/)
  })

  it('does not report invalid when an unfinished detector could change the result', () => {
    expect(() => classify(
      'demo/unfinished',
      fulfilled(plugin('invalid')),
      rejected('network'),
    )).toThrow(/检测未完成/)
    expect(() => classify(
      'demo/failed',
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
      rejected('skipped'),
    )
    expect(result.kind).toBe('dsh')
    expect(result.warnings).toEqual([])
  })

  it('classifies application-only, unsupported, and application hybrid repositories', () => {
    const standalone = classify('demo/app', fulfilled(plugin('invalid')), fulfilled(skill('invalid')), fulfilled(application('ready')))
    expect(standalone.kind).toBe('application')
    expect(standalone.componentKinds).toEqual(['application'])

    const unsupported = classify('demo/unsupported', fulfilled(plugin('invalid')), fulfilled(skill('invalid')), fulfilled(application('unsupported')))
    expect(unsupported.kind).toBe('application')

    const hybrid = classify('demo/app-plugin', fulfilled(plugin('ready')), fulfilled(skill('invalid')), fulfilled(application('ready')))
    expect(hybrid.kind).toBe('hybrid')
    expect(hybrid.componentKinds).toEqual(['plugin', 'application'])
  })
})
