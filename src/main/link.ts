// Network link between the Windows Listener and the Mac Buzzer.
// Plain Node (ws + libsodium) with no Electron imports, so it can be tested headless.

import { WebSocket, WebSocketServer } from 'ws'
import * as crypto from './crypto'
import type {
  Envelope, HeartbeatMsg, PairHello, PairKey, PairReveal, PairingFrame, SealedMsg
} from '../shared/protocol'
import type { PagerEvent, PairedDevice } from '../shared/types'
import { HEARTBEAT_INTERVAL_MS, HEARTBEAT_STALE_MS, PAIRING_WINDOW_MS, QUEUE_TTL_MS } from '../shared/config'

type Frame = PairingFrame | Envelope

function parseFrame(data: WebSocket.RawData): Frame | null {
  try {
    const f = JSON.parse(data.toString())
    return f && typeof f.type === 'string' ? (f as Frame) : null
  } catch {
    return null
  }
}

const send = (ws: WebSocket, f: Frame): void => {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(f))
}

// ───────────────────────────── Listener (Windows) ─────────────────────────────

export interface ListenerHealth {
  helperRunning: boolean
  discordRunning: boolean
  lastToastAt: string | null
}

export interface ListenerServerOptions {
  port: number
  host?: string
  identity: { id: string; name: string }
  getDevices: () => PairedDevice[]
  addDevice: (d: PairedDevice) => void
  getHealth: () => ListenerHealth
  onChange?: () => void
  log?: (msg: string) => void
}

interface Conn {
  ws: WebSocket
  deviceId: string | null
  pairing: null | {
    deviceId: string
    deviceName: string
    commit: string
    kp: crypto.KeyPair
    key?: string
  }
}

interface Queued { event: PagerEvent; expires: number }

export class ListenerServer {
  private wss: WebSocketServer | null = null
  private conns = new Set<Conn>()
  private queues = new Map<string, Map<string, Queued>>()
  private heartbeat: NodeJS.Timeout | null = null
  pairing: { active: boolean; code: string | null; expiresAt: number | null } = { active: false, code: null, expiresAt: null }
  private pairingTimer: NodeJS.Timeout | null = null

  constructor(private o: ListenerServerOptions) {}

  async start(): Promise<number> {
    await crypto.ready()
    this.wss = new WebSocketServer({ port: this.o.port, host: this.o.host, maxPayload: 256 * 1024 })
    await new Promise<void>((res, rej) => {
      this.wss!.once('listening', () => res())
      this.wss!.once('error', rej)
    })
    this.wss.on('connection', (ws) => this.onConnection(ws))
    this.heartbeat = setInterval(() => this.tick(), HEARTBEAT_INTERVAL_MS)
    const addr = this.wss.address()
    return typeof addr === 'object' && addr ? addr.port : this.o.port
  }

  stop(): void {
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.stopPairing()
    for (const c of this.conns) c.ws.terminate()
    this.wss?.close()
  }

  connectedDevices(): string[] {
    const names = new Map(this.o.getDevices().map((d) => [d.id, d.name]))
    return [...this.conns].filter((c) => c.deviceId).map((c) => names.get(c.deviceId!) ?? c.deviceId!)
  }

  startPairing(): void {
    this.pairing = { active: true, code: null, expiresAt: Date.now() + PAIRING_WINDOW_MS }
    if (this.pairingTimer) clearTimeout(this.pairingTimer)
    this.pairingTimer = setTimeout(() => this.stopPairing(), PAIRING_WINDOW_MS)
    this.o.onChange?.()
  }

  stopPairing(): void {
    if (this.pairingTimer) clearTimeout(this.pairingTimer)
    this.pairingTimer = null
    this.pairing = { active: false, code: null, expiresAt: null }
    this.o.onChange?.()
  }

  /** Queue an event for every paired device and push it to those online. */
  publish(event: PagerEvent): void {
    const expires = Date.now() + QUEUE_TTL_MS
    for (const d of this.o.getDevices()) {
      if (!this.queues.has(d.id)) this.queues.set(d.id, new Map())
      this.queues.get(d.id)!.set(event.id, { event, expires })
    }
    for (const c of this.conns) {
      if (c.deviceId) this.sendSealed(c, { type: 'event', ts: Date.now(), event })
    }
  }

  /** Called when a device is removed in settings. */
  disconnectDevice(deviceId: string): void {
    this.queues.delete(deviceId)
    for (const c of this.conns) if (c.deviceId === deviceId) c.ws.close()
  }

  private keyFor(deviceId: string): string | null {
    return this.o.getDevices().find((d) => d.id === deviceId)?.key ?? null
  }

  private sendSealed(c: Conn, msg: SealedMsg, key?: string): void {
    const k = key ?? (c.deviceId ? this.keyFor(c.deviceId) : null)
    if (!k) return
    send(c.ws, crypto.seal(this.o.identity.id, k, msg))
  }

