import type { Schema, SimParams } from '../types'

interface Props {
  schema: Schema | null
  params: SimParams
  dirty: boolean
  busy: boolean
  onChange: (next: SimParams) => void
  onApply: () => void
  onRandomSeed: () => void
}

/**
 * The run's inputs.
 *
 * The rate sliders are generated from the server's description of the Disease
 * dataclass rather than written out here, so adding a rate to the model adds a
 * control with no frontend change.
 */
export function ParameterPanel({
  schema,
  params,
  dirty,
  busy,
  onChange,
  onApply,
  onRandomSeed,
}: Props) {
  const setDisease = (name: string, value: number) =>
    onChange({ ...params, disease: { ...params.disease, [name]: value } })

  const limits = schema?.limits

  return (
    <div className="panel-body">
      <h2>Population</h2>

      <label className="field">
        <span className="field-label">
          People
          <em>{params.populationSize.toLocaleString()}</em>
        </span>
        <input
          type="number"
          min={1}
          max={limits?.maxPopulation ?? 200000}
          step={100}
          value={params.populationSize}
          onChange={(e) =>
            onChange({ ...params, populationSize: Number(e.target.value) || 1 })
          }
        />
      </label>

      <label className="field">
        <span className="field-label">
          Initially infected
          <em>{params.initInfected}</em>
        </span>
        <input
          type="number"
          min={0}
          max={params.populationSize}
          value={params.initInfected}
          onChange={(e) =>
            onChange({ ...params, initInfected: Number(e.target.value) || 0 })
          }
        />
      </label>

      <label className="field">
        <span className="field-label">Max steps</span>
        <input
          type="number"
          min={1}
          max={limits?.maxSteps ?? 100000}
          step={100}
          value={params.maxSteps}
          onChange={(e) => onChange({ ...params, maxSteps: Number(e.target.value) || 1 })}
        />
      </label>

      <label className="field">
        <span className="field-label">Seed</span>
        <div className="seed-row">
          <input
            type="number"
            placeholder="random"
            value={params.seed ?? ''}
            onChange={(e) =>
              onChange({
                ...params,
                seed: e.target.value === '' ? null : Number(e.target.value),
              })
            }
          />
          <button type="button" onClick={onRandomSeed} title="New random seed">
            ⟳
          </button>
        </div>
      </label>

      <h2>Transition rates</h2>
      {!schema && <p className="muted small">Loading model parameters…</p>}
      {schema?.disease.map((field) => {
        const value = params.disease[field.name] ?? field.default
        return (
          <label className="field" key={field.name} title={field.description}>
            <span className="field-label">
              <span className="symbol">{field.symbol}</span> {field.name}
              <em>{value.toFixed(4)}</em>
            </span>
            <input
              type="range"
              min={field.min}
              max={field.max}
              step={(field.max - field.min) / 1000}
              value={value}
              onChange={(e) => setDisease(field.name, Number(e.target.value))}
            />
            <span className="field-help">{field.description}</span>
          </label>
        )
      })}

      <button
        type="button"
        className={dirty ? 'apply dirty' : 'apply'}
        onClick={onApply}
        disabled={busy}
      >
        {busy ? 'Building…' : dirty ? 'Apply & rerun' : 'Rerun'}
      </button>
    </div>
  )
}
