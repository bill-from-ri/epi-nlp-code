# graph.py
# Defines the contact graph used as the base for the simulation.

from collections import defaultdict

from entities import HealthState, Person
from disease import Disease as d
from utils import compute_success

class EpiGraph:

    def __init__(self, people: list[Person]):

        self.graph  = defaultdict(list)
        self.people = {p.id: p for p in people}

    def create_edge(self, fst, snd):
        if snd.id not in self.graph[fst.id]:
            self.graph[fst.id].append(snd.id)
        if fst.id not in self.graph[snd.id]:
            self.graph[snd.id].append(fst.id)

    def step(self):
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
        for person in self.people.values():
            match person.health_state:
                case HealthState.INFECTED:
                    for contact_id in self.graph[person.id]:

                        contact = self.people[contact_id]
                        # TODO: Add likelihood calculation.
                        if compute_success(d.beta):
                            marked_for_exposure.add(contact_id)

                    # TODO: Add likelihood calculation.
                    might_recover = compute_success(d.gamma)
                    might_worsen  = compute_success(d.delta)
                    if might_recover:
                        marked_for_recovered.add(person.id)
                    elif might_worsen:
                        marked_for_dire.add(person.id)

                case HealthState.EXPOSED:
                    if compute_success(d.sigma):
                        marked_for_infection.add(person.id)

                case HealthState.DIRE:

                    might_recover = compute_success(d.zeta)
                    might_worsen  = compute_success(d.eta)
                    if might_recover:
                        marked_for_recovered.add(person.id)
                    elif might_worsen:
                        marked_for_dead.add(person.id)

                case HealthState.RECOVERED:
                    if compute_success(d.omega):
                        marked_for_susceptible.add(person.id)

        for pid in list(marked_for_exposure):
            self.people[pid].health_state = HealthState.EXPOSED
        for pid in list(marked_for_infection):
            self.people[pid].health_state = HealthState.INFECTED
        for pid in list(marked_for_dire):
            self.people[pid].health_state = HealthState.DIRE
        for pid in list(marked_for_recovered):
            self.people[pid].health_state = HealthState.RECOVERED
        for pid in list(marked_for_dead):
            self.people[pid].health_state = HealthState.DEAD
        for pid in list(marked_for_susceptible):
            self.people[pid].health_state = HealthState.SUSCEPTIBLE
