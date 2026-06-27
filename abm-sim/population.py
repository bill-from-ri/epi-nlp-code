# population.py
# Procedurally generates the town.

from random import random, choice

from entities import OfficeType, Person, Household, Office, Population
from utils import compute_success

OBESITY_RATE = 0.37
SMOKING_RATE = 0.095
ASTHMA_RATE  = 0.085
CAR_OWNERSHIP = 0.92
AVG_HOUSEHOLD_SIZE = 3.15
AVG_OFFICE_SIZE    = 20.0   # TODO: Revise

# TODO: Consider merging with the Population class.

def generate_town(init_size):
    """
    Given a starting population size, this function generates a Population.
    """

    # Start by initializing standalone entities
    households = [
        Household(
            wealth=random(),
            has_car=compute_success(CAR_OWNERSHIP)
        ) for _ in range(int(init_size / AVG_HOUSEHOLD_SIZE))
    ]
    offices = [
        Office(
            office_type=choice(list(OfficeType))
        ) for _ in range(int(init_size / AVG_OFFICE_SIZE))
    ]

    # Next initialize people
    persons = [
        Person(
            household_id=choice(households).id,
            office_id=choice(offices).id,
            age=int(random() * 100),
            is_obese=compute_success(OBESITY_RATE),
            is_smoker=compute_success(SMOKING_RATE),
            is_asthmatic=compute_success(ASTHMA_RATE),
        ) for _ in range(init_size)
    ]

    # Return the completed population
    return Population(
        people=persons,
        households=households,
        offices=offices
    )