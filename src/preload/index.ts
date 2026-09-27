import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { AppState, Config } from '../shared/types'

type PairResult = { ok: boolean; error?: string; listenerName?: string }

const api = {
  getState: (): Promise<AppState> => ipcRenderer.invoke('state:get'),
  onState: (cb: (s: AppState) => void): (() => void) => {
    const h = (_: IpcRendererEvent, s: AppState): void => cb(s)
    ipcRenderer.on('state', h)
    return () => ipcRenderer.removeListener('state', h)
  },
  saveConfig: (patch: Partial<Config>): Promise<AppState> => ipcRenderer.invoke('config:save', patch),
  setEnabled: (on: boolean): Promise<void> => ipcRenderer.invoke('enabled:set', on),
  snooze: (what: number | 'tomorrow' | null): Promise<void> => ipcRenderer.invoke('snooze', what),
  testBuzz: (): Promise<void> => ipcRenderer.invoke('buzz:test'),
  acknowledge: (): Promise<void> => ipcRenderer.invoke('alert:ack'),
  openDiscord: (): Promise<void> => ipcRenderer.invoke('alert:open-discord'),

  listenerPairStart: (): Promise<void> => ipcRenderer.invoke('listener:pair-start'),
  listenerPairStop: (): Promise<void> => ipcRenderer.invoke('listener:pair-stop'),
  listenerRemoveDevice: (id: string): Promise<void> => ipcRenderer.invoke('listener:remove-device', id),
  openCaptureLog: (): Promise<void> => ipcRenderer.invoke('listener:open-capture-log'),

  pairBegin: (host: string, port: number): Promise<PairResult> => ipcRenderer.invoke('buzzer:pair-begin', host, port),
  pairConfirm: (code: string, host: string, port: number): Promise<PairResult> =>
    ipcRenderer.invoke('buzzer:pair-confirm', code, host, port),
  pairCancel: (): Promise<void> => ipcRenderer.invoke('buzzer:pair-cancel'),
  unpair: (): Promise<void> => ipcRenderer.invoke('buzzer:unpair'),

  // Sound host window only
  onSound: (play: (o: { kind: 'buzz' | 'chime'; tone: string; volume: number }) => void, stop: () => void): void => {
    ipcRenderer.on('sound:play', (_e, o) => play(o))
    ipcRenderer.on('sound:stop', () => stop())
  }
}

export type PagerApi = typeof api
contextBridge.exposeInMainWorld('pager', api)
