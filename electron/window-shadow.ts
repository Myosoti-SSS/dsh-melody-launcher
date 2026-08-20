import { BrowserWindow, type Rectangle } from 'electron'

const SHADOW_MARGIN = 30
const SHADOW_HTML = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <style>
      html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: transparent; }
      .shadow {
        position: absolute;
        inset: ${SHADOW_MARGIN}px;
        border-radius: 14px;
        box-shadow: 0 10px 28px rgba(22, 32, 26, .25), 0 2px 9px rgba(22, 32, 26, .16);
      }
    </style>
  </head>
  <body><div class="shadow"></div></body>
</html>`

interface WindowShadowController {
  shadow: BrowserWindow
  sync(): void
  showBehind(): void
}

const controllers = new WeakMap<BrowserWindow, WindowShadowController>()

function shadowBounds(bounds: Rectangle): Rectangle {
  return {
    x: bounds.x - SHADOW_MARGIN,
    y: bounds.y - SHADOW_MARGIN,
    width: bounds.width + SHADOW_MARGIN * 2,
    height: bounds.height + SHADOW_MARGIN * 2,
  }
}

export function attachWindowShadow(window: BrowserWindow): void {
  if (process.platform !== 'win32' || window.isDestroyed() || controllers.has(window)) return

  const shadow = new BrowserWindow({
    ...shadowBounds(window.getBounds()),
    backgroundColor: '#00000000',
    transparent: true,
    frame: false,
    thickFrame: false,
    roundedCorners: false,
    hasShadow: false,
    focusable: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  shadow.setMenuBarVisibility(false)
  shadow.setIgnoreMouseEvents(true)
  void shadow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(SHADOW_HTML)}`)

  const controller: WindowShadowController = {
    shadow,
    sync() {
      if (window.isDestroyed() || shadow.isDestroyed()) return
      shadow.setBounds(shadowBounds(window.getBounds()), false)
    },
    showBehind() {
      if (window.isDestroyed() || shadow.isDestroyed() || window.isMinimized() || !window.isVisible()) return
      this.sync()
      shadow.showInactive()
      try {
        window.moveAbove(shadow.getMediaSourceId())
      } catch {
        // The next focus/show event retries if Windows is still creating the surface.
      }
    },
  }
  controllers.set(window, controller)

  const sync = () => controller.sync()
  const showBehind = () => controller.showBehind()
  const hide = () => {
    if (!shadow.isDestroyed()) shadow.hide()
  }

  window.on('move', sync)
  window.on('resize', sync)
  window.on('focus', showBehind)
  window.on('show', showBehind)
  window.on('restore', showBehind)
  window.on('hide', hide)
  window.on('minimize', hide)
  window.once('closed', () => {
    controllers.delete(window)
    if (!shadow.isDestroyed()) shadow.destroy()
  })
}

export function syncWindowShadow(window: BrowserWindow): void {
  controllers.get(window)?.sync()
}

export function showWindowShadow(window: BrowserWindow): void {
  controllers.get(window)?.showBehind()
}
