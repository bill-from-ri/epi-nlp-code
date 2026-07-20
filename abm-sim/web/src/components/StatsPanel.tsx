import type { Palette } from '../theme'
import { HEALTH_STATES } from '../types'

interface Props {
  palette: Palette
  counts: number[]
  population: number
  peakInfected: number
  peakT: number
  cumulative: number
  casesPerCapita: number
  rEff: number | null
  seed: number | null
}

const pct = (value: number) => `${(value * 100).toFixed(1)}%`

/**
 * The compartment counts as text.
 *
 * This is also the accessibility relief for the chart: Exposed sits below 3:1
 * against the light surface, so the same numbers are always readable here with
 * their names spelled out, and identity never depends on telling two fills
 * apart.
 */
export function StatsPanel({
  palette,
  counts,
  population,
  peakInfected,
  peakT,
  cumulative,
  casesPerCapita,
  rEff,
  seed,
}: Props) {
  return (
    <div className="stats">
      <table className="counts-table">
        <tbody>
          {HEALTH_STATES.map((name, i) => (
            <tr key={name}>
              <td>
                <span className="swatch" style={{ background: palette.states[i] }} />
                {name}
              </td>
              <td className="num">{counts[i] ?? 0}</td>
              <td className="num muted">
                {population > 0 ? pct((counts[i] ?? 0) / population) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="stat-tiles">
        <div className="tile">
          <div className="tile-label">Peak infected</div>
          <div className="tile-value">{peakInfected}</div>
          <div className="tile-sub">at step {peakT}</div>
        </div>
        <div className="tile">
          <div className="tile-label">Cumulative cases</div>
          <div className="tile-value">{cumulative.toLocaleString()}</div>
          <div className="tile-sub">
            {casesPerCapita.toFixed(2)}× population, reinfections included
          </div>
        </div>
        <div className="tile">
          <div className="tile-label">R<sub>eff</sub></div>
          <div className="tile-value">{rEff === null ? '—' : rEff.toFixed(2)}</div>
          <div className="tile-sub">last 10 steps</div>
        </div>
        <div className="tile">
          <div className="tile-label">Seed</div>
          <div className="tile-value small">{seed ?? '—'}</div>
          <div className="tile-sub">reproducible</div>
        </div>
      </div>
    </div>
  )
}
