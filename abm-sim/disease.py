# disease.py
# Defines the disease parameters.

class Disease:

    beta  = 0.299   # S->E rate
    sigma = 0.143   # E->I rate
    gamma = 0.071   # I->R rate
    omega = 0.003   # R->S rate
    alpha = 0.0005  # Covid death rate
