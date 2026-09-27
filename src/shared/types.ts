// Types shared by main, preload and renderer.

export type Role = 'listener' | 'buzzer'

export type EventKind = 'dm' | 'channel' | 'group_dm' | 'unknown'

/** A raw notification as captured by the Windows helper. */
export interface RawToast {
  id: string
  appId: string
  appName: string
  /** All text elements of the toast in order; [0] is normally the title. */
  texts: string[]
  createdAt: string
}

/** A parsed Discord notification, sent from Listener to Buzzer. */
export interface PagerEvent {
  id: string
  source: 'discord'
  kind: EventKind
  sender: string | null
  /** Group DM name for kind=group_dm. */
  group: string | null
  server: string | null
  channel: string | null
  /** Parent channel when the message is in a thread. */
  parentChannel: string | null
  text: string
  raw: { title: string; body: string }
  receivedAt: string
}

export interface DmMember {
  name: string
  aliases: string[]
}

export interface DmList {
  id: string
  name: string
  enabled: boolean
  includeGroupDMs: boolean
  members: DmMember[]
}

export interface MentionRule {
  id: string
  server: string
  /** Empty string = any channel in the server. */
  channel: string
  /** 'mention' buzzes only when I'm @mentioned; 'any' buzzes on every toast from there. */
  mode: 'mention' | 'any'
  includeEveryone: boolean
  enabled: boolean
}

export interface BuzzerSettings {
  tone: 'pager' | 'alarm' | 'chirp'
  volume: number // 0..1
  maxSeconds: number
  hotkey: string
}

export interface PairedDevice {
  id: string
  name: string
  /** base64 shared key, encrypted at rest with safeStorage when available. */
  key: string
  pairedAt: string
}

export interface ListenerTarget {
  id: string
  name: string
  host: string
  port: number
}

export interface Config {
  role: Role
  deviceId: string
  deviceName: string
  launchAtLogin: boolean
  enabled: boolean
  snoozeUntil: string | null
  me: string[]
  dmLists: DmList[]
  mentionRules: MentionRule[]
  buzzer: BuzzerSettings
  /** Buzzer side: the listener it is paired with. */
  listener: (ListenerTarget & { key: string }) | null
  /** Listener side: buzzers allowed to connect. */
  pairedDevices: PairedDevice[]
  listenerPort: number
  captureLog: boolean
}

export interface AlertRecord {
  id: string
  event: PagerEvent
  reason: string
  at: string
  status: 'buzzing' | 'acknowledged' | 'missed'
}

export interface RuleResult {
  matched: boolean
  reason: string
}

export type LinkStatus =
  | { state: 'unpaired' }
  | { state: 'connecting'; since: string }
  | { state: 'online'; lastHeartbeat: string; helperRunning: boolean; discordRunning: boolean }
  | { state: 'stale'; lastHeartbeat: string | null }

export interface ListenerStatus {
  helperRunning: boolean
  helperError: string | null
  discordRunning: boolean
  lastToastAt: string | null
  connectedDevices: string[]
  pairing: { active: boolean; code: string | null; expiresAt: string | null }
  port: number
}

/** Everything the settings / alert windows need to render. */
export interface AppState {
  config: Config
  platform: string
  link: LinkStatus
  listener: ListenerStatus | null
  discovered: ListenerTarget[]
  recentEvents: PagerEvent[]
  recentAlerts: AlertRecord[]
  activeAlert: { alerts: AlertRecord[]; startedAt: string; missed: boolean } | null
}
