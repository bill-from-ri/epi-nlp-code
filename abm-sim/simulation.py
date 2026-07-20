# simulation.py
# Runs the ABM simulation.

from dataclasses import dataclass
from random import Random
from typing import Iterator

from population import generate_town
from entities import HealthState
from graph import EpiGraph, Transitions, N_STATES
from disease import Disease
from layout import cluster_layout

MAX_SEED = 2 ** 32


@dataclass(frozen=True)
class Snapshot:
    """One simulation tick, as the client needs it."""

    t: int
    counts: list[int]                  # indexed by HealthState value
    changed: list[tuple[int, int]]     # (person id, new HealthState value)

    @property
    def active(self) -> int:
        """People who can still drive the epidemic forward."""
        return (self.counts[HealthState.EXPOSED.value]
                + self.counts[HealthState.INFECTED.value]
                + self.counts[HealthState.DIRE.value])


class Simulation:
    """
    A single run, advanced one step at a time by whoever owns it.

    The notebook wants a number at the end; the server wants every frame as it
    happens. Exposing `step()` rather than a `run_simulation()` that loops
    internally lets both have what they want off one implementation.
    """

    def __init__(
            self,
            population_size: int = 1000,
            init_infected: int = 1,
            seed: int | None = None,
            disease: Disease | None = None,
        ):

        self.population_size = max(1, int(population_size))
        self.init_infected   = max(0, min(int(init_infected), self.population_size))
        self.disease         = disease or Disease()

        # A recorded seed, always. `None` means "pick one and tell me which",
        # not "be irreproducible".
        self.seed = int(seed) if seed is not None else Random().randrange(MAX_SEED)

        # Two independent streams off the one seed, so that changing the disease
        # parameters re-rolls the epidemic while leaving the town identical.
        master = Random(self.seed)
        town_rng = Random(master.randrange(MAX_SEED))
        self.rng = Random(master.randrange(MAX_SEED))

        # Initialize the town
        self.population = generate_town(self.population_size, town_rng)

        patient_zeros = self.rng.sample(
            sorted(self.population.people), self.init_infected
        )
        for pid in patient_zeros:
            self.population.people[pid].health_state = HealthState.INFECTED

        # Initialize the graph. Households and offices are both cliques.
        self.contact_graph = EpiGraph(
            self.population.people.values(), self.disease, self.rng
        )
        for members in self.population.household_members.values():
            self.contact_graph.add_clique(members)
        for members in self.population.office_members.values():
            self.contact_graph.add_clique(members)
        self.contact_graph.freeze()

        self.t = 0

    # --- running ----------------------------------------------------------

    def step(self) -> Snapshot:
        """Advance one tick and return what changed."""
        transitions: Transitions = self.contact_graph.step()
        self.t += 1
        return Snapshot(
            t=self.t,
            counts=list(self.contact_graph.counts),
            changed=transitions.changed(),
        )

    def run(self, n: int) -> Iterator[Snapshot]:
        """Advance up to `n` ticks, stopping early once the epidemic is over."""
        for _ in range(n):
            if self.is_over:
                return
            yield self.step()

    @property
    def is_over(self) -> bool:
        """
        No exposed, infected or dire cases left. Recovered people may still wane
        back to susceptible, but with no source of infection nothing else can
        happen, so there is nothing left to watch.
        """
        counts = self.contact_graph.counts
        return (counts[HealthState.EXPOSED.value]
                + counts[HealthState.INFECTED.value]
                + counts[HealthState.DIRE.value]) == 0

    # --- reporting --------------------------------------------------------

    def snapshot(self) -> Snapshot:
        """Current state as a frame, with every person listed as 'changed'."""
        return Snapshot(
            t=self.t,
            counts=list(self.contact_graph.counts),
            changed=[
                (p.id, p.health_state.value)
                for p in self.contact_graph.people
            ],
        )

    def counts(self) -> list[int]:
        return list(self.contact_graph.counts)

    def total(self, state: HealthState) -> int:
        return self.contact_graph.counts[state.value]

    def describe_person(self, pid: int) -> dict | None:
        """Everything the node inspector shows about one person."""
        person = self.population.people.get(pid)
        if person is None:
            return None
        household = self.population.households.get(person.household_id)
        office    = self.population.offices.get(person.office_id)
        neighbours = self.contact_graph.adjacency[pid]
        neighbour_counts = [0] * N_STATES
        for nid in neighbours:
            neighbour_counts[self.contact_graph.people[nid].health_state.value] += 1
        return {
            'id': person.id,
            'health': person.health_state.value,
            'age': person.age,
            'isObese': person.is_obese,
            'isSmoker': person.is_smoker,
            'isAsthmatic': person.is_asthmatic,
            'household': None if household is None else {
                'id': household.id,
                'wealth': round(household.wealth, 3),
                'hasCar': household.has_car,
                'size': len(self.population.household_members[household.id]),
            },
            'office': None if office is None else {
                'id': office.id,
                'type': office.office_type.name,
                'size': len(self.population.office_members[office.id]),
            },
            'degree': len(neighbours),
            'neighbourCounts': neighbour_counts,
        }

    def init_payload(self) -> dict:
        """
        The static structure, sent once per run. The layout is computed here and
        then frozen: topology never changes during a run, so the client's
        per-frame work is recoloring the handful of nodes that moved.
        """
        positions = cluster_layout(self.population)
        people = self.contact_graph.people
        return {
            'type': 'init',
            'seed': self.seed,
            'populationSize': self.population_size,
            'initInfected': self.init_infected,
            'disease': self.disease.to_dict(),
            'nodes': [
                {
                    'id': p.id,
                    'household': p.household_id,
                    'office': p.office_id,
                    'officeType': self.population.offices[p.office_id].office_type.value,
                    'age': p.age,
                    # The starting health state, so the client's t=0 keyframe is
                    # the real one. Patient zero is drawn at random, so it cannot
                    # be reconstructed from the counts alone.
                    'health': p.health_state.value,
                }
                for p in people
            ],
            'edges': self.contact_graph.edges(),
            'layout': [{'x': round(x, 5), 'y': round(y, 5)} for x, y in positions],
            'counts': self.counts(),
        }


def run_simulation(population_size=1000, init_infected=1, sim_length=1000, seed=None):
    """
    Main function for the simulation.

    Kept as a thin wrapper over `Simulation` so the notebook still reads as
    "here's the model in 20 lines".
    """

    sim = Simulation(
        population_size=population_size,
        init_infected=init_infected,
        seed=seed,
    )

    for _ in sim.run(sim_length):
        pass

    # Print results
    print(f"Seed: {sim.seed}")
    print(f"Steps: {sim.t}")
    print(f"Total Infected: {sim.total(HealthState.INFECTED)}")
    print(f"Total Dead: {sim.total(HealthState.DEAD)}")

    return sim
