import type { Palette } from '../theme'
import { HEALTH_STATES, type PersonDetail } from '../types'

interface Props {
  person: PersonDetail | null
  palette: Palette
  onClose: () => void
}

/**
 * One person's attributes, contacts, and neighbour states.
 *
 * This is the debugger for the transition logic: if someone is stuck in a
 * compartment, their neighbours' states are the first thing to look at.
 */
export function PersonInspector({ person, palette, onClose }: Props) {
  if (!person) {
    return (
      <p className="muted small pad">
        Click a person in the network to inspect their household, office and
        contacts.
      </p>
    )
  }

  const traits = [
    person.isObese && 'obese',
    person.isSmoker && 'smoker',
    person.isAsthmatic && 'asthmatic',
  ].filter(Boolean) as string[]

  return (
    <div className="inspector">
      <div className="inspector-head">
        <span className="swatch" style={{ background: palette.states[person.health] }} />
        <strong>Person {person.id}</strong>
        <span className="muted">{HEALTH_STATES[person.health]}</span>
        <button type="button" className="ghost" onClick={onClose}>
          ✕
        </button>
      </div>

      <dl className="kv">
        <dt>Age</dt>
        <dd>{person.age}</dd>
        <dt>Traits</dt>
        <dd>{traits.length ? traits.join(', ') : 'none'}</dd>
        <dt>Contacts</dt>
        <dd>{person.degree}</dd>
        {person.household && (
          <>
            <dt>Household</dt>
            <dd>
              #{person.household.id} · {person.household.size} people ·{' '}
              {person.household.hasCar ? 'car' : 'no car'}
            </dd>
          </>
        )}
        {person.office && (
          <>
            <dt>Office</dt>
            <dd>
              #{person.office.id} · {person.office.type.toLowerCase()} ·{' '}
              {person.office.size} people
            </dd>
          </>
        )}
      </dl>

      <div className="neighbour-bar-label muted small">Neighbour states</div>
      <div className="neighbour-bar">
        {person.neighbourCounts.map((count, i) =>
          count === 0 ? null : (
            <span
              key={i}
              className="neighbour-seg"
              style={{
                background: palette.states[i],
                flexGrow: count,
              }}
              title={`${count} ${HEALTH_STATES[i]}`}
            />
          ),
        )}
      </div>
      <div className="neighbour-legend">
        {person.neighbourCounts.map((count, i) =>
          count === 0 ? null : (
            <span key={i} className="neighbour-tag">
              <span className="swatch" style={{ background: palette.states[i] }} />
              {HEALTH_STATES[i]} {count}
            </span>
          ),
        )}
      </div>
    </div>
  )
}
