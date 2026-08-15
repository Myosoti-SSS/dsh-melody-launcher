import { useCallback, useState } from 'react'
import { useLauncherApi } from '../api/client'
import { errorText } from '../lib/format'
import type { ViewName, WindowMode } from '../types'

/**
 * 界面导航。切换 surface 时窗口尺寸也要跟着变，
 * 这个副作用属于导航本身，因此和导航状态放在一起。
 */
export function useNavigation(onError: (message: string) => void) {
  const api = useLauncherApi()
  const [surface, setSurface] = useState<WindowMode>('launcher')
  const [view, setView] = useState<ViewName>('plugins')

  const changeSurface = useCallback((next: WindowMode) => {
    setSurface(next)
    void api.setWindowMode(next).catch(error => onError(errorText(error)))
  }, [api, onError])

  return {
    surface,
    view,
    setView,
    showManager: useCallback(() => changeSurface('manager'), [changeSurface]),
    showLauncher: useCallback(() => changeSurface('launcher'), [changeSurface]),
  }
}
