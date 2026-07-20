# ABM — epidemic on a contact network

An agent-based SEIR-style model of a procedurally generated town, with a live
frontend for running it and watching what happens.

```
entities.py population.py graph.py disease.py utils.py   # the model
layout.py                                                # fixed 2D positions
simulation.py                                            # Simulation class + notebook wrapper
server.py                                                # FastAPI + WebSocket, one run per connection
web/                                                     # Vite + React + TypeScript
abm.ipynb                                                # the model in 20 lines
```

## Running it

```bash
pip install fastapi uvicorn websockets
cd web && npm install && npm run build && cd ..
python server.py                      # http://127.0.0.1:8000
```

`server.py` serves `web/dist` when it exists, so that is the whole app. For
frontend work, run the two separately — Vite proxies `/api` and `/ws` to
uvicorn:

```bash
python -m uvicorn server:app --port 8000    # terminal 1
cd web && npm run dev                       # terminal 2, http://127.0.0.1:5173
```

The notebook path still works and needs none of the above:

```python
from simulation import run_simulation
run_simulation(seed=42)
```

## The model

Six compartments — susceptible, exposed, infected, dire, recovered, dead — over
a contact graph where every household and every office is a clique. At the
default 1000 people that is roughly 11k edges.

A step marks every transition, then applies them. The six marked sets are
pairwise disjoint, because each is keyed on a person's state at the *start* of
the step, so the result does not depend on the order they are applied in.

Three properties the frontend depends on:

- **`Simulation.step()` returns a `Snapshot`** — the counts and the list of
  people who changed. The epidemic curve is what the model is for; it used to be
  computed 1000 times and thrown away.
- **Runs are reproducible.** All randomness comes from `random.Random(seed)`
  instances, never the module globals. A run with no seed picks one and reports
  it. The seed drives two independent streams, so changing the disease
  parameters re-rolls the epidemic over an *identical* town — which is what
  makes A/B comparison mean anything.
- **Entity ids are per-population**, assigned by `generate_town`, contiguous
  from zero. They used to come from class-level `itertools.count` objects that
  never reset, which is invisible in a notebook and wrong in a server holding
  several runs at once.

`Disease` is a frozen dataclass whose fields carry their own symbol, range and
description. `/api/schema` serves that, and the frontend generates its sliders
from it — adding a rate to the model adds a control with no frontend change.

## Wire protocol

One run per WebSocket connection, so two tabs never fight over one simulation.
The server builds a default run on connect.

Server to client:

| message | when | contents |
|---|---|---|
| `building` | a run is being constructed | — |
| `init` | once per run | seed, nodes (with starting health), edges, frozen layout, counts |
| `frames` | as the run advances | a batch of `{t, counts, changed}` |
| `status` | on any state change | running, t, speed, over, atEnd, message |
| `person` | on inspect | one person's attributes and neighbour states |
| `error` | on failure | message |

Client to server: `{cmd: 'run' | 'pause' | 'step' | 'reset' | 'speed' | 'inspect' | 'status'}`.

Frames are **batched** rather than one message per step. Above ~30 steps/sec the
client cannot paint each frame as it lands, so the pump sends every computed
frame but groups them — the client still receives a contiguous, gap-free
sequence, which it checks on arrival.

## Rendering

The topology never changes during a run, so the layout is computed once on the
server and frozen. Per-frame work is then recolouring the handful of nodes in
`changed`, not running a physics simulation.

`layout.py` places offices on a phyllotaxis spiral and packs each office's
members into a disc, ordered by household so housemates land adjacent. It is
O(N) and deterministic. Because the renderer takes coordinates as input,
swapping in a force-directed layout is a local change.

Edges are rasterised once into an offscreen canvas and blitted; nodes are
stamped on top. Above 120k edges the edge layer is dropped and the clusters
carry the structure.

Client-side history is **keyframes plus deltas**, not a state array per frame:
scrubbing copies the nearest keyframe and replays forward. At 1000 people the
difference is academic; at 100k it is the difference between 100MB and a few.

Compartment colours were validated with a palette checker rather than chosen by
eye — both light and dark pass the lightness band, adjacent-pair colour-vision
separation, and contrast. The two deliberate deviations are documented in
`web/src/theme.ts`.

## Limits

`MAX_POPULATION` 200,000 and `MAX_STEPS` 100,000, both in `server.py`. Measured
on this machine at 20,000 people (~231k edges): 0.7s to build and lay out,
~6ms per step, scrubbing effectively instant.

Past roughly 50k agents the honest next steps are binary `ArrayBuffer` frames
instead of JSON and a WebGL renderer instead of 2D canvas. Neither is needed
yet, and the seams for both are the same two functions.

## A behavioural change to be aware of

`EpiGraph.step` used to mark *every* contact of an infected person for
exposure, with no check on that contact's state — so recovered and even dead
neighbours could be moved into `EXPOSED`. Dead people came back. That is why the
old notebook printed `Total Dead: 0`.

Exposure is now restricted to susceptible contacts, matching the method's own
docstring. Deaths now persist, and figures from before this change are not
comparable to figures after it.
