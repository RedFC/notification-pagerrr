import type { PagerEvent, RawToast } from '../../shared/types'

/**
 * Turns a raw Windows toast from Discord into a PagerEvent.
 *
 * Expected Discord title shapes (to be confirmed with real captures, Milestone 0):
 *   DM:              "Ahmed"
 *   Server channel:  "Ahmed (#alerts, V4Tech)"
 *   Thread:          "Ahmed (#bug-123, #alerts, V4Tech)"
 *   Group DM:        "Ahmed (Project Group)"
 * Body is the message text.
 */
export function isDiscordToast(t: RawToast): boolean {
  const id = t.appId.toLowerCase()
  const name = t.appName.toLowerCase()
  return id.includes('discord') || name === 'discord' || name.startsWith('discord ')
}

export function parseDiscordToast(t: RawToast, receivedAt = new Date().toISOString()): PagerEvent {
  const title = (t.texts[0] ?? '').trim()
  const body = t.texts.slice(1).join('\n').trim()
  const base: PagerEvent = {
    id: `${t.id}-${t.createdAt}`,
    source: 'discord',
    kind: 'unknown',
    sender: null,
    group: null,
    server: null,
    channel: null,
    parentChannel: null,
    text: body,
    raw: { title, body },
    receivedAt
  }

  if (!title || title.toLowerCase() === 'discord') return base

  // "Sender (inner)" — take the LAST " (" so senders with parentheses still work
  // when the inner part starts with '#'. Try the '#' form first.
  const m = title.match(/^(.*?) \((#.*)\)$/s)
  if (m) {
    const sender = m[1].trim()
    const parts = m[2].split(', ')
    const channels: string[] = []
    let i = 0
    while (i < parts.length && parts[i].startsWith('#')) {
      channels.push(parts[i].slice(1).trim())
      i++
    }
    const server = parts.slice(i).join(', ').trim()
    if (channels.length > 0 && server) {
      return {
        ...base,
        kind: 'channel',
        sender,
        server,
        channel: channels[0],
        parentChannel: channels.length > 1 ? channels[channels.length - 1] : null
      }
    }
  }

  const g = title.match(/^(.*) \(([^()]+)\)$/s)
  if (g) {
    return { ...base, kind: 'group_dm', sender: g[1].trim(), group: g[2].trim() }
  }

  return { ...base, kind: 'dm', sender: title }
}
