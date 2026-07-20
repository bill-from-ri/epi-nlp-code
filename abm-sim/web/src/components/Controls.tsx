interface Props {
  running: boolean
  over: boolean
  atEnd: boolean
  speed: number
  viewT: number
  maxT: number
  maxSteps: number
  following: boolean
  onRun: () => void
  onPause: () => void
  onStep: () => void
  onSpeed: (value: number) => void
  onScrub: (t: number) => void
  onFollow: () => void
}

/**
 * Transport bar.
 *
 * The scrubber ranges over frames already computed, not over the whole run:
 * every frame is held client-side, so dragging back replays instantly without
 * asking the server to recompute anything.
 */
export function Controls({
  running,
  over,
  atEnd,
  speed,
  viewT,
  maxT,
  maxSteps,
  following,
  onRun,
  onPause,
  onStep,
  onSpeed,
  onScrub,
  onFollow,
}: Props) {
  const finished = over || atEnd

  return (
    <div className="controls">
      <div className="transport">
        <button type="button" onClick={() => onScrub(0)} title="Back to start">
          ⏮
        </button>
        <button
          type="button"
          className="primary"
          onClick={running ? onPause : onRun}
          disabled={finished && !running}
          title={running ? 'Pause' : 'Run'}
        >
          {running ? '❚❚ Pause' : '▶ Run'}
        </button>
        <button type="button" onClick={onStep} disabled={running || finished} title="One step">
          ▶❙ Step
        </button>
      </div>

      <label className="speed">
        <span>Speed</span>
        <input
          type="range"
          min={1}
          max={300}
          value={speed}
          onChange={(e) => onSpeed(Number(e.target.value))}
        />
        <span className="speed-value">{speed}/s</span>
      </label>

      <div className="timeline">
        <input
          type="range"
          min={0}
          max={Math.max(maxT, 1)}
          value={viewT}
          onChange={(e) => onScrub(Number(e.target.value))}
          aria-label="Timeline"
        />
        <span className="timecode">
          t = {viewT} / {maxT}
          <span className="muted"> of {maxSteps}</span>
        </span>
        {!following && (
          <button type="button" className="ghost" onClick={onFollow}>
            Jump to live
          </button>
        )}
      </div>
    </div>
  )
}
