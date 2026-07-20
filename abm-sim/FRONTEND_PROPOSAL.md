# Proposal: A TSX frontend for the ABM

## The problem with the current surface

`abm.ipynb` is two cells. To change anything about a run you edit a constant in
`disease.py` and re-execute. To see anything about a run you read two printed
integers at the end of it.

Three concrete gaps, all in the model rather than the notebook:

1. **No history.** `EpiGraph.step()` mutates health states in place and returns
   nothing. `run_simulation()` tallies only the terminal state. The entire
   epidemic curve — the thing actually worth looking at — is computed and
   discarded 1000 times per run.
2. **No reproducibility.** `utils.compute_success` calls `random.random()` off
   the global module RNG with no seed anywhere. Two runs with identical
   parameters are not comparable, so you can't attribute a change in outcome to
   a change in parameters.
3. **No parameter surface.** `Disease` is a class of bare class attributes.
   Nothing can vary them without an edit-and-reimport cycle.

A frontend fixes the presentation. It does not fix any of these. So the first
milestone below is Python-side, and it's worth doing even if the frontend never
ships.

## Architecture

Keep the model in Python. It is the research artifact; porting it to TypeScript
would mean maintaining two implementations that drift. The frontend is a viewer
and a control surface, nothing more.

```
abm-sim/
  entities.py population.py graph.py disease.py utils.py   # unchanged in spirit
  simulation.py                                            # becomes a class
  server.py                                                # FastAPI + WebSocket
  web/                                                     # Vite + React + TS
```

- **Transport:** WebSocket. The client sends control messages (`run`, `pause`,
  `step`, `reset`); the server streams one frame per simulation step. HTTP
  polling would work but makes "play at 30 steps/sec" awkward, and SSE gives up
  the return channel for controls.
- **Server:** FastAPI + `uvicorn` — both already importable in your env. Add
  `websockets`, which is not installed yet.
- **Client:** Vite + React + TypeScript. No framework beyond that; this is a
  single-page local tool, so no router, no state library — one `useReducer`
  holding sim state plus a `useRef` ring buffer for the history.

## Milestone 0 — make the model observable (Python)

This is the load-bearing change. Everything else is downstream.

**`Simulation` as a generator, not a function.** Replace `run_simulation` with a
class exposing `step()` and yielding a snapshot, so the caller decides how far to
run and what to keep:

```python
class Simulation:
    def __init__(self, population_size=1000, init_infected=1, seed=None, disease=None): ...
    def step(self) -> Snapshot: ...          # advance one tick, return what changed
    def run(self, n) -> Iterator[Snapshot]: ...
```

`run_simulation()` stays as a thin wrapper so the notebook keeps working.

**`EpiGraph.step()` should return its transitions.** It already computes exactly
the right thing — the six `marked_for_*` sets — and then throws them away. Have
it return them. The compartment counts and the per-node recolor list both fall
out of that for free, with no extra passes over the population.

**Seed the RNG.** `compute_success` should draw from an injected
`random.Random(seed)` instance rather than the global module RNG. Same run, same
seed, same epidemic — which is what makes side-by-side parameter comparison mean
anything.

**Reset the ID counters.** `Person._counter`, `Household._counter` and
`Office._counter` are `itertools.count` class attributes that never reset. In a
notebook you restart the kernel between runs and never notice. In a long-lived
server process, IDs climb monotonically across every run the server has ever
done. Add a classmethod to reset them at `Simulation.__init__`, or move the
counter into the `Population` that owns it.

**`Disease` should be a dataclass.** Bare class attributes can't be varied per
run. A frozen dataclass with the same field names is a drop-in change and gives
the API something to accept and validate.

## Wire protocol

Two message types, server to client.

**`init`**, once per run — the static structure:

```ts
type Init = {
  type: 'init'
  seed: number
  nodes: { id: number; household: number; office: number; officeType: OfficeType; age: number }[]
  edges: [number, number][]
  layout: { x: number; y: number }[]   // precomputed, see below
}
```

**`frame`**, one per step — only what changed:

```ts
type Frame = {
  type: 'frame'
  t: number
  counts: [number, number, number, number, number, number]  // S,E,I,D,R,Dead
  changed: [number, HealthState][]                          // node id -> new state
}
```

Sizing check, so this doesn't get over-engineered: at 1000 people a *full* state
array is 1000 small ints, ~4KB of JSON, ~4MB across a 1000-step run. That's
nothing. The `changed` delta is there because it's also what makes the canvas
redraw cheap, not because bandwidth is a concern. Both stay comfortable to about
50k agents; past that, move to a binary `ArrayBuffer` frame and stop thinking
about JSON.

Client to server: `{cmd: 'run' | 'pause' | 'step' | 'reset', params?: SimParams}`.

## Rendering

