# population.py
# Procedurally generates the town.

from random import Random

from entities import OfficeType, Person, Household, Office, Population
from utils import compute_success

OBESITY_RATE = 0.37
SMOKING_RATE = 0.095
ASTHMA_RATE  = 0.085
CAR_OWNERSHIP = 0.92
AVG_HOUSEHOLD_SIZE = 3.15
AVG_OFFICE_SIZE    = 20.0   # TODO: Revise

# TODO: Consider merging with the Population class.

def generate_town(init_size: int, rng: Random) -> Population:
    """
    Given a starting population size, this function generates a Population.

    Every entity id is contiguous from zero within this population, so the
    client can index arrays by person id directly.
    """

    office_types = list(OfficeType)

    # Start by initializing standalone entities
    households = [
        Household(
            id=i,
            wealth=rng.random(),
            has_car=compute_success(CAR_OWNERSHIP, rng)
        ) for i in range(max(1, int(init_size / AVG_HOUSEHOLD_SIZE)))
    ]
    offices = [
        Office(
            id=i,
            office_type=rng.choice(office_types)
        ) for i in range(max(1, int(init_size / AVG_OFFICE_SIZE)))
    ]

    # Next initialize people
    persons = [
        Person(
            id=i,
            household_id=rng.choice(households).id,
            office_id=rng.choice(offices).id,
            age=int(rng.random() * 100),
            is_obese=compute_success(OBESITY_RATE, rng),
            is_smoker=compute_success(SMOKING_RATE, rng),
            is_asthmatic=compute_success(ASTHMA_RATE, rng),
        ) for i in range(init_size)
    ]

    # Return the completed population
    return Population(
        people=persons,
        households=households,
        offices=offices
    )
