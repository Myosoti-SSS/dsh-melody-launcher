// @vitest-environment jsdom

import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { LauncherApiProvider } from '../src/api/client'
import { demoApi } from '../src/demo-api'
import type { CatalogRepositoryAnalysis, CatalogRepositoryResult, LauncherApi, ProfileState } from '../src/types'
import { DiscoverView } from '../src/views/DiscoverView'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function repository(name: string, id: number): CatalogRepositoryResult {
  return {
    id,
    fullName: `demo/${name}`,
    name,
    owner: 'demo',
    description: name,
    url: `https://github.com/demo/${name}`,
    stars: 0,
    language: 'TypeScript',
    updatedAt: '2026-08-17T00:00:00.000Z',
    topics: ['dsh-plugin'],
    defaultBranch: 'main',
    kind: 'repository',
    candidateTypes: ['plugin'],
  }
}

function invalidAnalysis(repo: CatalogRepositoryResult): CatalogRepositoryAnalysis {
  return {
    repository: repo.fullName,
    defaultBranch: repo.defaultBranch,
    kind: 'invalid',
    componentKinds: [],
    summary: 'not a plugin',
    pluginAnalysis: null,
    skillAnalysis: null,
    applicationAnalysis: null,
    presetAnalysis: null,
    warnings: [],
  }
}

const profile: ProfileState = {
  initialized: true,
  profileDir: 'C:\\demo',
  manifestPath: 'C:\\demo\\package.json',
  plugins: [],
  activeBundles: [],
  dependencyCount: 0,
  disabledCount: 0,
}

const mounted: Array<{ unmount(): void }> = []
afterEach(() => {
  mounted.splice(0).forEach(root => root.unmount())
  document.body.innerHTML = ''
})

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise(resolve => window.setTimeout(resolve, 0))
  })
}

describe('resource detection navigation', () => {
  it('keeps a page scan running and visible while navigating between market pages', async () => {
    const firstPage = [repository('one', 1), repository('two', 2)]
    const secondPage = [repository('three', 3)]
    const resolvers = new Map<string, (analysis: CatalogRepositoryAnalysis) => void>()
    const api: LauncherApi = {
      ...demoApi,
      discoverCatalog: async (_query, _sort, page) => ({
        repositories: page === 1 ? firstPage : secondPage,
        totalCount: 3,
        page,
        pageCount: 2,
        topicTotals: { plugin: 3, skill: 0, application: 0 },
        warnings: [],
        dshInstallation: { installed: false, version: null, executable: null, source: null },
        installedRepositories: [],
        installedSkills: [],
        installedApplications: [],
        installedPresets: [],
      }),
      analyzeCatalogRepository: repo => new Promise(resolve => resolvers.set(repo, resolve)),
      onCatalogAnalysisProgress: () => () => undefined,
    }

    function Harness() {
      const [analyses, setAnalyses] = useState<Record<string, CatalogRepositoryAnalysis>>({})
      return (
        <LauncherApiProvider value={api}>
          <DiscoverView
            profile={profile}
            analyses={analyses}
            installProgress={null}
            installedRepositories={new Set()}
            installedSkills={[]}
            installedApplications={[]}
            installedPresets={[]}
            pluginTrials={{}}
            onAnalysis={(repo, analysis) => setAnalyses(current => ({ ...current, [repo]: analysis }))}
            onInstallationState={() => undefined}
            onInstallStarted={() => undefined}
            onInstallFinished={() => undefined}
            onPluginInstalled={() => undefined}
            onSkillInstalled={() => undefined}
            onApplicationInstalled={() => undefined}
            onPresetInstalled={() => undefined}
            onError={() => undefined}
            onOpenRepository={() => undefined}
            onAiInstall={() => undefined}
            onTrialPlugin={() => undefined}
            onAdaptPlugin={() => undefined}
            aiRepository={null}
            aiSubject={null}
            aiActive={false}
          />
        </LauncherApiProvider>
      )
    }

    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    mounted.push(root)
    await act(async () => root.render(<Harness />))
    await settle()

    const scan = [...document.querySelectorAll('button')].find(button => button.textContent?.includes('检测当前页'))
    expect(scan).toBeTruthy()
    await act(async () => { scan!.click() })
    expect(resolvers.size).toBe(2)

    const next = document.querySelector<HTMLButtonElement>('button[aria-label="下一页"]')
    await act(async () => { next!.click() })
    await settle()
    expect(document.body.textContent).toContain('后台检测第 1 页 0/2')

    await act(async () => {
      resolvers.get('demo/one')?.(invalidAnalysis(firstPage[0]))
      await Promise.resolve()
    })
    expect(document.body.textContent).toContain('后台检测第 1 页 1/2')

    const previous = document.querySelector<HTMLButtonElement>('button[aria-label="上一页"]')
    await act(async () => { previous!.click() })
    await settle()
    expect(document.body.textContent).toContain('检测 1/2')
    expect(document.body.textContent).toContain('正在准备仓库结构检测')

    await act(async () => {
      resolvers.get('demo/two')?.(invalidAnalysis(firstPage[1]))
      await Promise.resolve()
    })
    await settle()
    expect(document.body.textContent).toContain('检测完成：2 个候选')
  })
})
