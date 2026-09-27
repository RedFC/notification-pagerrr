import type { Config, PagerEvent, RuleResult } from '../../shared/types'

const norm = (s: string | null | undefined): string =>
  (s ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()

const stripHash = (s: string): string => norm(s).replace(/^#/, '')

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** True if text contains "@name" for any of my names (not followed by more name characters). */
export function mentionsMe(text: string, me: string[], includeEveryone: boolean): boolean {
  const t = text.normalize('NFKC')
  for (const name of me.map((n) => n.trim()).filter(Boolean)) {
    const re = new RegExp(`@${escapeRe(name)}(?![\\p{L}\\p{N}_])`, 'iu')
    if (re.test(t)) return true
  }
  if (includeEveryone && /@(everyone|here)\b/i.test(t)) return true
  return false
}

function senderMatches(sender: string | null, names: string[]): boolean {
  const s = norm(sender)
  return s.length > 0 && names.some((n) => norm(n) === s)
}

export function evaluate(event: PagerEvent, config: Config): RuleResult {
  if (event.kind === 'dm' || event.kind === 'group_dm') {
    for (const list of config.dmLists) {
      if (!list.enabled) continue
      // A display name with parentheses ("Ali (work)") looks like a group DM title,
      // so a full-title match counts as a direct DM.
      if (event.kind === 'group_dm') {
        const direct = list.members.find((m) => senderMatches(event.raw.title, [m.name, ...m.aliases]))
        if (direct) return { matched: true, reason: `DM from ${direct.name} (list "${list.name}")` }
      }
      if (event.kind === 'group_dm' && !list.includeGroupDMs) continue
      for (const member of list.members) {
        if (senderMatches(event.sender, [member.name, ...member.aliases])) {
          const where = event.kind === 'group_dm' ? ` in group "${event.group}"` : ''
          return { matched: true, reason: `DM from ${member.name}${where} (list "${list.name}")` }
        }
      }
    }
    return { matched: false, reason: 'sender not on an enabled DM list' }
  }

  if (event.kind === 'channel') {
    for (const rule of config.mentionRules) {
      if (!rule.enabled) continue
      if (norm(rule.server) !== norm(event.server)) continue
      const channelOk =
        rule.channel.trim() === '' ||
        stripHash(rule.channel) === stripHash(event.channel ?? '') ||
        (event.parentChannel !== null && stripHash(rule.channel) === stripHash(event.parentChannel))
      if (!channelOk) continue
      const where = `${event.server} #${event.channel}`
      if (rule.mode === 'any') {
        return { matched: true, reason: `Message in ${where}` }
      }
      if (mentionsMe(event.text, config.me, rule.includeEveryone)) {
        return { matched: true, reason: `Mentioned in ${where} by ${event.sender}` }
      }
    }
    return { matched: false, reason: 'no mention rule matched' }
  }

  return { matched: false, reason: 'unrecognised notification' }
}
