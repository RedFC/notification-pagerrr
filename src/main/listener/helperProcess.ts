import { app } from 'electron'
import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { appendFile } from 'node:fs'
import { existsSync, readFileSync, statSync, watchFile } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import type { RawToast } from '../../shared/types'

export function helperPath(): string {
  const base = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources')
  return join(base, 'helper', 'NotificationHelper.exe')
}

export interface HelperOptions {
  onToast: (t: RawToast) => void
  onChange: () => void
  /** When set, every toast (all apps) is appended to this file as a JSON line. */
  captureLog: () => string | null
  log: (msg: string) => void
}

/** Runs the C# helper and restarts it if it exits. */
export class NotificationHelper {
  private proc: ChildProcess | null = null
  private restartTimer: NodeJS.Timeout | null = null
  private backoff = 1000
  private stopped = false
  running = false
  error: string | null = null
  lastToastAt: string | null = null

  constructor(private o: HelperOptions) {}

  start(): void {
    this.stopped = false
    // Development / testing without Windows: feed toasts from a JSON-lines file.
    const fake = process.env['PAGER_FAKE_TOAST_FILE']
    if (fake) return this.startFake(fake)
    const exe = helperPath()
    if (process.platform !== 'win32') {
      this.error = 'The notification helper only runs on Windows.'
      return this.o.onChange()
    }
    if (!existsSync(exe)) {
      this.error = `Helper not found at ${exe}. Run "npm run build:helper".`
      return this.o.onChange()
    }
    const args = this.o.captureLog() ? ['--all'] : []
    const proc = spawn(exe, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    this.proc = proc
    this.running = true
    this.o.onChange()

    createInterface({ input: proc.stdout! }).on('line', (line) => this.onLine(line))
    proc.stderr!.on('data', (d) => this.o.log(`helper stderr: ${d}`))
    proc.on('error', (e) => {
      this.error = e.message
      this.o.onChange()
    })
    proc.on('exit', (code) => {
      this.running = false
      this.proc = null
      this.o.log(`helper exited with code ${code}`)
      this.o.onChange()
      if (!this.stopped) {
        this.restartTimer = setTimeout(() => this.start(), this.backoff)
        this.backoff = Math.min(this.backoff * 2, 60_000)
      }
    })
  }

  stop(): void {
    this.stopped = true
    if (this.restartTimer) clearTimeout(this.restartTimer)
    this.proc?.stdin?.end()
    this.proc?.kill()
    this.proc = null
    this.running = false
  }

  restart(): void {
    this.stop()
    this.start()
  }

  private startFake(file: string): void {
    let offset = existsSync(file) ? statSync(file).size : 0
    this.running = true
    this.error = null
    this.o.log(`reading simulated toasts from ${file}`)
    this.o.onChange()
    watchFile(file, { interval: 300 }, () => {
      if (!existsSync(file)) return
      const buf = readFileSync(file)
      const chunk = buf.subarray(offset).toString('utf8')
      offset = buf.length
      for (const line of chunk.split('\n')) if (line.trim()) this.onLine(JSON.stringify({ type: 'toast', ...JSON.parse(line) }))
    })
  }

  private onLine(line: string): void {
    let msg: { type: string; message?: string; access?: string } & Partial<RawToast>
    try {
      msg = JSON.parse(line)
    } catch {
      return
    }
    if (msg.type === 'status') {
      this.error = msg.access === 'Allowed' ? null : `Notification access: ${msg.access}`
      this.backoff = 1000
      this.o.onChange()
    } else if (msg.type === 'error') {
      this.error = msg.message ?? 'unknown error'
      this.o.log(`helper: ${this.error}`)
      this.o.onChange()
    } else if (msg.type === 'toast') {
      const toast: RawToast = {
        id: String(msg.id),
        appId: msg.appId ?? '',
        appName: msg.appName ?? '',
        texts: msg.texts ?? [],
        createdAt: msg.createdAt ?? new Date().toISOString()
      }
      const logFile = this.o.captureLog()
      if (logFile) appendFile(logFile, JSON.stringify(toast) + '\n', () => {})
      this.lastToastAt = new Date().toISOString()
      this.o.onToast(toast)
    }
  }
}

/** Polls whether Discord.exe is running (Windows only). */
export function watchDiscordProcess(onChange: (running: boolean) => void): () => void {
  let last: boolean | null = null
  const check = (): void => {
    execFile('tasklist', ['/FI', 'IMAGENAME eq Discord.exe', '/NH'], { windowsHide: true }, (err, out) => {
      const running = !err && /discord\.exe/i.test(out)
      if (running !== last) {
        last = running
        onChange(running)
      }
    })
  }
  if (process.platform !== 'win32') return () => {}
  check()
  const t = setInterval(check, 15_000)
  return () => clearInterval(t)
}
