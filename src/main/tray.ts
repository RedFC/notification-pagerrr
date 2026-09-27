import { Menu, Tray, nativeImage } from 'electron'
import { join } from 'node:path'
import type { AppState } from '../shared/types'
import { resourcesDir } from './windows'

export interface TrayActions {
  setEnabled: (on: boolean) => void
  snooze: (what: number | 'tomorrow' | null) => void
  acknowledge: () => void
  testBuzz: () => void
  openSettings: () => void
  startPairing: () => void
  quit: () => void
}

let tray: Tray | null = null

function icon(state: 'on' | 'off' | 'warn' | 'buzz'): Electron.NativeImage {
  const mac = process.platform === 'darwin'
  const img = nativeImage.createFromPath(join(resourcesDir(), 'icons', `tray-${state}${mac ? 'Template' : ''}.png`))
  if (mac) img.setTemplateImage(true)
  return img
}

const time = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'never'

export function updateTray(s: AppState, a: TrayActions): void {
  const c = s.config
  const snoozed = c.snoozeUntil && Date.parse(c.snoozeUntil) > Date.now()
  let state: 'on' | 'off' | 'warn' | 'buzz' = c.enabled && !snoozed ? 'on' : 'off'
  if (c.role === 'buzzer' && (s.link.state === 'stale' || s.link.state === 'unpaired')) state = 'warn'
  if (c.role === 'listener' && s.listener && (!s.listener.helperRunning || s.listener.helperError)) state = 'warn'
  if (s.activeAlert) state = 'buzz'

  if (!tray) tray = new Tray(icon(state))
  else tray.setImage(icon(state))

  const missed = s.activeAlert?.missed ? s.activeAlert.alerts.length : 0
  if (process.platform === 'darwin') tray.setTitle(missed ? String(missed) : '')

  const items: Electron.MenuItemConstructorOptions[] = []

  if (c.role === 'buzzer') {
    let status: string
    switch (s.link.state) {
      case 'unpaired': status = 'Not paired with a listener'; break
      case 'connecting': status = 'Connecting to listener…'; break
      case 'stale': status = `Listener silent (last heartbeat ${time(s.link.lastHeartbeat)})`; break
      case 'online':
        status = `Listener online · ${time(s.link.lastHeartbeat)}`
        if (!s.link.discordRunning) status += ' · Discord not running!'
        break
    }
    items.push({ label: status, enabled: false })
    if (s.activeAlert) items.push({ label: s.activeAlert.missed ? 'Dismiss missed alert' : 'Acknowledge buzz', click: a.acknowledge })
    items.push({ type: 'separator' })
    items.push({ label: 'Enabled', type: 'checkbox', checked: c.enabled, click: (m) => a.setEnabled(m.checked) })
    items.push({
      label: snoozed ? `Snoozed until ${time(c.snoozeUntil)}` : 'Snooze',
      submenu: [
        { label: '15 minutes', click: () => a.snooze(15) },
        { label: '1 hour', click: () => a.snooze(60) },
        { label: 'Until tomorrow 9 AM', click: () => a.snooze('tomorrow') },
        { type: 'separator' },
        { label: 'Cancel snooze', enabled: !!snoozed, click: () => a.snooze(null) }
      ]
    })
    items.push({ type: 'separator' })
    const recent = s.recentAlerts.slice(0, 20)
    items.push({
      label: 'Recent alerts',
      submenu: recent.length
        ? recent.map((r) => ({ label: `${time(r.at)}  ${r.status === 'missed' ? '✕' : r.status === 'acknowledged' ? '✓' : '●'}  ${r.reason}`.slice(0, 80), enabled: false }))
        : [{ label: 'None yet', enabled: false }]
    })
    items.push({ label: 'Test buzz', click: a.testBuzz })
  } else {
    const l = s.listener
    items.push({ label: l?.helperRunning && !l.helperError ? 'Capturing notifications' : `Helper: ${l?.helperError ?? 'not running'}`, enabled: false })
    items.push({ label: l?.discordRunning ? 'Discord running' : 'Discord not running!', enabled: false })
    items.push({ label: `Connected: ${l?.connectedDevices.join(', ') || 'none'}`, enabled: false })
    items.push({ type: 'separator' })
    items.push({ label: 'Start pairing…', click: a.startPairing })
  }

  items.push({ type: 'separator' })
  items.push({ label: 'Settings…', click: a.openSettings })
  items.push({ label: 'Quit Discord Pager', click: a.quit })

  tray.setToolTip('Discord Pager')
  tray.setContextMenu(Menu.buildFromTemplate(items))
}
