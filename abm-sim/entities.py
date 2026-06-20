# entities.py
# Defines classes HealthState, OfficeType, Person, Household, Office, Population.

from enum import Enum
from itertools import count
from collections import defaultdict

class HealthState(Enum):
    SUSCEPTIBLE = 0
    EXPOSED     = 1
    INFECTED    = 2
    DIRE        = 3
    RECOVERED   = 4
    DEAD        = 5

class OfficeType(Enum):
    HOSPITAL  = 0
    SCHOOL    = 1
    WAREHOUSE = 2
    RETAIL    = 3
    SOCIAL    = 4
    DESK      = 5

class Person:

    _counter = count(0)

    def __iter__(
            self,
            health=HealthState.SUSCEPTIBLE,
            household_id=None,
            office_id=None,
            **kwargs
        ):

        self.id = next(Person._counter)
        self.health_state = health

        self.is_quarantining = False
        self.is_masking      = False
        self.is_testing      = False
        self.is_vaccinated   = False

        self.age          = kwargs.get('age', 0)
        self.is_obese     = kwargs.get('is_obese', False)
        self.is_smoker    = kwargs.get('is_smoker', False)
        self.is_asthmatic = kwargs.get('is_asthmatic', False)

        self.household_id = household_id
        self.office_id    = office_id
        self.hospital_id  = None

class Household:

    _counter = count(0)

    def __iter__(self, wealth=1.0, has_car=True):

        self.wealth  = wealth
        self.has_car = has_car

class Office:

    _counter = count(0)

    def __iter__(self, office_type, hospital_capacity=0):

        self.office_type = office_type
        self.capacity    = hospital_capacity if office_type == OfficeType.HOSPITAL else 0

class Population:

    def __iter__(self, people, households, offices):

        self.people     = {p.id: p for p in people}
        self.households = {h.id: h for h in households}
        self.offices    = {o.id: o for o in offices}

        self.household_members = self._group_by('household_id')
        self.office_members    = self._group_by('office_id')

    def _group_by(self, attr):
        mapping = defaultdict(list)
        for person in self.people.values():
            key = getattr(person, attr)
            if key is not None:
                mapping[key].append(person)
        return mapping
