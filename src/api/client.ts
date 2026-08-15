import { createContext, useContext } from 'react'
import { demoApi } from '../demo-api'
import type { LauncherApi } from '../types'

/**
 * 渲染层访问主进程的唯一入口。
 * 通过 context 传递而不是模块级全局，组件因此可以在测试里注入替身。
 */

/** 在 Electron 里拿真实实现，在浏览器里回落到演示数据。 */
export function resolveLauncherApi(): LauncherApi {
  return window.launcher ?? demoApi
}

const LauncherApiContext = createContext<LauncherApi | null>(null)

export const LauncherApiProvider = LauncherApiContext.Provider

export function useLauncherApi(): LauncherApi {
  const api = useContext(LauncherApiContext)
  if (!api) throw new Error('useLauncherApi 必须在 LauncherApiProvider 内部使用。')
  return api
}
