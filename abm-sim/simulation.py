# simulation.py
# Runs the ABM simulation.

from itertools import combinations

from population import generate_town
from entities import HealthState
from graph import EpiGraph

def run_simulation(population_size=1000, init_infected=1, sim_length=1000):
    """
    Main function for the simulation.
    """

    # Initialize the town
    population = generate_town(population_size)
    for n in range(init_infected):
        population.people[n].health_state = HealthState.INFECTED

    # Initialize the graph
    contact_graph = EpiGraph(population.people.values())
    for members in population.household_members.values():
        pairings = list(combinations(members, 2))
        for fst, snd in pairings:
            contact_graph.create_edge(fst, snd)
    for members in population.office_members.values():
        pairings = list(combinations(members, 2))
        for fst, snd in pairings:
            contact_graph.create_edge(fst, snd)

    # Run the simulation
    for _ in range(sim_length):
        contact_graph.step()

    # Count total infected
    total_infected = [
        p.health_state == HealthState.INFECTED
        for p in population.people.values()
    ].count(True)
    total_dead = [
        p.health_state == HealthState.DEAD
        for p in population.people.values()
    ].count(True)

    # Print results
    print(f"Total Infected: {total_infected}")
    print(f"Total Dead: {total_dead}")