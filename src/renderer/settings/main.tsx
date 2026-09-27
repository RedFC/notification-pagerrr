import { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { AppState, Config, DmList, MentionRule, PagerEvent } from '../../shared/types'
import './settings.css'

const uid = (): string => Math.random().toString(36).slice(2, 10)
const fmtTime = (iso: string | null | undefined): string =>
  iso ? new Date(iso).toLocaleString([], { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' }) : '—'
const splitNames = (s: string): string[] => s.split(',').map((x) => x.trim()).filter(Boolean)

type Tab = 'general' | 'dms' | 'mentions' | 'buzzer' | 'pairing' | 'recent'

function App() {
  const [s, setS] = useState<AppState | null>(null)
  const [tab, setTab] = useState<Tab>('general')

  useEffect(() => {
    void window.pager.getState().then(setS)
    return window.pager.onState(setS)
  }, [])

  if (!s) return <div className="loading">Loading…</div>
  const buzzer = s.config.role === 'buzzer'
  const tabs: Array<[Tab, string]> = buzzer
    ? [['general', 'General'], ['dms', 'DM watchlists'], ['mentions', 'Mention rules'], ['buzzer', 'Buzzer'], ['pairing', 'Pairing'], ['recent', 'Recent notifications']]
    : [['general', 'General'], ['pairing', 'Pairing'], ['recent', 'Captured notifications']]

  return (
    <div className="app">
      <nav>
        <div className="brand">
          Discord Pager
          <span className="role">{buzzer ? 'Buzzer' : 'Listener'}</span>
        </div>
        {tabs.map(([id, label]) => (
          <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
        <StatusPill s={s} />
      </nav>
      <main>
        {tab === 'general' && <General s={s} />}
        {tab === 'dms' && <DmLists s={s} />}
        {tab === 'mentions' && <MentionRules s={s} />}
        {tab === 'buzzer' && <BuzzerTab s={s} />}
        {tab === 'pairing' && (buzzer ? <BuzzerPairing s={s} /> : <ListenerPairing s={s} />)}
        {tab === 'recent' && <Recent s={s} />}
      </main>
    </div>
  )
}

function StatusPill({ s }: { s: AppState }) {
  let text: string
  let cls = 'ok'
  if (s.config.role === 'buzzer') {
    const l = s.link
    if (l.state === 'online') {
      text = l.discordRunning ? 'Listener online' : 'Online · Discord not running'
      if (!l.discordRunning || !l.helperRunning) cls = 'warn'
    } else if (l.state === 'connecting') { text = 'Connecting…'; cls = 'warn' }
    else if (l.state === 'stale') { text = 'Listener silent'; cls = 'bad' }
    else { text = 'Not paired'; cls = 'bad' }
    const snoozed = s.config.snoozeUntil && Date.parse(s.config.snoozeUntil) > Date.now()
    if (!s.config.enabled) { text += ' · Disabled'; cls = 'warn' }
    else if (snoozed) { text += ' · Snoozed'; cls = 'warn' }
  } else {
    const l = s.listener
    if (!l) { text = 'Starting…'; cls = 'warn' }
    else if (l.helperError) { text = 'Helper problem'; cls = 'bad' }
    else if (!l.helperRunning) { text = 'Helper stopped'; cls = 'bad' }
    else if (!l.discordRunning) { text = 'Discord not running'; cls = 'warn' }
    else text = `Capturing · ${l.connectedDevices.length} connected`
  }
  return <div className={`pill ${cls}`}>{text}</div>
}

// ───────────── General ─────────────

function General({ s }: { s: AppState }) {
  const c = s.config
  const [name, setName] = useState(c.deviceName)
  const [me, setMe] = useState(c.me.join(', '))
  const snoozed = c.snoozeUntil && Date.parse(c.snoozeUntil) > Date.now()

  return (
    <section>
      <h2>General</h2>
      {c.role === 'buzzer' && (
        <>
          <div className="row big">
            <label className="switch">
              <input type="checkbox" checked={c.enabled} onChange={(e) => void window.pager.setEnabled(e.target.checked)} />
              <span>Pager {c.enabled ? 'enabled' : 'disabled'}</span>
            </label>
          </div>
          <div className="row">
            <span className="muted">{snoozed ? `Snoozed until ${fmtTime(c.snoozeUntil)}` : 'Snooze:'}</span>
            <button onClick={() => void window.pager.snooze(15)}>15 min</button>
            <button onClick={() => void window.pager.snooze(60)}>1 hour</button>
            <button onClick={() => void window.pager.snooze('tomorrow')}>Until 9 AM</button>
            {snoozed && <button onClick={() => void window.pager.snooze(null)}>Cancel snooze</button>}
          </div>
          <Field label="My Discord names" hint="Your display name and any server nicknames, comma-separated. Used to spot @mentions of you.">
            <input value={me} onChange={(e) => setMe(e.target.value)} onBlur={() => void window.pager.saveConfig({ me: splitNames(me) })} placeholder="REDFC, red" />
          </Field>
        </>
      )}
      <Field label="This device's name">
        <input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => void window.pager.saveConfig({ deviceName: name.trim() || c.deviceName })} />
      </Field>
      <Field label="Launch at login">
        <input type="checkbox" checked={c.launchAtLogin} onChange={(e) => void window.pager.saveConfig({ launchAtLogin: e.target.checked })} />
      </Field>
      <Field label="Role" hint="Listener captures Discord notifications (Windows). Buzzer receives them and buzzes (Mac). Changing this restarts the app.">
        <select
          value={c.role}
          onChange={(e) => {
            if (window.confirm('Switch role and restart the app?')) void window.pager.saveConfig({ role: e.target.value as Config['role'] })
          }}
        >
          <option value="buzzer">Buzzer</option>
          <option value="listener" disabled={s.platform !== 'win32'}>Listener{s.platform !== 'win32' ? ' (Windows only)' : ''}</option>
        </select>
      </Field>
    </section>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <label>{label}</label>
      <div>
        {children}
        {hint && <div className="hint">{hint}</div>}
      </div>
    </div>
  )
}

// ───────────── Draft helper: edit locally, save explicitly ─────────────

function useDraft<T>(value: T): [T, (v: T) => void, boolean, () => void] {
  const [draft, setDraft] = useState<T>(value)
  const [dirty, setDirty] = useState(false)
  const key = JSON.stringify(value)
  useEffect(() => {
    if (!dirty) setDraft(value)
  }, [key])
  return [draft, (v) => { setDraft(v); setDirty(true) }, dirty, () => setDirty(false)]
}

function SaveBar({ dirty, onSave, onReset }: { dirty: boolean; onSave: () => void; onReset: () => void }) {
  if (!dirty) return null
  return (
    <div className="savebar">
      Unsaved changes
      <button onClick={onReset}>Discard</button>
      <button className="primary" onClick={onSave}>Save</button>
    </div>
  )
}

// ───────────── DM watchlists ─────────────

function DmLists({ s }: { s: AppState }) {
  const [lists, setLists, dirty, clean] = useDraft<DmList[]>(s.config.dmLists)
  const update = (i: number, patch: Partial<DmList>): void => setLists(lists.map((l, j) => (j === i ? { ...l, ...patch } : l)))

  return (
    <section>
      <h2>DM watchlists</h2>
      <p className="muted">A DM from anyone on an enabled list buzzes. Names must match what Discord shows as the notification title; the Recent tab helps you add them exactly.</p>
      {lists.map((l, i) => (
        <div className="card" key={l.id}>
          <div className="row">
            <input className="title" value={l.name} onChange={(e) => update(i, { name: e.target.value })} />
            <label className="switch small"><input type="checkbox" checked={l.enabled} onChange={(e) => update(i, { enabled: e.target.checked })} /><span>Enabled</span></label>
            <label className="switch small"><input type="checkbox" checked={l.includeGroupDMs} onChange={(e) => update(i, { includeGroupDMs: e.target.checked })} /><span>Include group DMs</span></label>
            <button className="danger" onClick={() => setLists(lists.filter((_, j) => j !== i))}>Delete list</button>
          </div>
          <table>
            <thead><tr><th>Display name</th><th>Aliases (comma-separated)</th><th /></tr></thead>
            <tbody>
              {l.members.map((m, k) => (
                <tr key={k}>
                  <td><input value={m.name} onChange={(e) => update(i, { members: l.members.map((x, y) => (y === k ? { ...x, name: e.target.value } : x)) })} /></td>
                  <td><AliasInput value={m.aliases} onChange={(aliases) => update(i, { members: l.members.map((x, y) => (y === k ? { ...x, aliases } : x)) })} /></td>
                  <td><button onClick={() => update(i, { members: l.members.filter((_, y) => y !== k) })}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <button onClick={() => update(i, { members: [...l.members, { name: '', aliases: [] }] })}>+ Add member</button>
        </div>
      ))}
      <button onClick={() => setLists([...lists, { id: uid(), name: `List ${lists.length + 1}`, enabled: true, includeGroupDMs: false, members: [] }])}>+ New list</button>
      <SaveBar
        dirty={dirty}
        onReset={() => { setLists(s.config.dmLists); clean() }}
        onSave={() => {
          const cleaned = lists.map((l) => ({ ...l, name: l.name.trim() || 'Untitled', members: l.members.filter((m) => m.name.trim()).map((m) => ({ ...m, name: m.name.trim() })) }))
          void window.pager.saveConfig({ dmLists: cleaned }).then(clean)
        }}
      />
    </section>
  )
}

function AliasInput({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = useState(value.join(', '))
  return <input value={text} onChange={(e) => setText(e.target.value)} onBlur={() => onChange(splitNames(text))} />
}

// ───────────── Mention rules ─────────────

function MentionRules({ s }: { s: AppState }) {
  const [rules, setRules, dirty, clean] = useDraft<MentionRule[]>(s.config.mentionRules)
  const update = (i: number, patch: Partial<MentionRule>): void => setRules(rules.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  return (
    <section>
      <h2>Mention rules</h2>
      <p className="muted">
        Buzz when you're @mentioned in these server channels. Leave the channel empty for any channel in the server.
        {s.config.me.length === 0 && <b className="warntext"> Set "My Discord names" in General first, or mentions can't be detected.</b>}
      </p>
      <table>
        <thead><tr><th>Server</th><th>Channel</th><th>Buzz on</th><th>@everyone / @here</th><th>On</th><th /></tr></thead>
        <tbody>
          {rules.map((r, i) => (
            <tr key={r.id}>
              <td><input value={r.server} onChange={(e) => update(i, { server: e.target.value })} placeholder="Server name" /></td>
              <td><input value={r.channel} onChange={(e) => update(i, { channel: e.target.value.replace(/^#/, '') })} placeholder="any channel" /></td>
              <td>
                <select value={r.mode} onChange={(e) => update(i, { mode: e.target.value as MentionRule['mode'] })}>
                  <option value="mention">@mentions of me</option>
                  <option value="any">every message</option>
                </select>
              </td>
              <td><input type="checkbox" checked={r.includeEveryone} disabled={r.mode === 'any'} onChange={(e) => update(i, { includeEveryone: e.target.checked })} /></td>
              <td><input type="checkbox" checked={r.enabled} onChange={(e) => update(i, { enabled: e.target.checked })} /></td>
              <td><button onClick={() => setRules(rules.filter((_, j) => j !== i))}>Remove</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button onClick={() => setRules([...rules, { id: uid(), server: '', channel: '', mode: 'mention', includeEveryone: false, enabled: true }])}>+ Add rule</button>
      <SaveBar
        dirty={dirty}
        onReset={() => { setRules(s.config.mentionRules); clean() }}
        onSave={() => void window.pager.saveConfig({ mentionRules: rules.filter((r) => r.server.trim()).map((r) => ({ ...r, server: r.server.trim(), channel: r.channel.trim() })) }).then(clean)}
      />
    </section>
  )
}

// ───────────── Buzzer ─────────────

function BuzzerTab({ s }: { s: AppState }) {
  const b = s.config.buzzer
  const save = (patch: Partial<Config['buzzer']>): void => void window.pager.saveConfig({ buzzer: { ...b, ...patch } })
  const [hotkey, setHotkey] = useState(b.hotkey)
  return (
    <section>
      <h2>Buzzer</h2>
      <Field label="Tone">
        <select value={b.tone} onChange={(e) => save({ tone: e.target.value as Config['buzzer']['tone'] })}>
          <option value="pager">Classic pager beep</option>
          <option value="alarm">Two-tone alarm</option>
          <option value="chirp">Rising chirp</option>
        </select>
      </Field>
      <Field label={`Volume · ${Math.round(b.volume * 100)}%`} hint="The app plays its own sound, so it rings even with Focus / Do Not Disturb on. The Mac's system volume still applies.">
        <input type="range" min={0.1} max={1} step={0.05} value={b.volume} onChange={(e) => save({ volume: Number(e.target.value) })} />
      </Field>
      <Field label="Stop after" hint="Buzzing stops by itself after this long and the alert shows as missed.">
        <select value={b.maxSeconds} onChange={(e) => save({ maxSeconds: Number(e.target.value) })}>
          {[30, 60, 120, 180].map((n) => <option key={n} value={n}>{n < 60 ? `${n} seconds` : `${n / 60} minute${n > 60 ? 's' : ''}`}</option>)}
        </select>
      </Field>
      <Field label="Acknowledge hotkey" hint="Electron accelerator format, e.g. CommandOrControl+Shift+. — active only while buzzing.">
        <input value={hotkey} onChange={(e) => setHotkey(e.target.value)} onBlur={() => save({ hotkey: hotkey.trim() })} />
      </Field>
      <div className="row">
        <button className="primary" onClick={() => void window.pager.testBuzz()}>Test buzz</button>
      </div>
    </section>
  )
}

// ───────────── Pairing ─────────────

function ListenerPairing({ s }: { s: AppState }) {
  const l = s.listener
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  if (!l) return <section><h2>Pairing</h2><p>Starting…</p></section>
  const left = l.pairing.expiresAt ? Math.max(0, Math.round((Date.parse(l.pairing.expiresAt) - now) / 1000)) : 0

  return (
    <section>
      <h2>Pairing</h2>
      <p className="muted">Listening on port {l.port}. Pair your Mac once; after that it reconnects on its own.</p>
      {l.pairing.active ? (
        <div className="card center">
          {l.pairing.code ? (
            <>
              <div className="muted">Type this code on your Mac</div>
              <div className="code">{l.pairing.code.slice(0, 3)} {l.pairing.code.slice(3)}</div>
            </>
          ) : (
            <div>Waiting for the Mac… In the Mac's Pairing tab, pick <b>{s.config.deviceName}</b>.</div>
          )}
          <div className="muted">Pairing closes in {left}s</div>
          <button onClick={() => void window.pager.listenerPairStop()}>Cancel</button>
        </div>
      ) : (
        <button className="primary" onClick={() => void window.pager.listenerPairStart()}>Start pairing</button>
      )}
      <h3>Paired buzzers</h3>
      {s.config.pairedDevices.length === 0 && <p className="muted">None yet.</p>}
      <table>
        <tbody>
          {s.config.pairedDevices.map((d) => (
            <tr key={d.id}>
              <td><b>{d.name}</b></td>
              <td className="muted">paired {fmtTime(d.pairedAt)}</td>
              <td>{l.connectedDevices.includes(d.name) ? <span className="pill ok">connected</span> : <span className="pill warn">offline</span>}</td>
              <td><button className="danger" onClick={() => void window.pager.listenerRemoveDevice(d.id)}>Remove</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Health</h3>
      <ul className="health">
        <li>Notification helper: {l.helperRunning ? 'running' : 'stopped'}{l.helperError && <b className="warntext"> — {l.helperError}</b>}</li>
        <li>Discord: {l.discordRunning ? 'running' : <b className="warntext">not running</b>}</li>
        <li>Last Discord notification: {fmtTime(l.lastToastAt)}</li>
      </ul>
    </section>
  )
}

function BuzzerPairing({ s }: { s: AppState }) {
  const [target, setTarget] = useState<{ host: string; port: number; name: string } | null>(null)
  const [manual, setManual] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const l = s.config.listener

  const begin = async (host: string, port: number, name: string): Promise<void> => {
    setBusy(true); setMsg(null)
    const r = await window.pager.pairBegin(host, port)
    setBusy(false)
    if (r.ok) { setTarget({ host, port, name: r.listenerName ?? name }); setCode('') }
    else setMsg(r.error ?? 'Could not reach the listener')
  }
  const doConfirm = async (): Promise<void> => {
    if (!target) return
    setBusy(true)
    const r = await window.pager.pairConfirm(code, target.host, target.port)
    setBusy(false)
    setTarget(null)
    setMsg(r.ok ? 'Paired.' : r.error ?? 'Pairing failed')
  }

  return (
    <section>
      <h2>Pairing</h2>
      {l && (
        <div className="card">
          <div className="row">
            <div>
              <b>{l.name}</b> <span className="muted">{l.host}:{l.port}</span>
              <div className="muted">
                {s.link.state === 'online' && `Online · last heartbeat ${fmtTime(s.link.lastHeartbeat)}${s.link.helperRunning ? '' : ' · helper not running'}${s.link.discordRunning ? '' : ' · Discord not running'}`}
                {s.link.state === 'connecting' && 'Connecting…'}
                {s.link.state === 'stale' && `No heartbeat since ${fmtTime(s.link.lastHeartbeat)}`}
              </div>
            </div>
            <button className="danger" onClick={() => { if (window.confirm('Unpair this listener?')) void window.pager.unpair() }}>Unpair</button>
          </div>
        </div>
      )}

      {target ? (
        <div className="card center">
          <div>On <b>{target.name}</b>, a 6-digit code is now showing.</div>
          <input className="codeinput" autoFocus inputMode="numeric" maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} placeholder="000 000" />
          <div className="row">
            <button onClick={() => { void window.pager.pairCancel(); setTarget(null) }}>Cancel</button>
            <button className="primary" disabled={busy || code.replace(/\D/g, '').length !== 6} onClick={() => void doConfirm()}>Pair</button>
          </div>
        </div>
      ) : (
        <>
          <h3>{l ? 'Pair with a different listener' : 'Listeners on your network'}</h3>
          <p className="muted">First click <b>Start pairing</b> in the app on the Windows box, then pick it here.</p>
          {s.discovered.length === 0 && <p className="muted">Searching…</p>}
          <ul className="list">
            {s.discovered.map((d) => (
              <li key={d.id}>
                <span><b>{d.name}</b> <span className="muted">{d.host}:{d.port}</span></span>
                <button disabled={busy} onClick={() => void begin(d.host, d.port, d.name)}>Pair</button>
              </li>
            ))}
          </ul>
          <div className="row">
            <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="Or enter IP:port, e.g. 192.168.1.20:47821" />
            <button disabled={busy || !manual.trim()} onClick={() => {
              const [host, port] = manual.trim().split(':')
              void begin(host, Number(port) || 47821, host)
            }}>Pair</button>
          </div>
        </>
      )}
      {msg && <p className={msg === 'Paired.' ? 'oktext' : 'warntext'}>{msg}</p>}
    </section>
  )
}

// ───────────── Recent notifications ─────────────

function Recent({ s }: { s: AppState }) {
  const buzzer = s.config.role === 'buzzer'
  const [toast, setToast] = useState<string | null>(null)
  const lists = s.config.dmLists

  const addSender = (e: PagerEvent, listId: string): void => {
    const name = e.kind === 'dm' ? e.raw.title : e.sender ?? ''
    const next = lists.map((l) => (l.id === listId && !l.members.some((m) => m.name === name) ? { ...l, members: [...l.members, { name, aliases: [] }] } : l))
    void window.pager.saveConfig({ dmLists: next })
    setToast(`Added ${name}`)
  }
  const addNewList = (e: PagerEvent): void => {
    const name = e.kind === 'dm' ? e.raw.title : e.sender ?? ''
    void window.pager.saveConfig({ dmLists: [...lists, { id: uid(), name: 'Watchlist', enabled: true, includeGroupDMs: false, members: [{ name, aliases: [] }] }] })
    setToast(`Added ${name} to a new list`)
  }
  const addRule = (e: PagerEvent): void => {
    const channel = e.parentChannel ?? e.channel ?? ''
    if (s.config.mentionRules.some((r) => r.server === e.server && r.channel === channel)) return setToast('Rule already exists')
    void window.pager.saveConfig({ mentionRules: [...s.config.mentionRules, { id: uid(), server: e.server ?? '', channel, mode: 'mention', includeEveryone: false, enabled: true }] })
    setToast(`Added rule for ${e.server} #${channel}`)
  }

  const alertIds = useMemo(() => new Map(s.recentAlerts.map((a) => [a.event.id, a])), [s.recentAlerts])

  return (
    <section>
      <h2>{buzzer ? 'Recent notifications' : 'Captured notifications'}</h2>
      <p className="muted">
        {buzzer
          ? 'The last 50 Discord notifications from the listener, whether or not they buzzed.'
          : 'The last 50 Discord notifications this box captured and forwarded.'}
      </p>
      {!buzzer && (
        <div className="row">
          <label className="switch small">
            <input type="checkbox" checked={s.config.captureLog} onChange={(e) => void window.pager.saveConfig({ captureLog: e.target.checked })} />
            <span>Write every notification (all apps) to a capture log</span>
          </label>
          <button onClick={() => void window.pager.openCaptureLog()}>Show log file</button>
        </div>
      )}
      {toast && <div className="toast" onAnimationEnd={() => setToast(null)}>{toast}</div>}
      <table className="events">
        <thead><tr><th>Time</th><th>Type</th><th>From / where</th><th>Message</th>{buzzer && <th />}</tr></thead>
        <tbody>
          {s.recentEvents.length === 0 && <tr><td colSpan={5} className="muted">Nothing yet.</td></tr>}
          {s.recentEvents.map((e) => {
            const alert = alertIds.get(e.id)
            return (
              <tr key={e.id} className={alert ? 'buzzed' : ''}>
                <td className="nowrap">{fmtTime(e.receivedAt)}</td>
                <td>{e.kind === 'group_dm' ? 'group' : e.kind}{alert && <div className="pill bad">{alert.status}</div>}</td>
                <td>
                  <b>{e.sender ?? e.raw.title}</b>
                  {e.kind === 'channel' && <div className="muted">{e.server} · #{e.channel}{e.parentChannel ? ` (in #${e.parentChannel})` : ''}</div>}
                  {e.kind === 'group_dm' && <div className="muted">{e.group}</div>}
                </td>
                <td className="msg">{e.text}</td>
                {buzzer && (
                  <td className="nowrap">
                    {(e.kind === 'dm' || e.kind === 'group_dm') && (
                      <select value="" onChange={(ev) => (ev.target.value === '__new' ? addNewList(e) : addSender(e, ev.target.value))}>
                        <option value="" disabled>Add sender to…</option>
                        {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                        <option value="__new">New list</option>
                      </select>
                    )}
                    {e.kind === 'channel' && <button onClick={() => addRule(e)}>Add channel as rule</button>}
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </section>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
