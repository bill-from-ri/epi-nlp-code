# utils.py
# Contains utility functions shared across the codebase.

from random import random

def compute_success(likelihood: float) -> bool:
    """
    A function that randomly determines an outcome based on a likelihood.
    """
    return random() <= likelihood