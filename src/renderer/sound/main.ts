// Hidden window that synthesises the buzzer tones with Web Audio.
// Playing from the app itself means the sound is not muted by macOS Focus / DND.

let ctx: AudioContext | null = null
let master: GainNode | null = null
let loopTimer: number | null = null
let active: OscillatorNode[] = []

function audio(): { ctx: AudioContext; master: GainNode } {
  if (!ctx) {
    ctx = new AudioContext()
    master = ctx.createGain()
    master.connect(ctx.destination)
  }
  void ctx.resume()
  return { ctx, master: master! }
}

function beep(freq: number, start: number, dur: number, type: OscillatorType, vol: number, endFreq?: number): void {
  const { ctx, master } = audio()
  const osc = ctx.createOscillator()
  const g = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, start)
  if (endFreq) osc.frequency.linearRampToValueAtTime(endFreq, start + dur)
  g.gain.setValueAtTime(0, start)
  g.gain.linearRampToValueAtTime(vol, start + 0.005)
  g.gain.setValueAtTime(vol, start + dur - 0.01)
  g.gain.linearRampToValueAtTime(0, start + dur)
  osc.connect(g).connect(master)
  osc.start(start)
  osc.stop(start + dur + 0.02)
  active.push(osc)
  osc.onended = () => (active = active.filter((o) => o !== osc))
}

/** One cycle of a tone, scheduled from `t`. Returns cycle length in seconds. */
function cycle(tone: string, t: number, vol: number): number {
  switch (tone) {
    case 'alarm':
      for (let i = 0; i < 4; i++) beep(i % 2 ? 1300 : 900, t + i * 0.25, 0.24, 'sawtooth', vol * 0.6)
      return 1.1
    case 'chirp':
      beep(1200, t, 0.18, 'square', vol * 0.5, 2600)
      beep(1200, t + 0.25, 0.18, 'square', vol * 0.5, 2600)
      return 1.0
    case 'pager':
    default:
      // Classic pager: four quick high beeps, then a pause.
      for (let i = 0; i < 4; i++) beep(2900, t + i * 0.14, 0.09, 'square', vol * 0.5)
      return 1.0
  }
}

function stop(): void {
  if (loopTimer !== null) window.clearInterval(loopTimer)
  loopTimer = null
  active.forEach((o) => { try { o.stop() } catch { /* already stopped */ } })
  active = []
}

function play(o: { kind: 'buzz' | 'chime'; tone: string; volume: number }): void {
  const { ctx } = audio()
  const vol = Math.max(0, Math.min(1, o.volume))
  if (o.kind === 'chime') {
    const t = ctx.currentTime + 0.05
    beep(880, t, 0.25, 'sine', vol * 0.4)
    beep(660, t + 0.3, 0.4, 'sine', vol * 0.4)
    return
  }
  stop()
  let next = ctx.currentTime + 0.05
  next += cycle(o.tone, next, vol)
  // Schedule ahead so the loop has no gaps even if timers are late.
  loopTimer = window.setInterval(() => {
    while (next < ctx.currentTime + 1.5) next += cycle(o.tone, next, vol)
  }, 250)
}

window.pager.onSound(play, stop)
