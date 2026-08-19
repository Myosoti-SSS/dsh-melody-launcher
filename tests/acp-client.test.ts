import { describe, expect, it } from 'vitest'
import { createAcpClient, type AcpTransport } from '../electron/acp-client'

function inertTransport(): AcpTransport & { sent: string[]; closed: boolean } {
  let lineHandler: (line: string) => void = () => undefined
  let closeHandler: (error?: Error) => void = () => undefined
  return {
    sent: [],
    closed: false,
    send(line) {
      this.sent.push(line)
    },
    onLine(handler) {
      lineHandler = handler
      void lineHandler
    },
    onClose(handler) {
      closeHandler = handler
      void closeHandler
    },
    close() {
      // Reproduce the stdio transport: closing stdin does not synchronously emit onClose.
      this.closed = true
    },
  }
}

describe('ACP client cancellation', () => {
  it('rejects an unbounded prompt immediately when the client is closed', async () => {
    const transport = inertTransport()
    const client = createAcpClient({ transport })
    const promptResult = client.prompt('session-1', 'diagnose').then(
      () => 'resolved',
      error => error instanceof Error ? error.message : String(error),
    )

    client.close()

    await expect(promptResult).resolves.toBe('ACP 连接已关闭')
    expect(transport.closed).toBe(true)
    await expect(client.cancel('session-1')).rejects.toThrow('ACP 连接已关闭')
  })
})
