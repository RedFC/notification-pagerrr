import { app, BrowserWindow, ipcMain, Notification, shell } from 'electron'
import { appendFile } from 'node:fs'
import { join } from 'node:path'
import { MAX_RECENT_ALERTS, MAX_RECENT_EVENTS } from '../shared/config'
import type { AlertRecord, AppState, Config, LinkStatus, ListenerTarget, PagerEvent } from '../shared/types'
import { AlertController } from './buzzer/alertController'
import { evaluate } from './buzzer/rules'
import { advertise, browse, shutdownDiscovery } from './discovery'
import { BuzzerClient, ListenerServer, beginPairing } from './link'
import { isDiscordToast, parseDiscordToast } from './listener/discordParser'
import { NotificationHelper, watchDiscordProcess } from './listener/helperProcess'
import { captureLogPath, loadConfig, loadHistory, saveConfig, saveHistory, type History } from './store'
import { updateTray } from './tray'
import { loadPage, preloadPath } from './windows'

// The buzzer must be able to play sound without a click first.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

if (!app.requestSingleInstanceLock()) app.quit()

let config: Config
let history: History = { recentEvents: [], recentAlerts: [] }
let link: LinkStatus = { state: 'unpaired' }
let discovered: ListenerTarget[] = []
let settingsWin: BrowserWindow | null = null
const cleanups: Array<() => void> = []

// Listener side
let server: ListenerServer | null = null
let helper: NotificationHelper | null = null
let discordRunning = false
let listenerPort = 0

// Buzzer side
let alerts: AlertController | null = null
let client: BuzzerClient | null = null
let pendingPair: Awaited<ReturnType<typeof beginPairing>> | null = null

function log(msg: string): void {
  const line = `${new Date().toISOString()} ${msg}`
  console.log(line)
  appendFile(join(app.getPath('userData'), 'pager.log'), line + '\n', () => {})
}

// ───────────── state ─────────────

function state(): AppState {
  return {
    config: { ...config, listener: config.listener ? { ...config.listener, key: '' } : null, pairedDevices: config.pairedDevices.map((d) => ({ ...d, key: '' })) },
    platform: process.platform,
    link,
    listener: server
      ? {
          helperRunning: helper?.running ?? false,
          helperError: helper?.error ?? null,
          discordRunning,
          lastToastAt: helper?.lastToastAt ?? null,
          connectedDevices: server.connectedDevices(),
          pairing: {
            active: server.pairing.active,
            code: server.pairing.code,
            expiresAt: server.pairing.expiresAt ? new Date(server.pairing.expiresAt).toISOString() : null
          },
          port: listenerPort
        }
      : null,
    discovered,
    recentEvents: history.recentEvents,
    recentAlerts: history.recentAlerts,
    activeAlert: alerts?.active ?? null
  }
}

let historyTimer: NodeJS.Timeout | null = null
function saveHistorySoon(): void {
  if (historyTimer) return
  historyTimer = setTimeout(() => {
    historyTimer = null
    saveHistory(history)
  }, 1000)
}

function refresh(): void {
  const s = state()
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('state', s)
  updateTray(s, trayActions)
}

function persist(): void {
  saveConfig(config)
  refresh()
}

function pushEvent(e: PagerEvent): void {
  history.recentEvents = [e, ...history.recentEvents].slice(0, MAX_RECENT_EVENTS)
  saveHistorySoon()
}

const isSnoozed = (): boolean => !!config.snoozeUntil && Date.parse(config.snoozeUntil) > Date.now()

// ───────────── actions ─────────────

function setEnabled(on: boolean): void {
  config.enabled = on
  persist()
}

function snooze(what: number | 'tomorrow' | null): void {
  if (what === null) config.snoozeUntil = null
  else if (what === 'tomorrow') {
    const d = new Date()
    d.setDate(d.getDate() + 1)
    d.setHours(9, 0, 0, 0)
    config.snoozeUntil = d.toISOString()
  } else config.snoozeUntil = new Date(Date.now() + what * 60_000).toISOString()
  persist()
}

