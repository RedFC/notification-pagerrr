import type { PagerEvent } from './types'

// ---- Pairing frames (plaintext; they establish the key) ----
// 1. buzzer → listener  pair_hello  { commit = H(buzzerPub) }
// 2. listener → buzzer  pair_key    { pub = listenerPub }
// 3. buzzer → listener  pair_reveal { pub = buzzerPub }
//    Both derive the shared key + a 6-digit code. The listener shows its code;
//    the user types it on the Mac. The Mac compares, then:
// 4. buzzer → listener  (encrypted) pair_confirm
// 5. listener → buzzer  (encrypted) pair_ok
// The commitment in step 1 stops a man-in-the-middle from grinding keys to
// make both screens show the same code.

export interface PairHello { type: 'pair_hello'; deviceId: string; deviceName: string; commit: string }
export interface PairKey { type: 'pair_key'; listenerId: string; listenerName: string; pub: string }
export interface PairReveal { type: 'pair_reveal'; pub: string }
export interface PairError { type: 'pair_error'; message: string }
export type PairingFrame = PairHello | PairKey | PairReveal | PairError

// ---- Encrypted envelope for everything after pairing ----
export interface Envelope { type: 'sealed'; deviceId: string; nonce: string; box: string }

// ---- Messages inside the envelope ----
export interface HelloMsg { type: 'hello'; ts: number }
export interface EventMsg { type: 'event'; ts: number; event: PagerEvent }
export interface AckMsg { type: 'ack'; ts: number; id: string }
export interface HeartbeatMsg {
  type: 'heartbeat'
  ts: number
  helperRunning: boolean
  discordRunning: boolean
  lastToastAt: string | null
}
export interface PairConfirmMsg { type: 'pair_confirm'; ts: number }
export interface PairOkMsg { type: 'pair_ok'; ts: number }
export type SealedMsg = HelloMsg | EventMsg | AckMsg | HeartbeatMsg | PairConfirmMsg | PairOkMsg

/** Messages older or newer than this are rejected (replay protection). */
export const MAX_CLOCK_SKEW_MS = 5 * 60_000
