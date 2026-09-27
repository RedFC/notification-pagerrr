// Crypto for pairing and the encrypted link, using Node's built-in crypto only
// (X25519 key agreement, HKDF-SHA256, AES-256-GCM).
import {
  createCipheriv, createDecipheriv, createHash, createPublicKey, diffieHellman,
  generateKeyPairSync, hkdfSync, randomBytes, type KeyObject
} from 'node:crypto'
import type { Envelope, SealedMsg } from '../shared/protocol'
import { MAX_CLOCK_SKEW_MS } from '../shared/protocol'

/** Kept for API symmetry; Node crypto needs no async init. */
export async function ready(): Promise<void> {}

export interface KeyPair { publicKey: string; privateKey: KeyObject }

export function newKeyPair(): KeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('x25519')
  const jwk = publicKey.export({ format: 'jwk' })
  return { publicKey: jwk.x as string, privateKey }
}

export function commit(pub: string): string {
  return createHash('sha256').update('discord-pager-commit').update(pub).digest('base64')
}

/**
 * Derive the long-term shared key and the 6-digit confirmation code.
 * Both sides pass the buzzer pub and listener pub in the same order.
 */
export function deriveShared(
  myPrivate: KeyObject,
  theirPub: string,
  buzzerPub: string,
  listenerPub: string
): { key: string; code: string } {
  const publicKey = createPublicKey({ key: { kty: 'OKP', crv: 'X25519', x: theirPub }, format: 'jwk' })
  const dh = diffieHellman({ privateKey: myPrivate, publicKey })
  const transcript = Buffer.from(`${buzzerPub}|${listenerPub}`)
  const key = Buffer.from(hkdfSync('sha256', dh, transcript, 'discord-pager-key', 32))
  const sas = createHash('sha256').update('discord-pager-sas').update(transcript).digest()
  const code = String(sas.readUInt32BE(0) % 1_000_000).padStart(6, '0')
  return { key: key.toString('base64'), code }
}

export function seal(deviceId: string, key: string, msg: SealedMsg): Envelope {
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'base64'), nonce)
  cipher.setAAD(Buffer.from(deviceId))
  const body = Buffer.concat([cipher.update(JSON.stringify(msg), 'utf8'), cipher.final(), cipher.getAuthTag()])
  return { type: 'sealed', deviceId, nonce: nonce.toString('base64'), box: body.toString('base64') }
}

/** Returns the message, or null if it fails authentication or is outside the time window. */
export function open(env: Envelope, key: string, now = Date.now()): SealedMsg | null {
  try {
    const body = Buffer.from(env.box, 'base64')
    const decipher = createDecipheriv('aes-256-gcm', Buffer.from(key, 'base64'), Buffer.from(env.nonce, 'base64'))
    decipher.setAAD(Buffer.from(env.deviceId))
    decipher.setAuthTag(body.subarray(body.length - 16))
    const plain = Buffer.concat([decipher.update(body.subarray(0, body.length - 16)), decipher.final()])
    const msg = JSON.parse(plain.toString('utf8')) as SealedMsg
    if (typeof msg.ts !== 'number' || Math.abs(now - msg.ts) > MAX_CLOCK_SKEW_MS) return null
    return msg
  } catch {
    return null
  }
}

export function randomId(): string {
  return randomBytes(16).toString('hex')
}