function testBuzz(): void {
  const now = new Date().toISOString()
  alerts?.trigger(
    { id: `test-${now}`, source: 'discord', kind: 'dm', sender: 'Test', group: null, server: null, channel: null, parentChannel: null, text: 'This is a test buzz. Press Acknowledge to stop it.', raw: { title: 'Test', body: '' }, receivedAt: now },
    'Test buzz'
  )
}

function openSettings(): void {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show()
    settingsWin.focus()
  } else {
    settingsWin = new BrowserWindow({
      width: 900, height: 680, minWidth: 720, minHeight: 520,
      title: 'Discord Pager', show: false,
      webPreferences: { preload: preloadPath(), sandbox: false }
    })
    settingsWin.setMenuBarVisibility(false)
    loadPage(settingsWin, 'settings')
    settingsWin.once('ready-to-show', () => settingsWin?.show())
    settingsWin.on('closed', () => (settingsWin = null))
  }
  if (process.platform === 'darwin') app.focus({ steal: true })
}

const trayActions = {
  setEnabled,
  snooze,
  acknowledge: () => (alerts?.active?.missed ? alerts.dismiss() : alerts?.acknowledge()),
  testBuzz,
  openSettings,
  startPairing: () => {
    server?.startPairing()
    openSettings()
  },
  quit: () => app.quit()
}

function applyLoginItem(): void {
  // MSIX builds auto-start through the package's startup task instead.
  if (process.windowsStore || !app.isPackaged) return
  app.setLoginItemSettings({ openAtLogin: config.launchAtLogin })
}

// ───────────── roles ─────────────

async function startListener(): Promise<void> {
  helper = new NotificationHelper({
    onToast: (t) => {
      if (!isDiscordToast(t)) return
      const e = parseDiscordToast(t)
      pushEvent(e)
      server?.publish(e)
      refresh()
    },
    onChange: refresh,
    captureLog: () => (config.captureLog ? captureLogPath() : null),
    log
  })
  server = new ListenerServer({
    port: config.listenerPort,
    identity: { id: config.deviceId, name: config.deviceName },
    getDevices: () => config.pairedDevices,
    addDevice: (d) => {
      config.pairedDevices = [...config.pairedDevices.filter((x) => x.id !== d.id), d]
      persist()
    },
    getHealth: () => ({ helperRunning: !!helper?.running && !helper.error, discordRunning, lastToastAt: helper?.lastToastAt ?? null }),
    onChange: refresh,
    log
  })
  try {
    listenerPort = await server.start()
    cleanups.push(advertise(config.deviceId, config.deviceName, listenerPort))
    log(`listener on port ${listenerPort}`)
  } catch (e) {
    log(`could not start listener: ${(e as Error).message}`)
  }
  helper.start()
  cleanups.push(watchDiscordProcess((r) => { discordRunning = r; refresh() }))
}

function connectToListener(): void {
  const l = config.listener
  void client?.connect(l ? { id: l.id, host: l.host, port: l.port, key: l.key } : null)
}

function startBuzzer(): void {
  alerts = new AlertController({
    settings: () => config.buzzer,
    onChange: () => { saveHistorySoon(); refresh() },
    onRecord: (r: AlertRecord) => {
      history.recentAlerts = [r, ...history.recentAlerts].slice(0, MAX_RECENT_ALERTS)
    },
    log
  })
  alerts.init()

  client = new BuzzerClient({
    deviceId: config.deviceId,
    onEvent: (e) => {
      pushEvent(e)
      if (config.enabled && !isSnoozed()) {
        const r = evaluate(e, config)
        if (r.matched) {
          log(`BUZZ: ${r.reason}`)
          alerts?.trigger(e, r.reason)
        }
      }
      refresh()
    },
    onStatus: (s) => {
      const wasStale = link.state === 'stale'
      link = s
      if (s.state === 'stale' && !wasStale && config.enabled && !isSnoozed()) {
        log('listener went silent')
        alerts?.chime()
        new Notification({ title: 'Discord Pager', body: 'The Windows listener has gone silent. Alerts will not arrive until it is back.' }).show()
      }
      refresh()
    },
    log
  })
  connectToListener()

  cleanups.push(
    browse((list) => {
      discovered = list
      // Follow the listener if its IP address changed.
      const l = config.listener
      const now = l && list.find((t) => t.id === l.id)
      if (l && now && (now.host !== l.host || now.port !== l.port)) {
        config.listener = { ...l, host: now.host, port: now.port }
        saveConfig(config)
        connectToListener()
      }
      refresh()
    })
  )
  // Keep the snooze label and status fresh.
  const t = setInterval(refresh, 30_000)
  cleanups.push(() => clearInterval(t))
}

