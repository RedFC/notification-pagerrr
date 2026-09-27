import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { defaultConfig, migrateConfig } from '../shared/config'
import type { AlertRecord, Config, PagerEvent } from '../shared/types'
import { randomId } from './crypto'

const dir = (): string => app.getPath('userData')
const configPath = (): string => join(dir(), 'config.json')
const historyPath = (): string => join(dir(), 'history.json')

// Pairing keys are encrypted at rest with the OS keychain when available.
function protect(key: string): string {
  if (!key || key.startsWith('enc:') || !safeStorage.isEncryptionAvailable()) return key
  return 'enc:' + safeStorage.encryptString(key).toString('base64')
}
function unprotect(key: string): string {
  if (!key?.startsWith('enc:')) return key
  try {
    return safeStorage.decryptString(Buffer.from(key.slice(4), 'base64'))
  } catch {
    return ''
  }
}

function writeAtomic(path: string, data: unknown): void {
  mkdirSync(dir(), { recursive: true })
  const tmp = path + '.tmp'
  writeFileSync(tmp, JSON.stringify(data, null, 2))
  renameSync(tmp, path)
}

export function loadConfig(): Config {
  const defaults = defaultConfig(process.platform, randomId(), hostname().replace(/\.local$/, ''))
  if (!existsSync(configPath())) {
    writeAtomic(configPath(), defaults)
    return defaults
  }
  try {
    const saved = JSON.parse(readFileSync(configPath(), 'utf8')) as Partial<Config>
    const c = migrateConfig(saved, defaults)
    if (c.listener) c.listener = { ...c.listener, key: unprotect(c.listener.key) }
    c.pairedDevices = c.pairedDevices.map((d) => ({ ...d, key: unprotect(d.key) }))
    return c
  } catch {
    return defaults
  }
}

export function saveConfig(c: Config): void {
  writeAtomic(configPath(), {
    ...c,
    listener: c.listener ? { ...c.listener, key: protect(c.listener.key) } : null,
    pairedDevices: c.pairedDevices.map((d) => ({ ...d, key: protect(d.key) }))
  })
}

export interface History { recentEvents: PagerEvent[]; recentAlerts: AlertRecord[] }

export function loadHistory(): History {
  try {
    return JSON.parse(readFileSync(historyPath(), 'utf8')) as History
  } catch {
    return { recentEvents: [], recentAlerts: [] }
  }
}

export function saveHistory(h: History): void {
  writeAtomic(historyPath(), h)
}

export const captureLogPath = (): string => join(dir(), 'toast-capture.jsonl')
