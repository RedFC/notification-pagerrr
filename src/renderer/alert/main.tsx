import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { AppState, AlertRecord } from '../../shared/types'
import './alert.css'

function where(a: AlertRecord): string {
  const e = a.event
  if (e.kind === 'channel') return `${e.server} · #${e.channel}`
  if (e.kind === 'group_dm') return `Group DM · ${e.group}`
  return 'Direct message'
}

function Alert() {
  const [s, setS] = useState<AppState | null>(null)
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    void window.pager.getState().then(setS)
    return window.pager.onState(setS)
  }, [])

  const active = s?.activeAlert
  useEffect(() => {
    if (!active) return
    const tick = (): void => setElapsed(Math.floor((Date.now() - Date.parse(active.startedAt)) / 1000))
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [active?.startedAt])

  if (!s || !active) return null
  const missed = active.missed
  const alerts = [...active.alerts].reverse()
  const latest = alerts[0]
  const left = Math.max(0, s.config.buzzer.maxSeconds - elapsed)

  return (
    <div className={missed ? 'overlay missed' : 'overlay buzzing'}>
      <div className="card" role="alertdialog" aria-live="assertive">
        <div className="label">{missed ? `Missed ${alerts.length > 1 ? `(${alerts.length})` : ''}` : 'PAGE'}</div>
        <h1>{latest.event.sender ?? latest.event.raw.title}</h1>
        <div className="where">{where(latest)}</div>
        <p className="text">{latest.event.text}</p>
        <div className="reason">{latest.reason}</div>
        {alerts.length > 1 && (
          <ul className="more">
            {alerts.slice(1, 6).map((a) => (
              <li key={a.id}>
                <b>{a.event.sender}</b> · {where(a)} — {a.event.text.slice(0, 80)}
              </li>
            ))}
          </ul>
        )}
        <div className="actions">
          <button className="ack" autoFocus onClick={() => void window.pager.acknowledge()}>
            {missed ? 'Dismiss' : 'Acknowledge'}
          </button>
          <button onClick={() => void window.pager.openDiscord()}>Open Discord</button>
        </div>
        {!missed && (
          <div className="foot">
            Stops by itself in {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')} · {s.config.buzzer.hotkey.replace('CommandOrControl', '⌘')} to acknowledge
          </div>
        )}
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Alert />)
