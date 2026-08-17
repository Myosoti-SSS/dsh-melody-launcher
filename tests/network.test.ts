import { describe, expect, it, vi } from 'vitest'
import { createProxyAwareFetch } from '../electron/network'

describe('proxy-aware Electron fetch adapter', () => {
  it('routes standard fetch requests through the injected Chromium network layer', async () => {
    const chromiumFetch = vi.fn(async () => new Response('{}', { status: 200 }))
    const fetchImpl = createProxyAwareFetch(chromiumFetch)
    const url = new URL('https://raw.githubusercontent.com/example/repository/main/package.json')

    await fetchImpl(url, { headers: { Authorization: 'Bearer test-token' } })

    expect(chromiumFetch).toHaveBeenCalledOnce()
    expect(chromiumFetch).toHaveBeenCalledWith(url.href, {
      headers: { Authorization: 'Bearer test-token' },
    })
  })
})
