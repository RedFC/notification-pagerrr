import type { Config, Role } from './types'

export const DEFAULT_PORT = 47821
export const SERVICE_TYPE = 'discordpager'
export const HEARTBEAT_INTERVAL_MS = 10_000
export const HEARTBEAT_STALE_MS = 60_000
export const QUEUE_TTL_MS = 10 * 60_000
export const PAIRING_WINDOW_MS = 2 * 60_000
export const MAX_RECENT_EVENTS = 50
export const MAX_RECENT_ALERTS = 20

export function defaultConfig(platform: string, deviceId: string, deviceName: string): Config {
  const role: Role = platform === 'win32' ? 'listener' : 'buzzer'
  return {
    role,
    deviceId,
    deviceName,
    launchAtLogin: true,
    enabled: true,
    snoozeUntil: null,
    me: [],
    dmLists: [],
    mentionRules: [],
    buzzer: {
      tone: 'pager',
      volume: 0.9,
      maxSeconds: 180,
      hotkey: 'CommandOrControl+Shift+.'
    },
    listener: null,
    pairedDevices: [],
    listenerPort: DEFAULT_PORT,
    captureLog: false
  }
}

/** Fill in any fields missing from an older saved config. */
export function migrateConfig(saved: Partial<Config>, defaults: Config): Config {
  return {
    ...defaults,
    ...saved,
    buzzer: { ...defaults.buzzer, ...(saved.buzzer ?? {}) },
    dmLists: saved.dmLists ?? [],
    mentionRules: (saved.mentionRules ?? []).map((r) => ({ ...r, mode: r.mode ?? 'mention' })),
    pairedDevices: saved.pairedDevices ?? []
  }
}
