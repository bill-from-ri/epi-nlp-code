# utils.py
# Contains utility functions shared across the codebase.

from random import Random

def compute_success(likelihood: float, rng: Random) -> bool:
    """
    A function that randomly determines an outcome based on a likelihood.

    The RNG is injected rather than drawn from the `random` module globals so
    that a run is reproducible from its seed alone, and so that concurrent
    simulations in one process do not consume each other's random stream.
    """
    return rng.random() <= likelihood
