# server.py
# Serves one simulation per WebSocket connection.

import asyncio
import logging
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from disease import Disease
from entities import HealthState, OfficeType
from simulation import Simulation

log = logging.getLogger('abm')

# Guard rails. A run is built synchronously in a worker thread, and the client
# holds every frame in memory for scrubbing, so both ends need an upper bound.
MAX_POPULATION = 200_000
MAX_STEPS      = 100_000
DEFAULT_STEPS  = 1_000

# The frame pump wakes at most this often. Above this rate the client could not
# paint each frame anyway, so faster speeds batch several steps per message
# rather than sending more messages.
TICK_HZ = 30.0
# Steps executed between yields to the event loop, so a fast run stays
# responsive to a pause command instead of blocking until the batch is done.
STEPS_PER_YIELD = 200

app = FastAPI(title='ABM simulation server')

# The Vite dev server runs on a different origin; the browser needs this to
# reach the HTTP endpoints. WebSockets are not subject to CORS, but /api is.
app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_methods=['*'],
    allow_headers=['*'],
)


@app.get('/api/schema')
def schema():
    """Everything the client needs to build its UI without hardcoding the model."""
    return JSONResponse({
        'disease': Disease.schema(),
        'healthStates': [s.name for s in sorted(HealthState, key=lambda s: s.value)],
        'officeTypes': [t.name for t in sorted(OfficeType, key=lambda t: t.value)],
        'limits': {
            'maxPopulation': MAX_POPULATION,
            'maxSteps': MAX_STEPS,
            'defaultSteps': DEFAULT_STEPS,
        },
    })


def _clamp(value, lo, hi, fallback):
    try:
        return max(lo, min(hi, int(value)))
    except (TypeError, ValueError):
        return fallback