// ───────────── IPC ─────────────

function registerIpc(): void {
  ipcMain.handle('state:get', () => state())

  ipcMain.handle('config:save', (_e, patch: Partial<Config>) => {
    const allowed: Array<keyof Config> = ['me', 'dmLists', 'mentionRules', 'buzzer', 'enabled', 'deviceName', 'launchAtLogin', 'captureLog', 'role']
    const prev = config
    const next = { ...config }
    for (const k of allowed) if (k in patch) (next as Record<string, unknown>)[k] = patch[k]
    config = next
    persist()
    if (prev.launchAtLogin !== config.launchAtLogin) applyLoginItem()
    if (prev.captureLog !== config.captureLog) helper?.restart()
    if (prev.role !== config.role) {
      app.relaunch()
      app.exit(0)
    }
    return state()
  })

  ipcMain.handle('enabled:set', (_e, on: boolean) => setEnabled(on))
  ipcMain.handle('snooze', (_e, what: number | 'tomorrow' | null) => snooze(what))
  ipcMain.handle('buzz:test', () => testBuzz())
  ipcMain.handle('alert:ack', () => trayActions.acknowledge())
  ipcMain.handle('alert:open-discord', () => {
    trayActions.acknowledge()
    void shell.openExternal('discord://-/channels/@me')
  })

  // Listener pairing
  ipcMain.handle('listener:pair-start', () => server?.startPairing())
  ipcMain.handle('listener:pair-stop', () => server?.stopPairing())
  ipcMain.handle('listener:remove-device', (_e, id: string) => {
    config.pairedDevices = config.pairedDevices.filter((d) => d.id !== id)
    server?.disconnectDevice(id)
    persist()
  })
  ipcMain.handle('listener:open-capture-log', () => shell.showItemInFolder(captureLogPath()))

  // Buzzer pairing
  ipcMain.handle('buzzer:pair-begin', async (_e, host: string, port: number) => {
    pendingPair?.cancel()
    pendingPair = null
    try {
      pendingPair = await beginPairing(host, port, { id: config.deviceId, name: config.deviceName })
      return { ok: true, listenerName: pendingPair.listenerName }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })
  ipcMain.handle('buzzer:pair-confirm', async (_e, code: string, host: string, port: number) => {
    if (!pendingPair) return { ok: false, error: 'No pairing in progress' }
    try {
      const r = await pendingPair.confirm(code)
      config.listener = { id: r.listenerId, name: r.listenerName, host, port, key: r.key }
      persist()
      connectToListener()
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    } finally {
      pendingPair = null
    }
  })
  ipcMain.handle('buzzer:pair-cancel', () => {
    pendingPair?.cancel()
    pendingPair = null
  })
  ipcMain.handle('buzzer:unpair', () => {
    config.listener = null
    persist()
    connectToListener()
  })
}

// ───────────── lifecycle ─────────────

app.on('second-instance', () => openSettings())
app.on('window-all-closed', () => { /* stay in the tray / menu bar */ })
app.on('before-quit', () => {
  cleanups.forEach((f) => f())
  helper?.stop()
  server?.stop()
  client?.disconnect()
  shutdownDiscovery()
  saveHistory(history)
})

void app.whenReady().then(async () => {
  if (process.platform === 'darwin') app.dock?.hide()
  config = loadConfig()
  history = loadHistory()
  // Anything still "buzzing" from a previous run was never acknowledged.
  for (const a of history.recentAlerts) if (a.status === 'buzzing') a.status = 'missed'
  registerIpc()
  applyLoginItem()

  if (config.role === 'listener') await startListener()
  else startBuzzer()
  refresh()

  const needsSetup = config.role === 'buzzer' ? !config.listener : config.pairedDevices.length === 0
  if (needsSetup) openSettings()
  log(`started as ${config.role}`)
})
