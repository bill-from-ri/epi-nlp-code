import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { CompartmentChart } from './components/CompartmentChart'
import { Controls } from './components/Controls'
import { NetworkCanvas } from './components/NetworkCanvas'
import { ParameterPanel } from './components/ParameterPanel'
import { PersonInspector } from './components/PersonInspector'
import { StatsPanel } from './components/StatsPanel'
import { SimStore } from './store'
import { DARK, LIGHT } from './theme'
import { HEALTH_STATES, type Schema, type SimParams } from './types'

function useTheme() {
  const [dark, setDark] = useState(
    () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false,
  )
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (e: MediaQueryListEvent) => setDark(e.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return dark
}

const randomSeed = () => Math.floor(Math.random() * 2 ** 32)

export default function App() {
  const storeRef = useRef<SimStore | null>(null)
  if (!storeRef.current) storeRef.current = new SimStore()
  const store = storeRef.current

  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)

  const [schema, setSchema] = useState<Schema | null>(null)
  const [params, setParams] = useState<SimParams | null>(null)
  const [applied, setApplied] = useState<SimParams | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)

  const dark = useTheme()
  const palette = dark ? DARK : LIGHT

  useEffect(() => {
    store.connect()
    return () => store.dispose()
  }, [store])

  useEffect(() => {
    fetch('/api/schema')
      .then((r) => r.json())
      .then(setSchema)
      .catch(() => undefined)
  }, [])

  // The server builds a default run on connect; adopt its parameters as the
  // panel's starting point rather than duplicating the defaults here.
  const init = store.init
  useEffect(() => {
    if (!init || params) return
    const next: SimParams = {
      populationSize: init.populationSize,
      initInfected: init.initInfected,
      seed: init.seed,
      maxSteps: init.maxSteps,
      disease: { ...init.disease },
    }
    setParams(next)
    setApplied(next)
  }, [init, params])

  const dirty = useMemo(
    () => JSON.stringify(params) !== JSON.stringify(applied),
    [params, applied],
  )

  const apply = useCallback(() => {
    if (!params) return
    setApplied(params)
    setSelectedId(null)
    store.reset(params)
  }, [params, store])

  const onSelect = useCallback(
    (id: number | null) => {
      setSelectedId(id)
      if (id === null) store.clearPerson()
      else store.inspect(id)
    },
    [store],
  )

  // Re-inspect on scrub: the panel shows states at the displayed frame, and the
  // server answers for its current frame, so they only agree at the live edge.
  useEffect(() => {
    if (selectedId !== null && state.following) store.inspect(selectedId)
  }, [selectedId, state.viewT, state.following, store])

  const history = store.history
  const view = useMemo(() => {
    if (!history) {
      return { rows: [], stats: null }
    }
    return {
      rows: history.series(state.viewT),
      stats: history.stats(state.viewT),
    }
    // `revision` is what actually changes as frames land; history is mutated in
    // place, so it cannot be the dependency that triggers this.
  }, [history, state.viewT, state.revision])

  const population = init?.populationSize ?? 0
  const counts = view.stats?.counts ?? []

  return (
    <div className="app" data-theme={dark ? 'dark' : 'light'}>
      <header className="topbar">
        <h1>Epidemic on a contact network</h1>
        <div className="status-line">
          {state.connection !== 'open' && (
            <span className="badge warn">
              {state.connection === 'connecting' ? 'Connecting…' : 'Disconnected — retrying'}
            </span>
          )}
          {state.building && <span className="badge">Building town…</span>}
          {state.error && <span className="badge error">{state.error}</span>}
          {!state.error && state.message && !state.building && (
            <span className="badge muted-badge">{state.message}</span>
          )}
        </div>
      </header>

      <div className="layout">
        <aside className="panel left">
          {params && (
            <ParameterPanel
              schema={schema}
              params={params}
              dirty={dirty}
              busy={state.building}
              onChange={setParams}
              onApply={apply}
              onRandomSeed={() => setParams({ ...params, seed: randomSeed() })}
            />
          )}
        </aside>

        <main className="centre">
          <section className="card network">
            <h2 className="card-title">Contact network</h2>
            <NetworkCanvas
              store={store}
              palette={palette}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          </section>

          <section className="card chart">
            {/* The legend belongs to the chart rather than the stats panel,
                which is hidden on narrow viewports - series identity must never
                depend on a panel that can disappear. */}
            <div className="card-head">
              <h2 className="card-title">Compartments over time</h2>
              <ul className="legend">
                {HEALTH_STATES.map((name, i) => (
                  <li key={name}>
                    <span className="swatch" style={{ background: palette.states[i] }} />
                    {name}
                  </li>
                ))}
              </ul>
            </div>
            <div className="chart-body">
              <CompartmentChart
                rows={view.rows}
                palette={palette}
                population={population}
                viewT={state.viewT}
              />
            </div>
          </section>
        </main>

        <aside className="panel right">
          <StatsPanel
            palette={palette}
            counts={counts}
            population={population}
            peakInfected={view.stats?.peakInfected ?? 0}
            peakT={view.stats?.peakT ?? 0}
            cumulative={view.stats?.cumulative ?? 0}
            casesPerCapita={view.stats?.casesPerCapita ?? 0}
            rEff={view.stats?.rEff ?? null}
            seed={state.seed}
          />
          <div className="divider" />
          <PersonInspector
            person={state.person}
            palette={palette}
            onClose={() => onSelect(null)}
          />
        </aside>
      </div>

      <Controls
        running={state.running}
        over={state.over}
        atEnd={state.atEnd}
        speed={state.speed}
        viewT={state.viewT}
        maxT={state.maxT}
        maxSteps={state.maxSteps}
        following={state.following}
        onRun={() => store.run()}
        onPause={() => store.pause()}
        onStep={() => store.stepOnce()}
        onSpeed={(v) => store.setSpeed(v)}
        onScrub={(t) => store.scrubTo(t)}
        onFollow={() => store.follow()}
      />
    </div>
  )
}