class Session:
    """
    One run, owned by one connection.

    Session-per-connection rather than one global run: it costs almost nothing,
    it keeps two browser tabs from fighting over the same simulation, and it is
    what makes running two seeds side by side possible.
    """

    def __init__(self, websocket: WebSocket):
        self.ws = websocket
        self.sim: Simulation | None = None
        self.running = False
        self.speed = 10.0          # steps per second
        self.max_steps = DEFAULT_STEPS
        self.pump: asyncio.Task | None = None
        self.lock = asyncio.Lock()

    # --- outbound ---------------------------------------------------------

    async def send(self, payload: dict):
        await self.ws.send_json(payload)

    async def send_status(self, message: str | None = None):
        sim = self.sim
        await self.send({
            'type': 'status',
            'running': self.running,
            't': sim.t if sim else 0,
            'speed': self.speed,
            'maxSteps': self.max_steps,
            'over': bool(sim and sim.is_over),
            'atEnd': bool(sim and sim.t >= self.max_steps),
            'message': message,
        })

    async def send_error(self, message: str):
        await self.send({'type': 'error', 'message': message})

    # --- lifecycle --------------------------------------------------------

    async def reset(self, params: dict | None):
        """Build a fresh run and ship its static structure."""
        await self.stop_pump()

        params = params or {}
        population_size = _clamp(params.get('populationSize', 1000), 1, MAX_POPULATION, 1000)
        init_infected   = _clamp(params.get('initInfected', 1), 0, population_size, 1)
        self.max_steps  = _clamp(params.get('maxSteps', DEFAULT_STEPS), 1, MAX_STEPS, DEFAULT_STEPS)
        self.speed      = float(params.get('speed', self.speed) or self.speed)

        seed = params.get('seed')
        seed = None if seed in (None, '') else _clamp(seed, 0, 2**32 - 1, None)
        disease = Disease.from_dict(params.get('disease'))

        await self.send({'type': 'building'})

        # Building a large town and its cliques is seconds of pure CPU. Off the
        # event loop, or every other connection stalls behind it.
        def build():
            sim = Simulation(
                population_size=population_size,
                init_infected=init_infected,
                seed=seed,
                disease=disease,
            )
            return sim, sim.init_payload()

        try:
            self.sim, payload = await asyncio.to_thread(build)
        except Exception as exc:                      # noqa: BLE001 - report, don't die
            log.exception('failed to build simulation')
            await self.send_error(f'Could not build simulation: {exc}')
            return

        payload['maxSteps'] = self.max_steps
        await self.send(payload)
        await self.send_status('ready')

    async def stop_pump(self):
        self.running = False
        pump, self.pump = self.pump, None
        if pump:
            pump.cancel()
            try:
                await pump
            except asyncio.CancelledError:
                pass

    # --- stepping ---------------------------------------------------------

    def _advance(self, n: int) -> list[dict]:
        """Run up to n steps synchronously, stopping at the end of the run."""
        sim = self.sim
        frames = []
        for _ in range(n):
            if sim.is_over or sim.t >= self.max_steps:
                break
            snap = sim.step()
            frames.append({'t': snap.t, 'counts': snap.counts, 'changed': snap.changed})
        return frames

    async def step_once(self):
        if not await self._require_sim():
            return
        await self.stop_pump()
        frames = self._advance(1)
        if frames:
            await self.send({'type': 'frames', 'frames': frames})
        await self.send_status()

    async def start(self):
        if not await self._require_sim():
            return
        if self.running:
            return
        if self.sim.is_over or self.sim.t >= self.max_steps:
            await self.send_status('run already complete - reset to go again')
            return
        self.running = True
        self.pump = asyncio.create_task(self._pump())
        await self.send_status()

    async def _pump(self):
        """
        Advance in wall-clock time at `self.speed` steps per second.

        Steps due are recomputed from elapsed time rather than assumed, so a
        slow step falls behind honestly instead of silently drifting, and a
        speed change takes effect on the next tick.
        """
        loop = asyncio.get_running_loop()
        carry = 0.0
        last = loop.time()
        try:
            while self.running:
                await asyncio.sleep(1.0 / TICK_HZ)
                now = max(loop.time(), last)
                carry += (now - last) * self.speed
                last = now

                due = int(carry)
                if due <= 0:
                    continue
                carry -= due

                frames = []
                while due > 0:
                    chunk = self._advance(min(due, STEPS_PER_YIELD))
                    frames.extend(chunk)
                    due -= STEPS_PER_YIELD
                    if len(chunk) < STEPS_PER_YIELD:
                        break            # hit the end of the run
                    await asyncio.sleep(0)

                if frames:
                    await self.send({'type': 'frames', 'frames': frames})

                if self.sim.is_over or self.sim.t >= self.max_steps:
                    self.running = False
                    reason = 'epidemic over' if self.sim.is_over else 'reached step limit'
                    await self.send_status(reason)
                    return
        except asyncio.CancelledError:
            raise
        except (WebSocketDisconnect, RuntimeError):
            self.running = False
        except Exception:                            # noqa: BLE001
            log.exception('pump failed')
            self.running = False
            await self.send_error('Simulation stopped unexpectedly.')

    async def pause(self):
        await self.stop_pump()
        await self.send_status()

    async def set_speed(self, value):
        try:
            self.speed = max(0.5, min(2000.0, float(value)))
        except (TypeError, ValueError):
            return
        await self.send_status()

    async def inspect(self, pid):
        if not await self._require_sim():
            return
        detail = self.sim.describe_person(_clamp(pid, 0, 2**31, 0))
        if detail is None:
            await self.send_error(f'No person with id {pid}')
            return
        await self.send({'type': 'person', 'person': detail})

    async def _require_sim(self) -> bool:
        if self.sim is None:
            await self.send_error('No simulation yet - send a reset first.')
            return False
        return True

    # --- inbound ----------------------------------------------------------

    async def handle(self, message: dict):
        cmd = message.get('cmd')
        # Serialised: a reset arriving mid-pump must not race the stepper.
        async with self.lock:
            match cmd:
                case 'reset':
                    await self.reset(message.get('params'))
                case 'run':
                    await self.start()
                case 'pause':
                    await self.pause()
                case 'step':
                    await self.step_once()
                case 'speed':
                    await self.set_speed(message.get('value'))
                case 'inspect':
                    await self.inspect(message.get('id'))
                case 'status':
                    await self.send_status()
                case _:
                    await self.send_error(f'Unknown command: {cmd!r}')


@app.websocket('/ws')
async def ws_endpoint(websocket: WebSocket):
    await websocket.accept()
    session = Session(websocket)
    try:
        # Start from a default run so the client has something to show at once.
        async with session.lock:
            await session.reset(None)
        while True:
            message = await websocket.receive_json()
            if not isinstance(message, dict):
                await session.send_error('Expected a JSON object.')
                continue
            await session.handle(message)
    except (WebSocketDisconnect, asyncio.CancelledError):
        pass
    except Exception:                                # noqa: BLE001
        log.exception('websocket session failed')
    finally:
        await session.stop_pump()


# Serve the built frontend when there is one, so `python server.py` is the whole
# app in production. In development Vite serves the client instead.
_dist = Path(__file__).parent / 'web' / 'dist'
if _dist.is_dir():
    app.mount('/', StaticFiles(directory=str(_dist), html=True), name='web')


if __name__ == '__main__':
    import uvicorn
    logging.basicConfig(level=logging.INFO)
    uvicorn.run(app, host='127.0.0.1', port=8000)
