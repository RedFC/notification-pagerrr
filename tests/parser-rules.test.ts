import { describe, expect, it } from 'vitest'
import toasts from './fixtures/toasts.json'
import { isDiscordToast, parseDiscordToast } from '../src/main/listener/discordParser'
import { evaluate, mentionsMe } from '../src/main/buzzer/rules'
import { defaultConfig } from '../src/shared/config'
import type { Config, RawToast } from '../src/shared/types'

const byId = (id: string): RawToast => (toasts as RawToast[]).find((t) => t.id === id)!
const parse = (id: string) => parseDiscordToast(byId(id), '2026-09-27T10:00:00Z')

function config(patch: Partial<Config> = {}): Config {
  return {
    ...defaultConfig('darwin', 'mac', 'Mac'),
    me: ['REDFC', 'red'],
    dmLists: [
      { id: 'l1', name: 'Clients', enabled: true, includeGroupDMs: false, members: [{ name: 'Ahmed', aliases: [] }, { name: 'Ali (work)', aliases: [] }] },
      { id: 'l2', name: 'Off list', enabled: false, includeGroupDMs: false, members: [{ name: 'Zain', aliases: [] }] }
    ],
    mentionRules: [
      { id: 'r1', server: 'V4Tech', channel: 'alerts', mode: 'mention', includeEveryone: false, enabled: true },
      { id: 'r2', server: 'Server, With Comma', channel: '', mode: 'mention', includeEveryone: true, enabled: true }
    ],
    ...patch
  }
}

describe('parser', () => {
  it('filters to Discord', () => {
    expect(isDiscordToast(byId('1'))).toBe(true)
    expect(isDiscordToast(byId('7'))).toBe(false)
  })
  it('parses a DM', () => {
    expect(parse('1')).toMatchObject({ kind: 'dm', sender: 'Ahmed', text: 'server is down, call me' })
  })
  it('parses a server channel message', () => {
    expect(parse('2')).toMatchObject({ kind: 'channel', sender: 'Taha', channel: 'alerts', server: 'V4Tech', parentChannel: null })
  })
  it('parses a thread message', () => {
    expect(parse('3')).toMatchObject({ kind: 'channel', sender: 'Moiz', channel: 'bug-123', parentChannel: 'alerts', server: 'V4Tech' })
  })
  it('parses a group DM', () => {
    expect(parse('4')).toMatchObject({ kind: 'group_dm', sender: 'Ahmed', group: 'Client Group' })
  })
  it('keeps commas in server names', () => {
    expect(parse('5')).toMatchObject({ kind: 'channel', channel: 'general', server: 'Server, With Comma' })
  })
  it('marks Discord system toasts unknown', () => {
    expect(parse('6').kind).toBe('unknown')
  })
})

describe('mentionsMe', () => {
  it('matches @name case-insensitively and not as a prefix', () => {
    expect(mentionsMe('hey @redfc', ['REDFC'], false)).toBe(true)
    expect(mentionsMe('hey @REDFCX', ['REDFC'], false)).toBe(false)
    expect(mentionsMe('hey redfc', ['REDFC'], false)).toBe(false)
  })
  it('handles @everyone only when enabled', () => {
    expect(mentionsMe('@everyone go', ['REDFC'], false)).toBe(false)
    expect(mentionsMe('@here go', ['REDFC'], true)).toBe(true)
  })
})

describe('rules', () => {
  it('buzzes on a DM from a watched member', () => {
    expect(evaluate(parse('1'), config()).matched).toBe(true)
  })
  it('ignores DMs from members on a disabled list', () => {
    const e = { ...parse('1'), sender: 'Zain', raw: { title: 'Zain', body: '' } }
    expect(evaluate(e, config()).matched).toBe(false)
  })
  it('matches aliases', () => {
    const c = config({ dmLists: [{ id: 'l', name: 'L', enabled: true, includeGroupDMs: false, members: [{ name: 'Ahmed Khan', aliases: ['ahmed'] }] }] })
    expect(evaluate(parse('1'), c).matched).toBe(true)
  })
  it('skips group DMs unless the list includes them', () => {
    expect(evaluate(parse('4'), config()).matched).toBe(false)
    const c = config()
    c.dmLists[0].includeGroupDMs = true
    expect(evaluate(parse('4'), c).matched).toBe(true)
  })
  it('treats a parenthesised display name as a DM', () => {
    expect(evaluate(parse('8'), config()).matched).toBe(true)
  })
  it('buzzes on a mention in a watched channel', () => {
    expect(evaluate(parse('2'), config()).matched).toBe(true)
  })
  it('matches a thread by its parent channel', () => {
    expect(evaluate(parse('3'), config()).matched).toBe(true)
  })
  it('does not buzz without a mention', () => {
    const e = { ...parse('2'), text: 'no ping here' }
    expect(evaluate(e, config()).matched).toBe(false)
  })
  it('any-channel rule with @everyone', () => {
    expect(evaluate(parse('5'), config()).matched).toBe(true)
  })
  it('mode any buzzes without a mention', () => {
    const c = config()
    c.mentionRules[0].mode = 'any'
    expect(evaluate({ ...parse('2'), text: 'hello' }, c).matched).toBe(true)
  })
  it('ignores disabled rules and other servers', () => {
    const c = config()
    c.mentionRules[0].enabled = false
    expect(evaluate(parse('2'), c).matched).toBe(false)
    expect(evaluate({ ...parse('2'), server: 'Other' }, config()).matched).toBe(false)
  })
})
