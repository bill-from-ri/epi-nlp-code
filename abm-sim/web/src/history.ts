import { N_STATES, type Counts, type Frame } from './types'

// How often to store a full state array. Scrubbing to an arbitrary t means
// copying the nearest keyframe at or before it and replaying deltas forward,
// so this trades memory against scrub latency.
//
// Keeping every frame's full state would be N bytes per frame: fine at 1k
// people, 100MB at 100k people over a 1000-step run. Keyframes plus deltas
// cost N/KEYFRAME_INTERVAL plus the transitions that actually happened, which
// is what makes the "increase the scale of this tool" path viable without
// changing the client's architecture.
const KEYFRAME_INTERVAL = 100

/**
 * Every frame of a run, held client-side so the timeline scrubs without
 * re-running the simulation.
 */
export class History {
  readonly population: number

  /** Flat counts, N_STATES per frame, indexed by t. */
  private countsFlat: Int32Array
  /** Transitions for frame t as flat [id, state, id, state, ...]. */
  private deltas: (Int32Array | null)[] = []
  private keyframes = new Map<number, Uint8Array>()
  /** New exposures per frame - cumulative incidence, which counts is blind to. */
  private incidence: Int32Array

  private capacity: number
  maxT = 0

  /**
   * `initialStates` must be the server's actual t=0 states, not a
   * reconstruction: patient zero is drawn at random, so the counts alone do not
   * say who is infected.
   */
  constructor(population: number, initialCounts: Counts, initialStates: Uint8Array) {
    this.population = population
    this.capacity = 1024
    this.countsFlat = new Int32Array(this.capacity * N_STATES)
    this.incidence = new Int32Array(this.capacity)

    this.countsFlat.set(initialCounts, 0)
    this.deltas[0] = null
    this.keyframes.set(0, new Uint8Array(initialStates))
  }

  private grow(needed: number) {
    if (needed < this.capacity) return
    while (this.capacity <= needed) this.capacity *= 2
    const counts = new Int32Array(this.capacity * N_STATES)
    counts.set(this.countsFlat)
    this.countsFlat = counts
    const inc = new Int32Array(this.capacity)
    inc.set(this.incidence)
    this.incidence = inc
  }

  append(frame: Frame) {
    const t = frame.t
    if (t !== this.maxT + 1) {
      // Frames are contiguous by construction; a gap means dropped state and
      // silently accepting it would corrupt every later scrub.
      throw new Error(`non-contiguous frame: expected t=${this.maxT + 1}, got t=${t}`)
    }
    this.grow(t + 1)

    const flat = new Int32Array(frame.changed.length * 2)
    let exposures = 0
    for (let i = 0; i < frame.changed.length; i++) {
      const [id, state] = frame.changed[i]
      flat[i * 2] = id
      flat[i * 2 + 1] = state
      if (state === 1) exposures++
    }
    this.deltas[t] = flat
    this.countsFlat.set(frame.counts, t * N_STATES)
    this.incidence[t] = exposures
    this.maxT = t

    if (t % KEYFRAME_INTERVAL === 0) {
      this.keyframes.set(t, this.stateAt(t))
    }
  }

  countsAt(t: number): Counts {
    const clamped = Math.max(0, Math.min(t, this.maxT))
    const out: number[] = new Array(N_STATES)
    for (let s = 0; s < N_STATES; s++) out[s] = this.countsFlat[clamped * N_STATES + s]
    return out
  }

  /** Full health state of every person at t. */
  stateAt(t: number): Uint8Array {
    const target = Math.max(0, Math.min(t, this.maxT))
    let from = target - (target % KEYFRAME_INTERVAL)
    while (from > 0 && !this.keyframes.has(from)) from -= KEYFRAME_INTERVAL
    const anchor = this.keyframes.get(from)
    if (!anchor) throw new Error(`no keyframe at or before t=${target}`)

    const states = new Uint8Array(anchor)
    for (let step = from + 1; step <= target; step++) {
      const delta = this.deltas[step]
      if (!delta) continue
      for (let i = 0; i < delta.length; i += 2) states[delta[i]] = delta[i + 1]
    }
    return states
  }

  /** Transitions applied by frame t, for an incremental repaint. */
  deltaAt(t: number): Int32Array | null {
    return t >= 1 && t <= this.maxT ? this.deltas[t] ?? null : null
  }

  /**
   * Counts as chart rows, decimated to at most `maxPoints`.
   *
   * Sampling can step over a sharp peak, so the exact peak is reported
   * separately by `stats()` rather than read off the chart.
   */
  series(upTo: number, maxPoints = 500) {
    const end = Math.max(0, Math.min(upTo, this.maxT))
    const stride = Math.max(1, Math.ceil((end + 1) / maxPoints))
    const rows = []
    for (let t = 0; t <= end; t += stride) rows.push(this.row(t))
    if (rows.length === 0 || rows[rows.length - 1].t !== end) rows.push(this.row(end))
    return rows
  }

  private row(t: number) {
    const base = t * N_STATES
    return {
      t,
      s0: this.countsFlat[base],
      s1: this.countsFlat[base + 1],
      s2: this.countsFlat[base + 2],
      s3: this.countsFlat[base + 3],
      s4: this.countsFlat[base + 4],
      s5: this.countsFlat[base + 5],
    }
  }

  /** Summary figures, computed over every frame rather than the decimated view. */
  stats(upTo: number) {
    const end = Math.max(0, Math.min(upTo, this.maxT))
    let peakInfected = 0
    let peakT = 0
    let cumulative = 0
    for (let t = 0; t <= end; t++) {
      const infected = this.countsFlat[t * N_STATES + 2]
      if (infected > peakInfected) {
        peakInfected = infected
        peakT = t
      }
      cumulative += this.incidence[t]
    }
    const counts = this.countsAt(end)

    // A crude effective reproduction number: new exposures over a recent window
    // divided by the infected who could have caused them, scaled by the mean
    // infectious period. Enough to see whether the epidemic is growing.
    const window = Math.min(10, end)
    let recentExposures = 0
    let recentInfected = 0
    for (let t = end - window + 1; t <= end; t++) {
      if (t < 1) continue
      recentExposures += this.incidence[t]
      recentInfected += this.countsFlat[(t - 1) * N_STATES + 2]
    }
    const rEff = recentInfected > 0 ? recentExposures / recentInfected : null

    return {
      t: end,
      counts,
      peakInfected,
      peakT,
      // Every exposure event, which with waning immunity can exceed the
      // population - people are reinfected. So this is a case count, not an
      // attack rate, and must not be shown as a percentage of the population.
      cumulative,
      casesPerCapita: this.population > 0 ? cumulative / this.population : 0,
      rEff,
    }
  }
}
