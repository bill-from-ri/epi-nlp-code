import { useCallback, useEffect, useRef, useState } from 'react'
import type { SimStore } from '../store'
import type { Palette } from '../theme'
import { N_STATES } from '../types'

// Edges are static, so they are painted once into an offscreen canvas and
// blitted. Past this many the paint itself becomes the bottleneck and the
// hairball has stopped being informative anyway, so the edge layer is dropped
// and the clusters carry the structure.
const MAX_EDGES_DRAWN = 120_000
// Above this, edges are also suppressed while panning or zooming, then restored
// when the gesture ends - a smooth drag matters more than complete structure.
const EDGES_DURING_GESTURE = 25_000

interface Props {
  store: SimStore
  palette: Palette
  selectedId: number | null
  onSelect: (id: number | null) => void
}

interface Transform {
  scale: number
  tx: number
  ty: number
}

/**
 * The contact network, drawn as a frozen layout that is recoloured per frame.
 *
 * The topology never changes during a run, so this deliberately does no physics:
 * positions arrive from the server once, edges are rasterised once, and the
 * per-frame cost is restamping only the nodes that actually changed state.
 *
 * It also runs its own animation loop rather than rendering from React state,
 * so frames paint at the display's rate independently of React's throttle.
 */
export function NetworkCanvas({ store, palette, selectedId, onSelect }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  const edgeLayer = useRef<HTMLCanvasElement | null>(null)
  const transform = useRef<Transform>({ scale: 1, tx: 0, ty: 0 })
  const size = useRef({ width: 0, height: 0, dpr: 1 })

  // Positions in world space (the unit square the server normalises into).
  const xs = useRef<Float32Array>(new Float32Array(0))
  const ys = useRef<Float32Array>(new Float32Array(0))
  // Uniform grid over world space for click hit-testing.
  const grid = useRef<{ cells: Int32Array[]; size: number } | null>(null)

  const lastPainted = useRef(-1)
  const needsFull = useRef(true)
  const edgesDirty = useRef(true)
  const gesturing = useRef(false)
  const initRevision = useRef<object | null>(null)

  const [hoverId, setHoverId] = useState<number | null>(null)
  const [edgesShown, setEdgesShown] = useState(true)

  const nodeRadius = useCallback(() => {
    const n = store.init?.nodes.length ?? 1
    const { width, height } = size.current
    const perNode = Math.sqrt((width * height) / Math.max(n, 1))
    return Math.max(1.1, Math.min(5, perNode * 0.26))
  }, [store])

  // --- geometry -------------------------------------------------------

  const fitView = useCallback(() => {
    const { width, height } = size.current
    const scale = Math.min(width, height) * 0.94
    transform.current = {
      scale,
      tx: (width - scale) / 2,
      ty: (height - scale) / 2,
    }
    needsFull.current = true
    edgesDirty.current = true
  }, [])

  const loadInit = useCallback(() => {
    const init = store.init
    if (!init) return
    const n = init.layout.length
    const px = new Float32Array(n)
    const py = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      px[i] = init.layout[i].x
      py[i] = init.layout[i].y
    }
    xs.current = px
    ys.current = py

    // Bucket node ids by world cell so a click compares against a handful of
    // candidates instead of the whole population.
    const cellCount = Math.max(8, Math.min(256, Math.ceil(Math.sqrt(n / 2))))
    const buckets: number[][] = Array.from({ length: cellCount * cellCount }, () => [])
    for (let i = 0; i < n; i++) {
      const cx = Math.min(cellCount - 1, Math.max(0, Math.floor(px[i] * cellCount)))
      const cy = Math.min(cellCount - 1, Math.max(0, Math.floor(py[i] * cellCount)))
      buckets[cy * cellCount + cx].push(i)
    }
    grid.current = { cells: buckets.map((b) => Int32Array.from(b)), size: cellCount }

    lastPainted.current = -1
    needsFull.current = true
    edgesDirty.current = true
    fitView()
  }, [store, fitView])

  // --- painting -------------------------------------------------------

  const paintEdges = useCallback(() => {
    const init = store.init
    const layer = edgeLayer.current
    if (!init || !layer) return
    const { width, height, dpr } = size.current
    layer.width = Math.max(1, Math.floor(width * dpr))
    layer.height = Math.max(1, Math.floor(height * dpr))

    const ctx = layer.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)

    const tooMany = init.edges.length > MAX_EDGES_DRAWN
    const hideForGesture =
      gesturing.current && init.edges.length > EDGES_DURING_GESTURE
    const show = !tooMany && !hideForGesture
    setEdgesShown(!tooMany)
    if (!show) return

    const { scale, tx, ty } = transform.current
    const px = xs.current
    const py = ys.current
    ctx.strokeStyle = palette.edge
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let i = 0; i < init.edges.length; i++) {
      const [a, b] = init.edges[i]
      ctx.moveTo(px[a] * scale + tx, py[a] * scale + ty)
      ctx.lineTo(px[b] * scale + tx, py[b] * scale + ty)
    }
    ctx.stroke()
  }, [store, palette])

  const paint = useCallback(() => {
    const canvas = canvasRef.current
    const history = store.history
    const init = store.init
    if (!canvas || !history || !init) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const { width, height, dpr } = size.current
    if (width === 0 || height === 0) return

    if (edgesDirty.current) {
      paintEdges()
      edgesDirty.current = false
      needsFull.current = true
    }

    const t = store.viewT
    const full = needsFull.current || lastPainted.current !== t - 1
    if (!full && t === lastPainted.current) return

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const { scale, tx, ty } = transform.current
    const px = xs.current
    const py = ys.current
    const r = nodeRadius()

    if (full) {
      ctx.clearRect(0, 0, width, height)
      const layer = edgeLayer.current
      if (layer) ctx.drawImage(layer, 0, 0, width, height)

      // One path per colour: setting fillStyle per node dominates the frame at
      // large populations.
      const states = history.stateAt(t)
      for (let s = 0; s < N_STATES; s++) {
        ctx.beginPath()
        let any = false
        for (let i = 0; i < states.length; i++) {
          if (states[i] !== s) continue
          const cx = px[i] * scale + tx
          const cy = py[i] * scale + ty
          if (cx < -r || cy < -r || cx > width + r || cy > height + r) continue
          ctx.moveTo(cx + r, cy)
          ctx.arc(cx, cy, r, 0, Math.PI * 2)
          any = true
        }
        if (any) {
          ctx.fillStyle = palette.states[s]
          ctx.fill()
        }
      }
      needsFull.current = false
    } else {
      // The steady state: repaint only the handful of nodes that moved. Each is
      // an opaque disc covering exactly the pixels it covered before, so the
      // edge layer underneath needs no attention.
      const delta = history.deltaAt(t)
      if (delta) {
        for (let i = 0; i < delta.length; i += 2) {
          const id = delta[i]
          const state = delta[i + 1]
          const cx = px[id] * scale + tx
          const cy = py[id] * scale + ty
          ctx.fillStyle = palette.states[state]
          ctx.beginPath()
          ctx.arc(cx, cy, r, 0, Math.PI * 2)
          ctx.fill()
        }
      }
    }

    // Selection and hover rings sit on top and are redrawn every frame; the
    // node beneath may have just been restamped.
    const ring = (id: number, color: string, lineWidth: number) => {
      ctx.strokeStyle = color
      ctx.lineWidth = lineWidth
      ctx.beginPath()
      ctx.arc(px[id] * scale + tx, py[id] * scale + ty, r + 3.5, 0, Math.PI * 2)
      ctx.stroke()
    }
    if (hoverId !== null && hoverId !== selectedId) ring(hoverId, palette.textMuted, 1.5)
    if (selectedId !== null && selectedId < px.length) ring(selectedId, palette.textPrimary, 2)

    lastPainted.current = t
  }, [store, palette, nodeRadius, paintEdges, hoverId, selectedId])

  // Rings are drawn on top of an incremental frame, so a change in either has
  // to force a clean repaint or the previous ring would linger.
  useEffect(() => {
    needsFull.current = true
  }, [hoverId, selectedId, palette])

  // --- lifecycle ------------------------------------------------------

  useEffect(() => {
    edgeLayer.current = document.createElement('canvas')
  }, [])

  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return

    const observer = new ResizeObserver(() => {
      const rect = wrap.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      size.current = { width: rect.width, height: rect.height, dpr }
      canvas.width = Math.max(1, Math.floor(rect.width * dpr))
      canvas.height = Math.max(1, Math.floor(rect.height * dpr))
      canvas.style.width = `${rect.width}px`
      canvas.style.height = `${rect.height}px`
      fitView()
    })
    observer.observe(wrap)
    return () => observer.disconnect()
  }, [fitView])

  // Drive painting from rAF rather than React: the store advances viewT far
  // faster than React is notified, and the network should show every frame.
  useEffect(() => {
    let raf = 0
    const loop = () => {
      if (store.init && store.init !== initRevision.current) {
        initRevision.current = store.init
        loadInit()
      }
      paint()
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [store, paint, loadInit])

  // --- interaction ----------------------------------------------------

  const nodeAt = useCallback(
    (clientX: number, clientY: number): number | null => {
      const canvas = canvasRef.current
      const g = grid.current
      if (!canvas || !g) return null
      const rect = canvas.getBoundingClientRect()
      const sx = clientX - rect.left
      const sy = clientY - rect.top
      const { scale, tx, ty } = transform.current
      const wx = (sx - tx) / scale
      const wy = (sy - ty) / scale

      const reach = Math.max(nodeRadius() + 4, 6) / scale
      const cell = 1 / g.size
      const lo = (v: number) => Math.max(0, Math.floor((v - reach) / cell))
      const hi = (v: number) => Math.min(g.size - 1, Math.floor((v + reach) / cell))

      const px = xs.current
      const py = ys.current
      let best = -1
      let bestDist = reach * reach
      for (let cy = lo(wy); cy <= hi(wy); cy++) {
        for (let cx = lo(wx); cx <= hi(wx); cx++) {
          for (const id of g.cells[cy * g.size + cx]) {
            const dx = px[id] - wx
            const dy = py[id] - wy
            const dist = dx * dx + dy * dy
            if (dist <= bestDist) {
              bestDist = dist
              best = id
            }
          }
        }
      }
      return best >= 0 ? best : null
    },
    [nodeRadius],
  )

  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null)

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    ;(event.target as Element).setPointerCapture(event.pointerId)
    drag.current = { x: event.clientX, y: event.clientY, moved: false }
  }

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (drag.current) {
      const dx = event.clientX - drag.current.x
      const dy = event.clientY - drag.current.y
      if (Math.abs(dx) + Math.abs(dy) > 2) {
        drag.current.moved = true
        gesturing.current = true
        transform.current.tx += dx
        transform.current.ty += dy
        drag.current.x = event.clientX
        drag.current.y = event.clientY
        edgesDirty.current = true
      }
      return
    }
    const id = nodeAt(event.clientX, event.clientY)
    setHoverId((prev) => (prev === id ? prev : id))
  }

  const endGesture = () => {
    if (gesturing.current) {
      gesturing.current = false
      edgesDirty.current = true
    }
  }

  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const wasDrag = drag.current?.moved ?? false
    drag.current = null
    endGesture()
    if (wasDrag) return
    onSelect(nodeAt(event.clientX, event.clientY))
  }

  const onWheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const cx = event.clientX - rect.left
    const cy = event.clientY - rect.top
    const factor = Math.exp(-event.deltaY * 0.0016)
    const current = transform.current
    const next = Math.max(50, Math.min(200_000, current.scale * factor))
    const applied = next / current.scale
    transform.current = {
      scale: next,
      tx: cx - (cx - current.tx) * applied,
      ty: cy - (cy - current.ty) * applied,
    }
    edgesDirty.current = true
  }

  return (
    <div className="canvas-wrap" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className="network-canvas"
        style={{ cursor: hoverId !== null ? 'pointer' : 'grab' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => {
          setHoverId(null)
          drag.current = null
          endGesture()
        }}
        onWheel={onWheel}
      />
      <div className="canvas-hint">
        <button type="button" onClick={fitView}>
          Reset view
        </button>
        <span>
          {edgesShown
            ? 'scroll to zoom · drag to pan · click a person'
            : 'edge layer hidden above 120k edges · clusters are offices'}
        </span>
      </div>
    </div>
  )
}