  private tick(): void {
    const now = Date.now()
    for (const q of this.queues.values()) {
      for (const [id, item] of q) if (item.expires < now) q.delete(id)
    }
    const h = this.o.getHealth()
    const hb: HeartbeatMsg = { type: 'heartbeat', ts: now, ...h }
    for (const c of this.conns) if (c.deviceId) this.sendSealed(c, hb)
  }

  private flush(c: Conn): void {
    const q = this.queues.get(c.deviceId!)
    if (!q) return
    for (const { event } of q.values()) this.sendSealed(c, { type: 'event', ts: Date.now(), event })
  }

  private onConnection(ws: WebSocket): void {
    const c: Conn = { ws, deviceId: null, pairing: null }
    this.conns.add(c)
    ws.on('message', (data) => this.onFrame(c, data))
    ws.on('close', () => {
      this.conns.delete(c)
      this.o.onChange?.()
    })
    ws.on('error', () => ws.terminate())
    // Unauthenticated sockets get 30 s to identify themselves.
    setTimeout(() => {
      if (!c.deviceId && !c.pairing) ws.terminate()
    }, 30_000)
  }

  private onFrame(c: Conn, data: WebSocket.RawData): void {
    const f = parseFrame(data)
    if (!f) return

    if (f.type === 'pair_hello') return this.onPairHello(c, f)
    if (f.type === 'pair_reveal') return this.onPairReveal(c, f)
    if (f.type !== 'sealed') return

    // Pairing confirmation uses the fresh key from this connection's pairing session.
    if (c.pairing?.key && f.deviceId === c.pairing.deviceId) {
      const msg = crypto.open(f, c.pairing.key)
      if (msg?.type === 'pair_confirm') {
        const p = c.pairing
        this.o.addDevice({ id: p.deviceId, name: p.deviceName, key: p.key!, pairedAt: new Date().toISOString() })
        c.pairing = null
        c.deviceId = p.deviceId
        this.sendSealed(c, { type: 'pair_ok', ts: Date.now() }, p.key)
        this.o.log?.(`paired with ${p.deviceName}`)
        this.stopPairing()
        return
      }
    }

    const key = this.keyFor(f.deviceId)
    if (!key) return void c.ws.close(4001, 'unknown device')
    const msg = crypto.open(f, key)
    if (!msg) return void c.ws.close(4002, 'bad message')

    if (msg.type === 'hello') {
      c.deviceId = f.deviceId
      this.o.onChange?.()
      this.tick()
      this.flush(c)
    } else if (msg.type === 'ack' && c.deviceId) {
      this.queues.get(c.deviceId)?.delete(msg.id)
    }
  }

  private onPairHello(c: Conn, f: PairHello): void {
    if (!this.pairing.active) {
      send(c.ws, { type: 'pair_error', message: 'Pairing is not open on the listener. Click "Start pairing" there first.' })
      return
    }
    const kp = crypto.newKeyPair()
    c.pairing = { deviceId: f.deviceId, deviceName: f.deviceName, commit: f.commit, kp }
    const reply: PairKey = { type: 'pair_key', listenerId: this.o.identity.id, listenerName: this.o.identity.name, pub: kp.publicKey }
    send(c.ws, reply)
  }

  private onPairReveal(c: Conn, f: PairReveal): void {
    const p = c.pairing
    if (!p || !this.pairing.active) return
    if (crypto.commit(f.pub) !== p.commit) {
      send(c.ws, { type: 'pair_error', message: 'Commitment mismatch' })
      c.pairing = null
      return
    }
    const { key, code } = crypto.deriveShared(p.kp.privateKey, f.pub, f.pub, p.kp.publicKey)
    p.key = key
    this.pairing.code = code
    this.o.onChange?.()
  }
}

// ───────────────────────────── Buzzer (Mac) ─────────────────────────────

export interface BuzzerTarget { id: string; host: string; port: number; key: string }

export interface BuzzerClientOptions {
  deviceId: string
  onEvent: (e: PagerEvent) => void
  onStatus: (s: BuzzerLinkState) => void
  log?: (msg: string) => void
}

export type BuzzerLinkState =
  | { state: 'unpaired' }
  | { state: 'connecting'; since: string }
  | { state: 'online'; lastHeartbeat: string; helperRunning: boolean; discordRunning: boolean }
  | { state: 'stale'; lastHeartbeat: string | null }

export class BuzzerClient {
  private ws: WebSocket | null = null
  private target: BuzzerTarget | null = null
  private backoff = 1000
  private reconnectTimer: NodeJS.Timeout | null = null
  private staleTimer: NodeJS.Timeout | null = null
  private lastHeartbeat: number | null = null
  private seen: string[] = []
  status: BuzzerLinkState = { state: 'unpaired' }

  constructor(private o: BuzzerClientOptions) {}

  async connect(target: BuzzerTarget | null): Promise<void> {
    await crypto.ready()
    this.disconnect()
    this.target = target
    if (!target) return this.setStatus({ state: 'unpaired' })
    this.lastHeartbeat = null
    this.setStatus({ state: 'connecting', since: new Date().toISOString() })
    this.staleTimer = setInterval(() => this.checkStale(), 5000)
    this.open()
  }

  disconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    if (this.staleTimer) clearInterval(this.staleTimer)
    this.reconnectTimer = this.staleTimer = null
    const ws = this.ws
    this.ws = null
    ws?.removeAllListeners()
    ws?.on('error', () => {})
    ws?.terminate()
  }

  private setStatus(s: BuzzerLinkState): void {
    this.status = s
    this.o.onStatus(s)
  }

  private checkStale(): void {
    const since = this.lastHeartbeat ?? (this.status.state === 'connecting' ? Date.parse(this.status.since) : 0)
    if (Date.now() - since > HEARTBEAT_STALE_MS && this.status.state !== 'stale') {
      this.setStatus({ state: 'stale', lastHeartbeat: this.lastHeartbeat ? new Date(this.lastHeartbeat).toISOString() : null })
    }
  }

  private open(): void {
    const t = this.target!
    const ws = new WebSocket(`ws://${t.host}:${t.port}`, { handshakeTimeout: 10_000 })
    this.ws = ws
    ws.on('open', () => {
      this.backoff = 1000
      send(ws, crypto.seal(this.o.deviceId, t.key, { type: 'hello', ts: Date.now() }))
    })
    ws.on('message', (data) => this.onFrame(data))
    ws.on('close', () => this.scheduleReconnect(ws))
    ws.on('error', (err) => {
      this.o.log?.(`link error: ${err.message}`)
      ws.terminate()
    })
  }

  private scheduleReconnect(ws: WebSocket): void {
    if (this.ws !== ws || !this.target) return
    this.reconnectTimer = setTimeout(() => this.open(), this.backoff)
    this.backoff = Math.min(this.backoff * 2, 10_000)
  }

  private onFrame(data: WebSocket.RawData): void {
    const f = parseFrame(data)
    if (!f || f.type !== 'sealed' || !this.target) return
    const msg = crypto.open(f, this.target.key)
    if (!msg) return
    if (msg.type === 'heartbeat') {
      this.lastHeartbeat = Date.now()
      this.setStatus({
        state: 'online',
        lastHeartbeat: new Date(this.lastHeartbeat).toISOString(),
        helperRunning: msg.helperRunning,
        discordRunning: msg.discordRunning
      })
    } else if (msg.type === 'event') {
      send(this.ws!, crypto.seal(this.o.deviceId, this.target.key, { type: 'ack', ts: Date.now(), id: msg.event.id }))
      if (this.seen.includes(msg.event.id)) return
      this.seen.push(msg.event.id)
      if (this.seen.length > 1000) this.seen.shift()
      this.o.onEvent(msg.event)
    }
  }
}

// ───────────────────────────── Pairing (Mac side) ─────────────────────────────

export interface PairingResult { listenerId: string; listenerName: string; key: string }

/**
 * Opens a pairing session with a listener. Resolves once keys are exchanged;
 * the caller then asks the user for the code shown on the listener and calls confirm().
 */
export async function beginPairing(
  host: string,
  port: number,
  me: { id: string; name: string }
): Promise<{ confirm: (typed: string) => Promise<PairingResult>; cancel: () => void; listenerName: string }> {
  await crypto.ready()
  const kp = crypto.newKeyPair()
  const ws = new WebSocket(`ws://${host}:${port}`, { handshakeTimeout: 10_000 })

  const keyMsg = await new Promise<PairKey>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Listener did not respond')), 15_000)
    ws.on('error', (e) => { clearTimeout(timer); reject(e) })
    ws.on('open', () => send(ws, { type: 'pair_hello', deviceId: me.id, deviceName: me.name, commit: crypto.commit(kp.publicKey) }))
    ws.on('message', (data) => {
      const f = parseFrame(data)
      if (f?.type === 'pair_key') { clearTimeout(timer); resolve(f) }
      if (f?.type === 'pair_error') { clearTimeout(timer); reject(new Error(f.message)) }
    })
  })

  send(ws, { type: 'pair_reveal', pub: kp.publicKey })
  const { key, code } = crypto.deriveShared(kp.privateKey, keyMsg.pub, kp.publicKey, keyMsg.pub)

  return {
    listenerName: keyMsg.listenerName,
    cancel: () => ws.terminate(),
    confirm: (typed: string) =>
      new Promise<PairingResult>((resolve, reject) => {
        if (typed.replace(/\D/g, '') !== code) {
          ws.terminate()
          return reject(new Error('Code does not match. Start pairing again.'))
        }
        const timer = setTimeout(() => { ws.terminate(); reject(new Error('Listener did not confirm')) }, 10_000)
        ws.removeAllListeners('message')
        ws.on('message', (data) => {
          const f = parseFrame(data)
          if (f?.type !== 'sealed') return
          const msg = crypto.open(f, key)
          if (msg?.type === 'pair_ok') {
            clearTimeout(timer)
            ws.close()
            resolve({ listenerId: keyMsg.listenerId, listenerName: keyMsg.listenerName, key })
          }
        })
        send(ws, crypto.seal(me.id, key, { type: 'pair_confirm', ts: Date.now() }))
      })
  }
}
