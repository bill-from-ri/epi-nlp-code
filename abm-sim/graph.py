# graph.py
# Defines the contact graph used as the base for the simulation.

from dataclasses import dataclass, field
from itertools import combinations
from random import Random

from entities import HealthState, Person
from disease import Disease

N_STATES = len(HealthState)
_STATE_BY_VALUE = {s.value: s for s in HealthState}


@dataclass
class Transitions:
    """
    Everything that changed during one step.

    `step()` already computes exactly this and used to throw it away. The
    compartment counts and the per-node recolor list both fall out of it for
    free, with no extra pass over the population.

    The six sets are pairwise disjoint: each is keyed on the person's state at
    the start of the step, and no person occupies two compartments at once. So
    `changed` is unambiguous and independent of application order.
    """

    exposed:     list[int] = field(default_factory=list)
    infected:    list[int] = field(default_factory=list)
    dire:        list[int] = field(default_factory=list)
    recovered:   list[int] = field(default_factory=list)
    dead:        list[int] = field(default_factory=list)
    susceptible: list[int] = field(default_factory=list)

    def changed(self) -> list[tuple[int, int]]:
        """[(person id, new HealthState value)] for every person who moved."""
        return [
            (pid, state.value)
            for group, state in (
                (self.exposed,     HealthState.EXPOSED),
                (self.infected,    HealthState.INFECTED),
                (self.dire,        HealthState.DIRE),
                (self.recovered,   HealthState.RECOVERED),
                (self.dead,        HealthState.DEAD),
                (self.susceptible, HealthState.SUSCEPTIBLE),
            )
            for pid in group
        ]

    def __len__(self):
        return (len(self.exposed) + len(self.infected) + len(self.dire)
                + len(self.recovered) + len(self.dead) + len(self.susceptible))


class EpiGraph:

    def __init__(self, people: list[Person], disease: Disease, rng: Random):

        # People are stored positionally, not in a dict: ids are contiguous from
        # zero, and this is the hot loop.
        self.people   = sorted(people, key=lambda p: p.id)
        self.disease  = disease
        self.rng      = rng
        self.adjacency: list[list[int]] = [[] for _ in self.people]

        self._edge_set: set[tuple[int, int]] | None = set()

        self.counts = [0] * N_STATES
        for person in self.people:
            self.counts[person.health_state.value] += 1

    # --- construction -----------------------------------------------------

    def create_edge(self, fst, snd):
        """Add an undirected contact edge. Ignores duplicates and self-loops."""
        a, b = fst.id, snd.id
        if a == b:
            return
        key = (a, b) if a < b else (b, a)
        if self._edge_set is None:
            raise RuntimeError('cannot add edges after freeze()')
        if key in self._edge_set:
            return
        self._edge_set.add(key)
        self.adjacency[a].append(b)
        self.adjacency[b].append(a)

    def add_clique(self, members):
        """Fully connect a group. Households and offices are both cliques."""
        for fst, snd in combinations(members, 2):
            self.create_edge(fst, snd)

    def freeze(self):
        """
        Drop the dedup index once the topology is final. It is only needed
        during construction and is the largest allocation in the graph.
        """
        self._edge_set = None
        return self

    def edges(self) -> list[tuple[int, int]]:
        """Undirected edge list, each pair once, for the client's renderer."""
        return [
            (a, b)
            for a, neighbours in enumerate(self.adjacency)
            for b in neighbours
            if a < b
        ]

    @property
    def n_edges(self) -> int:
        return sum(len(n) for n in self.adjacency) // 2

    # --- simulation -------------------------------------------------------

    def step(self) -> Transitions:
        """
        TODO: Compute behavior changes and hospitalization.
        TODO: Move transition logic into disease.py.
        For every infected person, find each of their susceptible contacts.
            Compute exposure likelihood along that edge.
            Mark people for exposure.
        For every exposed person, roll a die for them to become infected.
            Mark people for infection.
        For every infected person,
            Compute likelihood that they transition to dire.
            Compute likelihood that they transition to recovered.
            Mark people for recovered/dire. Recovery takes priority.
        For every dire person,
            Compute likelihood that they transition to dead.
            Compute likelihood that they transition to recovered.
            Mark people for recovered/dead. Recovery takes priority.
        For every recovered person,
            Compute likelihood that they transition to susceptible.
            Mark people for susceptibility.
        Set new health states.
        """
        marked_for_exposure    = set()
        marked_for_infection   = set()
        marked_for_dire        = set()
        marked_for_recovered   = set()
        marked_for_dead        = set()
        marked_for_susceptible = set()

        d          = self.disease
        random     = self.rng.random
        people     = self.people
        adjacency  = self.adjacency
        SUSCEPTIBLE = HealthState.SUSCEPTIBLE

        for person in people:
            match person.health_state:
                case HealthState.INFECTED:
                    for contact_id in adjacency[person.id]:

                        # Only susceptible contacts can be exposed. Without this
                        # guard a draw against a recovered or dead neighbour
                        # would move them into EXPOSED, reviving the dead.
                        if people[contact_id].health_state is not SUSCEPTIBLE:
                            continue
                        if contact_id in marked_for_exposure:
                            continue
                        # TODO: Add likelihood calculation.
                        if random() <= d.beta:
                            marked_for_exposure.add(contact_id)

                    # TODO: Add likelihood calculation.
                    might_recover = random() <= d.gamma
                    might_worsen  = random() <= d.delta
                    if might_recover:
                        marked_for_recovered.add(person.id)
                    elif might_worsen:
                        marked_for_dire.add(person.id)

                case HealthState.EXPOSED:
                    if random() <= d.sigma:
                        marked_for_infection.add(person.id)

                case HealthState.DIRE:

                    might_recover = random() <= d.zeta
                    might_worsen  = random() <= d.eta
                    if might_recover:
                        marked_for_recovered.add(person.id)
                    elif might_worsen:
                        marked_for_dead.add(person.id)

                case HealthState.RECOVERED:
                    if random() <= d.omega:
                        marked_for_susceptible.add(person.id)

        transitions = Transitions(
            exposed     = sorted(marked_for_exposure),
            infected    = sorted(marked_for_infection),
            dire        = sorted(marked_for_dire),
            recovered   = sorted(marked_for_recovered),
            dead        = sorted(marked_for_dead),
            susceptible = sorted(marked_for_susceptible),
        )

        counts = self.counts
        for pid, new_value in transitions.changed():
            person = people[pid]
            counts[person.health_state.value] -= 1
            counts[new_value] += 1
            person.health_state = _STATE_BY_VALUE[new_value]

        return transitions
