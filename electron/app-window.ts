import { BrowserWindow } from 'electron'
import type { WindowMode } from '../src/types'

/** 主窗口的创建、尺寸模式切换，以及发往渲染层的消息通道。 */

interface WindowSize {
  width: number
  height: number
  minWidth: number
  minHeight: number
}

export const WINDOW_MODES: Record<WindowMode, WindowSize> = {
  launcher: { width: 900, height: 560, minWidth: 760, minHeight: 480 },
  manager: { width: 1380, height: 860, minWidth: 1024, minHeight: 680 },
}

export function isWindowMode(value: unknown): value is WindowMode {
  return value === 'launcher' || value === 'manager'
}

export interface CreateWindowOptions {
  preloadPath: string
  iconPath: string
  /** 开发模式下的 Vite 地址；缺省则加载打包后的 index.html。 */
  devServerUrl?: string
  indexPath: string
  onClosed: () => void
}

export function createMainWindow(options: CreateWindowOptions): BrowserWindow {
  const initialSize = WINDOW_MODES.launcher
  const window = new BrowserWindow({
    width: initialSize.width,
    height: initialSize.height,
    minWidth: initialSize.minWidth,
    minHeight: initialSize.minHeight,
    backgroundColor: '#151914',
    frame: false,
    hasShadow: true,
    icon: options.iconPath,
    title: 'DSH Launcher',
    show: false,
    webPreferences: {
      preload: options.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  window.setMenuBarVisibility(false)
  window.once('closed', options.onClosed)
  window.once('ready-to-show', () => window.show())

  if (options.devServerUrl) {
    void window.loadURL(options.devServerUrl)
  } else {
    void window.loadFile(options.indexPath)
  }
  return window
}

export function applyWindowMode(window: BrowserWindow | null, mode: WindowMode): void {
  if (!window || window.isDestroyed()) return
  const size = WINDOW_MODES[mode]
  if (window.isMaximized()) window.unmaximize()
  window.setMinimumSize(size.minWidth, size.minHeight)
  window.setSize(size.width, size.height, true)
  window.center()
}

/**
 * 发往渲染层的单一出口。
 * 「窗口是否还活着」的判断原本在三处推送逻辑里各写了一遍，这里收敛为一处。
 */
export interface RendererChannel {
  send(channel: string, payload: unknown): void
}

export function createRendererChannel(getWindow: () => BrowserWindow | null): RendererChannel {
  return {
    send(channel, payload) {
      const window = getWindow()
      if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return
      window.webContents.send(channel, payload)
    },
  }
}
