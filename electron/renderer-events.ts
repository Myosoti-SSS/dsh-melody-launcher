import { IPC_EVENTS } from '../src/constants'
import type { AiInstallEvent, InstallProgress, PackProgressEvent, RuntimeOutput, RuntimeState } from '../src/types'
import type { RendererChannel } from './app-window'

/** 主进程主动推送给渲染层的三类事件，统一在这里成形与发送。 */

/** 子进程输出里 CRLF 与尾部空白会让日志面板出现空行。 */
export function normalizeOutputText(text: string): string {
  return text.replace(/\r\n/g, '\n').trimEnd()
}

export interface RendererEvents {
  output(source: RuntimeOutput['channel'], level: RuntimeOutput['level'], text: string): void
  runtimeState(state: RuntimeState): void
  installProgress(progress: InstallProgress): void
  aiInstallEvent(event: AiInstallEvent): void
  packProgress(event: PackProgressEvent): void
}

export function createRendererEvents(
  channel: RendererChannel,
  timestamp: () => string = () => new Date().toISOString(),
): RendererEvents {
  return {
    output(source, level, text) {
      const normalized = normalizeOutputText(text)
      if (!normalized) return
      const payload: RuntimeOutput = { channel: source, level, text: normalized, timestamp: timestamp() }
      channel.send(IPC_EVENTS.runtimeOutput, payload)
    },
    runtimeState(state) {
      channel.send(IPC_EVENTS.runtimeStateChanged, state)
    },
    installProgress(progress) {
      channel.send(IPC_EVENTS.installProgress, progress)
    },
    aiInstallEvent(event) {
      channel.send(IPC_EVENTS.aiInstallEvent, event)
    },
    packProgress(event) {
      channel.send(IPC_EVENTS.packProgress, event)
    },
  }
}
