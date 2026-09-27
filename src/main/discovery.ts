import { Bonjour, type Service } from 'bonjour-service'
import { SERVICE_TYPE } from '../shared/config'
import type { ListenerTarget } from '../shared/types'

let bonjour: Bonjour | null = null
const get = (): Bonjour => (bonjour ??= new Bonjour())

/** Listener: advertise on the LAN so the Mac can find it. */
export function advertise(id: string, name: string, port: number): () => void {
  const svc = get().publish({ name: `${name} (${id.slice(0, 6)})`, type: SERVICE_TYPE, port, txt: { id, name } })
  return () => svc.stop?.()
}

/** Buzzer: keep a live list of listeners on the LAN. */
export function browse(onChange: (list: ListenerTarget[]) => void): () => void {
  const found = new Map<string, ListenerTarget>()
  const toTarget = (s: Service): ListenerTarget | null => {
    const host = s.addresses?.find((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a)) ?? s.host
    const id = (s.txt as Record<string, string> | undefined)?.id
    if (!host || !id) return null
    return { id, name: (s.txt as Record<string, string>).name ?? s.name, host, port: s.port }
  }
  const browser = get().find({ type: SERVICE_TYPE })
  browser.on('up', (s: Service) => {
    const t = toTarget(s)
    if (t) {
      found.set(t.id, t)
      onChange([...found.values()])
    }
  })
  browser.on('down', (s: Service) => {
    const id = (s.txt as Record<string, string> | undefined)?.id
    if (id && found.delete(id)) onChange([...found.values()])
  })
  const refresh = setInterval(() => browser.update(), 30_000)
  return () => {
    clearInterval(refresh)
    browser.stop()
  }
}

export function shutdownDiscovery(): void {
  bonjour?.unpublishAll()
  bonjour?.destroy()
  bonjour = null
}
