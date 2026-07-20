import { memo } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { Palette } from '../theme'
import { HEALTH_STATES } from '../types'

interface Row {
  t: number
  s0: number
  s1: number
  s2: number
  s3: number
  s4: number
  s5: number
}

interface Props {
  rows: Row[]
  palette: Palette
  population: number
  viewT: number
}

const KEYS = ['s0', 's1', 's2', 's3', 's4', 's5'] as const

function TooltipBody({
  active,
  payload,
  label,
  palette,
}: {
  active?: boolean
  payload?: { dataKey: string; value: number }[]
  label?: number
  palette: Palette
}) {
  if (!active || !payload?.length) return null
  const byKey = new Map(payload.map((p) => [p.dataKey, p.value]))
  return (
    <div className="tooltip">
      <div className="tooltip-title">step {label}</div>
      {HEALTH_STATES.map((name, i) => (
        <div className="tooltip-row" key={name}>
          <span className="swatch" style={{ background: palette.states[i] }} />
          <span className="tooltip-label">{name}</span>
          <span className="tooltip-value">{byKey.get(KEYS[i]) ?? 0}</span>
        </div>
      ))}
    </div>
  )
}

/**
 * Compartment counts over time as a stacked area.
 *
 * Animation is off and the series are decimated upstream: this repaints while
 * the simulation streams, and Recharts' enter/update transitions would both
 * stutter and animate to a value that is already stale.
 */
export const CompartmentChart = memo(function CompartmentChart({
  rows,
  palette,
  population,
  viewT,
}: Props) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={rows} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
        <CartesianGrid stroke={palette.grid} strokeDasharray="2 4" vertical={false} />
        <XAxis
          dataKey="t"
          type="number"
          domain={['dataMin', 'dataMax']}
          stroke={palette.axis}
          tick={{ fill: palette.textMuted, fontSize: 11 }}
          tickLine={false}
          allowDecimals={false}
        />
        <YAxis
          domain={[0, population]}
          stroke={palette.axis}
          tick={{ fill: palette.textMuted, fontSize: 11 }}
          tickLine={false}
          width={44}
allowDecimals={false}
        />
        <Tooltip
          content={<TooltipBody palette={palette} />}
          cursor={{ stroke: palette.textMuted, strokeWidth: 1 }}
        />
        {KEYS.map((key, i) => (
          <Area
            key={key}
            dataKey={key}
            name={HEALTH_STATES[i]}
            stackId="compartments"
            type="monotone"
            fill={palette.states[i]}
            fillOpacity={1}
            // A hairline in the surface colour separates adjacent bands so the
            // boundary reads as a gap rather than a third colour.
            stroke={palette.surface}
            strokeWidth={1.25}
            isAnimationActive={false}
            dot={false}
            activeDot={false}
          />
        ))}
        <ReferenceLine x={viewT} stroke={palette.textPrimary} strokeWidth={1} />
      </AreaChart>
    </ResponsiveContainer>
  )
})