**The contact graph is the interesting view, and it has one performance trick.**
At a population of 1000 the current wiring produces roughly 10k edges — ~50
offices of ~20 people contribute ~190 edges each as complete cliques, plus ~317
households of ~3. That is far too many DOM nodes for SVG, and it is why
`react-force-graph` and friends will feel sluggish.

The trick: **compute the layout once, then freeze it.** The graph topology never
changes during a run — only node *colors* change. So run `d3-force` once on
`init` (server-side, or client-side before the first frame), ship the resulting
coordinates, and from then on the per-frame work is recoloring the handful of
nodes in `changed`. That turns a physics simulation into a paint.

Given a frozen layout, a force-graph library is mostly dead weight — you'd be
importing a physics engine to not run it. Recommend a hand-rolled `<canvas>`
renderer (~150 lines): draw edges once into an offscreen canvas since they never
change, then blit that and stamp nodes on top each frame. Keep `d3-force` as a
dependency purely for the one-time layout.

Because the structure is cliques-of-cliques, an alternative worth trying is a
deterministic layout — offices as a grid of clusters, households as satellites —
which reads more legibly than force-directed hairball. Cheap to swap once the
renderer takes coordinates as input.

**The epidemic curve** is a stacked area chart of the six compartments over time.
Recharts is fine here, with one caveat: re-rendering it on every frame at 30
steps/sec will stutter. Throttle it to ~10Hz and decimate to ~500 points once the
run is longer than that. If it still stutters, `uPlot` handles streaming series
an order of magnitude better and is the escape hatch.

## Layout

```
┌───────────────┬─────────────────────────────┬──────────────┐
│  Parameters   │      Contact network        │  Counts      │
│               │      (canvas, frozen        │  S E I D R † │
│  β σ γ δ      │       layout, recolor       │              │
│  ζ η ω        │       per frame)            │  R_eff       │
│               │                             │  peak I      │
│  population   ├─────────────────────────────┤              │
│  init_infect  │      Compartment curves     │  Run log     │
│  seed         │      (stacked area, t-axis) │              │
├───────────────┴─────────────────────────────┴──────────────┤
│  ◀◀  ▶ pause  ▶│ step   speed ──●──   t = 342 / 1000        │
└─────────────────────────────────────────────────────────────┘
```

The parameter panel is generated from the `Disease` dataclass fields rather than
hand-written, so adding a rate to the model adds a slider for free.

Two interactions worth building early because they're where the insight lives:

- **Scrub the timeline.** Keep every frame client-side (it's megabytes) so the
  slider replays without re-running. Watching where the first office lights up is
  the whole reason to draw the network.
- **Click a node.** Show that person's attributes, household, office, and
  neighbor states. This is your debugger for the transition logic.

## Build order

| # | Deliverable | Why here |
|---|---|---|
| 0 | `Simulation` class, seeded RNG, `step()` returns transitions, `Disease` dataclass | Everything depends on it; valuable standalone |
| 1 | `server.py` — WebSocket, `init` + `frame`, run/pause/step/reset | Verify with `wscat` before any React exists |
| 2 | Vite scaffold, transport controls, live compartment counts | Smallest thing that beats the notebook |
| 3 | Stacked area chart | First real payoff |
| 4 | Canvas network with frozen layout | The visual you actually want |
| 5 | Parameter panel + reset-and-rerun | Closes the iteration loop |
| 6 | Timeline scrub, node inspector, A/B two seeds side by side | Where it gets genuinely useful |

Steps 0–3 are the point at which this replaces the notebook. 4–6 are the reason
to build it rather than just adding a matplotlib call.

## Open questions — resolved, and what was built

- **Does the server hold one run or many?** → **One run per connection.**
  Implemented as a `Session` object owned by the WebSocket handler. Verified with
  three concurrent connections: two sharing a seed produced identical count
  trajectories, the third diverged, and none interfered.
- **Is 1000 people the target, or a placeholder?** → **Placeholder; scale is the
  direction.** So the parts that would otherwise have to be rewritten were built
  for it up front: client history is keyframes-plus-deltas rather than a state
  array per frame, the layout is O(N) and deterministic rather than a force
  simulation, counts are maintained incrementally rather than recounted, and the
  edge layer degrades above 120k edges. Measured at 20,000 people: 0.7s to build,
  ~6ms/step, instant scrub. Binary frames and WebGL are still the right move past
  ~50k and are still not needed.
- **Should the notebook survive?** → **Kept.** `run_simulation()` remains a thin
  wrapper over `Simulation` and still prints its two integers; it now also prints
  the seed. A third cell shows the epidemic curve, since that is now available.

One thing this proposal did not anticipate: `EpiGraph.step` was exposing contacts
without checking their health state, so recovered and dead neighbours were being
moved into `EXPOSED`. That is why the old notebook reported `Total Dead: 0`.
Exposure is now restricted to susceptible contacts, per the method's own
docstring — see the note at the end of `README.md`.
