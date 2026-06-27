# disease.py
# Defines the disease parameters.

class Disease:

    beta  = 0.299   # S->E rate
    sigma = 0.143   # E->I rate
    gamma = 0.071   # I->R rate
    delta = 0.001   # I->D rate     # TODO: Review
    zeta  = 0.050   # D->R rate     # TODO: Review
    eta   = 0.050   # D->D rate     # TODO: Review
    omega = 0.003   # R->S rate
    alpha = 0.0005  # Covid death rate
