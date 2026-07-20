import { History } from './history'
import type {
  Command,
  InitMessage,
  PersonDetail,
  ServerMessage,
  SimParams,
} from './types'

export type Connection = 'connecting' | 'open' | 'closed'

/** The slice React renders from. Replaced wholesale so identity comparison works. */
export interface UiState {
  connection: Connection
  building: boolean
  running: boolean
  speed: number
  maxT: number
  viewT: number
  following: boolean
  over: boolean
  atEnd: boolean
  maxSteps: number
  message: string | null
  error: string | null
  seed: number | null
  person: PersonDetail | null
  /** Bumped whenever the history gains frames, so memoised views recompute. */
  revision: number
}

const INITIAL: UiState = {
  connection: 'connecting',
  building: false,
  running: false,
  speed: 10,
  maxT: 0,
  viewT: 0,
  following: true,
  over: false,
  atEnd: false,
  maxSteps: 1000,
  message: null,
  error: null,
  seed: null,
  person: null,
  revision: 0,
}

// React repaints at this rate at most. Frames can arrive far faster; the canvas
// runs its own rAF loop straight off the store, so throttling here costs the
// chart and the counters nothing perceptible while keeping the main thread free.
const NOTIFY_HZ = 12

function socketUrl(): string {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${location.host}/ws`
}

/**
 * Owns the WebSocket and the run history.
 *
 * Deliberately outside React: at 30 frames/sec a setState per frame would spend
 * the whole budget in reconciliation. Components subscribe through
 * `useSyncExternalStore` and are notified on a throttle, while the canvas reads
 * `history` and `viewT` directly each animation frame.
 */
export class SimStore {
  history: History | null = null
  init: InitMessage | null = null
  /** The frame currently displayed. Read directly by the renderer. */
  viewT = 0

  private state: UiState = INITIAL
  private listeners = new Set<() => void>()
  private ws: WebSocket | null = null
  private notifyTimer: number | null = null
  private notifyPending = false
  private reconnectDelay = 500
  private reconnectTimer: number | null = null
  private lastParams: SimParams | null = null
  private closed = false

  // --- subscription ---------------------------------------------------

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = (): UiState => this.state

  private set(patch: Partial<UiState>, immediate = false) {
    this.state = { ...this.state, ...patch }
    if (immediate) this.flush()
    else this.scheduleNotify()
  }

  private scheduleNotify() {
    if (this.notifyTimer !== null) {
      this.notifyPending = true
      return
    }
    this.flush()
    this.notifyTimer = window.setTimeout(() => {
      this.notifyTimer = null
      if (this.notifyPending) {
        this.notifyPending = false
        this.scheduleNotify()
      }
    }, 1000 / NOTIFY_HZ)
  }

  private flush() {
    for (const listener of this.listeners) listener()
  }

  // --- connection -----------------------------------------------------

  connect() {
    this.closed = false
    this.open()
  }

  private open() {
    this.set({ connection: 'connecting' }, true)
    const ws = new WebSocket(socketUrl())
    this.ws = ws

    ws.onopen = () => {
      this.reconnectDelay = 500
      this.set({ connection: 'open', error: null }, true)
      // The server builds a default run on connect, so a first-time client has
      // something to show without asking. After a drop, restore what the user
      // had configured instead of silently reverting to defaults.
      if (this.lastParams) this.send({ cmd: 'reset', params: this.lastParams })
    }

    ws.onmessage = (event) => {
      let message: ServerMessage
      try {
        message = JSON.parse(event.data as string)
      } catch {
        return
      }
      this.handle(message)
    }

    ws.onerror = () => {
      this.set({ error: 'Connection error - is server.py running?' }, true)
    }

    ws.onclose = () => {
      this.ws = null
      this.set({ connection: 'closed', running: false }, true)
      if (!this.closed) this.scheduleReconnect()
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer !== null) return
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null
      this.open()
    }, this.reconnectDelay)
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 8000)
  }

  dispose() {
    this.closed = true
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer)
    if (this.notifyTimer !== null) window.clearTimeout(this.notifyTimer)
    this.ws?.close()
    this.ws = null
  }

  // --- inbound --------------------------------------------------------

  private handle(message: ServerMessage) {
    switch (message.type) {
      case 'building':
        this.set({ building: true, message: 'Building town...', error: null }, true)
        break

      case 'init': {
        this.init = message
        const states = new Uint8Array(message.populationSize)
        for (const node of message.nodes) states[node.id] = node.health
        this.history = new History(message.populationSize, message.counts, states)
        this.viewT = 0
        this.set(
          {
            building: false,
            maxT: 0,
            viewT: 0,
            following: true,
            over: false,
            atEnd: false,
            maxSteps: message.maxSteps,
            seed: message.seed,
            person: null,
            revision: this.state.revision + 1,
          },
          true,
        )
        break
      }

      case 'frames': {
        const history = this.history
        if (!history) break
        try {
          for (const frame of message.frames) history.append(frame)
        } catch (err) {
          // A gap means the client's history no longer matches the server's
          // run. Say so rather than rendering a quietly wrong epidemic.
          this.set(
            {
              error: `${(err as Error).message}. Reset to resynchronise.`,
              running: false,
            },
            true,
          )
          break
        }
        const following = this.state.following
        if (following) this.viewT = history.maxT
        this.set({
          maxT: history.maxT,
          viewT: this.viewT,
          revision: this.state.revision + 1,
        })
        break
      }

      case 'status':
        this.set(
          {
            running: message.running,
            speed: message.speed,
            maxSteps: message.maxSteps,
            over: message.over,
            atEnd: message.atEnd,
            message: message.message,
          },
          true,
        )
        break

      case 'person':
        this.set({ person: message.person }, true)
        break

      case 'error':
        this.set({ error: message.message, building: false }, true)
        break
    }
  }

  // --- outbound -------------------------------------------------------

  private send(command: Command) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(command))
  }

  run() {
    // Resuming from a scrubbed-back position should follow the live edge again,
    // otherwise the run advances invisibly off-screen.
    this.set({ following: true }, true)
    if (this.history) this.viewT = this.history.maxT
    this.send({ cmd: 'run' })
  }

  pause() {
    this.send({ cmd: 'pause' })
  }

  stepOnce() {
    this.set({ following: true }, true)
    this.send({ cmd: 'step' })
  }

  setSpeed(value: number) {
    this.set({ speed: value }, true)
    this.send({ cmd: 'speed', value })
  }

  reset(params: SimParams) {
    this.lastParams = params
    this.send({ cmd: 'reset', params })
  }

  inspect(id: number) {
    this.send({ cmd: 'inspect', id })
  }

  clearPerson() {
    this.set({ person: null }, true)
  }

  /** Move the displayed frame. Detaches from the live edge unless at the end. */
  scrubTo(t: number) {
    if (!this.history) return
    const clamped = Math.max(0, Math.min(Math.round(t), this.history.maxT))
    this.viewT = clamped
    this.set({ viewT: clamped, following: clamped >= this.history.maxT }, true)
  }

  follow() {
    if (!this.history) return
    this.viewT = this.history.maxT
    this.set({ viewT: this.viewT, following: true }, true)
  }
}
