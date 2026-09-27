import { afterEach, describe, expect, it } from 'vitest'
import { BuzzerClient, BuzzerLinkState, ListenerServer, beginPairing } from '../src/main/link'
import type { PagerEvent, PairedDevice } from '../src/shared/types'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function until(fn: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms
  while (!fn()) {
    if (Date.now() > end) throw new Error('timed out')
    await sleep(20)
  }
}

const event = (id: string): PagerEvent => ({
  id, source: 'discord', kind: 'dm', sender: 'Ahmed', group: null, server: null, channel: null,
  parentChannel: null, text: 'hi', raw: { title: 'Ahmed', body: 'hi' }, receivedAt: new Date().toISOString()
})

let cleanup: Array<() => void> = []
afterEach(() => { cleanup.forEach((f) => f()); cleanup = [] })

async function setup() {
  const devices: PairedDevice[] = []
  const server = new ListenerServer({
    port: 0, host: '127.0.0.1',
    identity: { id: 'win-1', name: 'Windows box' },
    getDevices: () => devices,
    addDevice: (d) => devices.push(d),
    getHealth: () => ({ helperRunning: true, discordRunning: true, lastToastAt: null })
  })
  const port = await server.start()
  cleanup.push(() => server.stop())
  return { server, port, devices }
}

describe('link', () => {
  it('refuses pairing when the listener is not in pairing mode', async () => {
    const { port } = await setup()
    await expect(beginPairing('127.0.0.1', port, { id: 'mac-1', name: 'Mac' })).rejects.toThrow(/not open/)
  })

  it('pairs with the right code, then delivers events and heartbeats', async () => {
    const { server, port, devices } = await setup()
    server.startPairing()
    const session = await beginPairing('127.0.0.1', port, { id: 'mac-1', name: 'Mac' })
    await until(() => server.pairing.code !== null)
    const result = await session.confirm(server.pairing.code!)
    expect(result.listenerName).toBe('Windows box')
    expect(devices).toHaveLength(1)
    expect(devices[0].key).toBe(result.key)
    expect(server.pairing.active).toBe(false)

    // Event published while the Mac is offline is queued, then delivered on connect.
    server.publish(event('queued-1'))

    const got: PagerEvent[] = []
    let status: BuzzerLinkState = { state: 'unpaired' }
    const client = new BuzzerClient({ deviceId: 'mac-1', onEvent: (e) => got.push(e), onStatus: (s) => (status = s) })
    cleanup.push(() => client.disconnect())
    await client.connect({ id: result.listenerId, host: '127.0.0.1', port, key: result.key })

    await until(() => got.length === 1)
    expect(got[0].id).toBe('queued-1')
    await until(() => status.state === 'online')

    server.publish(event('live-1'))
    await until(() => got.length === 2)
    expect(got[1].id).toBe('live-1')

    // Duplicates are dropped (e.g. re-flush after reconnect).
    server.publish(event('live-1'))
    await sleep(200)
    expect(got).toHaveLength(2)
  })

  it('rejects a wrong code', async () => {
    const { server, port, devices } = await setup()
    server.startPairing()
    const session = await beginPairing('127.0.0.1', port, { id: 'mac-1', name: 'Mac' })
    await until(() => server.pairing.code !== null)
    const wrong = server.pairing.code === '000000' ? '111111' : '000000'
    await expect(session.confirm(wrong)).rejects.toThrow(/does not match/)
    expect(devices).toHaveLength(0)
  })

  it('ignores a client with the wrong key', async () => {
    const { server, port, devices } = await setup()
    devices.push({ id: 'mac-1', name: 'Mac', key: Buffer.alloc(32, 1).toString('base64'), pairedAt: '' })
    const got: PagerEvent[] = []
    const client = new BuzzerClient({ deviceId: 'mac-1', onEvent: (e) => got.push(e), onStatus: () => {} })
    cleanup.push(() => client.disconnect())
    await client.connect({ id: 'win-1', host: '127.0.0.1', port, key: Buffer.alloc(32, 2).toString('base64') })
    await sleep(300)
    server.publish(event('x'))
    await sleep(300)
    expect(got).toHaveLength(0)
    expect(server.connectedDevices()).toHaveLength(0)
  })
})
