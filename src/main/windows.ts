import { BrowserWindow, app } from 'electron'
import { join } from 'node:path'

export type Page = 'settings' | 'alert' | 'sound'

export function loadPage(win: BrowserWindow, page: Page): void {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devUrl) void win.loadURL(`${devUrl}/${page}/index.html`)
  else void win.loadFile(join(__dirname, `../renderer/${page}/index.html`))
}

export const preloadPath = (): string => join(__dirname, '../preload/index.js')

export function resourcesDir(): string {
  return app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources')
}
