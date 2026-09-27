import { BrowserWindow, globalShortcut, screen } from 'electron'
import type { AlertRecord, BuzzerSettings, PagerEvent } from '../../shared/types'
import { randomId } from '../crypto'
import { loadPage, preloadPath } from '../windows'

export interface ActiveAlert { alerts: AlertRecord[]; startedAt: string; missed: boolean }

interface Options {
  settings: () => BuzzerSettings
  onChange: () => void
  onRecord: (r: AlertRecord) => void
  log: (msg: string) => void
}

/**
 * Owns the buzz: looping sound (in a hidden window, so it plays even when macOS
 * Focus is on) plus a flashing always-on-top window on every display.
 */
export class AlertController {
  active: ActiveAlert | null = null
  private windows: BrowserWindow[] = []
  private soundWin: BrowserWindow | null = null
  private timer: NodeJS.Timeout | null = null
  private hotkey: string | null = null

  constructor(private o: Options) {}

  init(): void {
    this.soundWin = new BrowserWindow({
      show: false,
      webPreferences: { preload: preloadPath(), backgroundThrottling: false, sandbox: false }
    })
    loadPage(this.soundWin, 'sound')
  }

  trigger(event: PagerEvent, reason: string): void {
    const record: AlertRecord = { id: randomId(), event, reason, at: new Date().toISOString(), status: 'buzzing' }
    this.o.onRecord(record)

    if (this.active && !this.active.missed) {
      // Already buzzing: add to the list, keep the original 3-minute clock.
      this.active.alerts.push(record)
      this.o.onChange()
      return
    }

    // A missed card may be on screen; the new alert replaces it but keeps its items.
    const earlier = this.active?.alerts ?? []
    this.closeWindows()
    this.active = { alerts: [...earlier, record], startedAt: record.at, missed: false }
    this.playSound('buzz')
    this.openWindows()
    this.registerHotkey()
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.markMissed(), this.o.settings().maxSeconds * 1000)
    this.o.onChange()
  }

  acknowledge(): void {
    if (!this.active) return
    for (const a of this.active.alerts) if (a.status === 'buzzing') a.status = 'acknowledged'
    this.o.onChange()
    this.clear()
  }

  /** Close the "missed" card. */
  dismiss(): void {
    this.clear()
  }

  chime(): void {
    this.playSound('chime')
  }

  private clear(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.stopSound()
    this.unregisterHotkey()
    this.closeWindows()
    this.active = null
    this.o.onChange()
  }

  private markMissed(): void {
    if (!this.active) return
    this.stopSound()
    this.unregisterHotkey()
    for (const a of this.active.alerts) if (a.status === 'buzzing') a.status = 'missed'
    this.active.missed = true
    // Keep one small card on the primary display instead of full-screen overlays.
    const [first, ...rest] = this.windows
    rest.forEach((w) => w.destroy())
    this.windows = first ? [first] : []
    if (first && !first.isDestroyed()) {
      const wa = screen.getPrimaryDisplay().workArea
      first.setIgnoreMouseEvents(false)
      first.setBounds({ x: wa.x + wa.width - 400, y: wa.y + 16, width: 384, height: 320 })
    }
    this.o.onChange()
  }

  private openWindows(): void {
    const displays = screen.getAllDisplays()
    const primaryId = screen.getPrimaryDisplay().id
    const ordered = [...displays].sort((a, b) => (a.id === primaryId ? -1 : b.id === primaryId ? 1 : 0))
    for (const d of ordered) {
      const b = d.workArea
      const win = new BrowserWindow({
        x: b.x, y: b.y, width: b.width, height: b.height,
        frame: false, transparent: true, resizable: false, movable: false,
        minimizable: false, maximizable: false, fullscreenable: false,
        skipTaskbar: true, alwaysOnTop: true, hasShadow: false, focusable: true, show: false,
        webPreferences: { preload: preloadPath(), sandbox: false }
      })
      win.setAlwaysOnTop(true, 'screen-saver')
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
      loadPage(win, 'alert')
      win.once('ready-to-show', () => win.showInactive())
      this.windows.push(win)
    }
  }

  private closeWindows(): void {
    for (const w of this.windows) if (!w.isDestroyed()) w.destroy()
    this.windows = []
  }

  private playSound(kind: 'buzz' | 'chime'): void {
    const s = this.o.settings()
    this.soundWin?.webContents.send('sound:play', { kind, tone: s.tone, volume: s.volume })
  }

  private stopSound(): void {
    this.soundWin?.webContents.send('sound:stop')
  }

  private registerHotkey(): void {
    const key = this.o.settings().hotkey
    if (!key) return
    try {
      if (globalShortcut.register(key, () => this.acknowledge())) this.hotkey = key
      else this.o.log(`could not register hotkey ${key}`)
    } catch (e) {
      this.o.log(`invalid hotkey ${key}: ${(e as Error).message}`)
    }
  }

  private unregisterHotkey(): void {
    if (this.hotkey) globalShortcut.unregister(this.hotkey)
    this.hotkey = null
  }
}
