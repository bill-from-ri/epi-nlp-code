# layout.py
# Computes a fixed 2D position for every person, once, before the run starts.

import math

from entities import Population

# The golden angle. Placing the i-th point at angle i*PHI and radius sqrt(i)
# gives a phyllotaxis spiral: uniform density, no clumping, no seams, and O(1)
# per point. It is what lets this scale where a force simulation would not.
GOLDEN_ANGLE = math.pi * (3.0 - math.sqrt(5.0))


def _spiral(i: int, spacing: float) -> tuple[float, float]:
    r = spacing * math.sqrt(i)
    theta = i * GOLDEN_ANGLE
    return r * math.cos(theta), r * math.sin(theta)


def cluster_layout(population: Population) -> list[tuple[float, float]]:
    """
    Lay the town out as clusters-of-clusters, matching its actual structure:
    one disc per office, people packed inside it ordered by household so that
    housemates land next to each other and household edges stay short.

    Deterministic, O(N), and independent of the epidemic — so it is computed
    once and frozen, and every subsequent frame is a recolor rather than a
    physics tick. Returns coordinates normalised into the unit square.

    The renderer takes coordinates as input, so swapping in a force-directed
    layout here is a local change if the hairball ever looks better than this.
    """

    people  = population.people
    offices = population.offices
    n = len(people)
    if n == 0:
        return []

    positions: list[tuple[float, float]] = [(0.0, 0.0)] * n

    # People with no office still need a home on the canvas; bucket them together.
    members_by_office: dict[int, list] = {oid: [] for oid in offices}
    unassigned: list = []
    for person in people.values():
        bucket = members_by_office.get(person.office_id)
        if bucket is None:
            unassigned.append(person)
        else:
            bucket.append(person)

    groups = [members_by_office[oid] for oid in sorted(members_by_office)]
    if unassigned:
        groups.append(unassigned)
    groups = [g for g in groups if g]

    # Office discs are themselves spiralled. Their spacing is set by the largest
    # office so that even the biggest disc clears its neighbours.
    largest = max(len(g) for g in groups)
    member_spacing = 1.0
    disc_radius    = member_spacing * math.sqrt(max(largest - 1, 1))
    # Spacing is set from the largest disc so nothing collides, with enough
    # margin that offices read as separate clusters once the edges are drawn
    # over them. Below about 3x they touch and the whole thing looks like one
    # hairball, which is the failure this layout exists to avoid.
    office_spacing = disc_radius * 3.4

    for index, members in enumerate(groups):
        cx, cy = _spiral(index, office_spacing)
        # Sorting by household keeps housemates adjacent inside the disc.
        members.sort(key=lambda p: (p.household_id if p.household_id is not None else -1, p.id))
        for offset, person in enumerate(members):
            dx, dy = _spiral(offset, member_spacing)
            positions[person.id] = (cx + dx, cy + dy)

    return _normalise(positions)


def _normalise(positions: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """Fit into the unit square, preserving aspect ratio so discs stay circular."""
    xs = [p[0] for p in positions]
    ys = [p[1] for p in positions]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)

    span = max(max_x - min_x, max_y - min_y)
    if span <= 0:
        return [(0.5, 0.5)] * len(positions)

    # Centre the shorter axis rather than stretching it.
    pad_x = (span - (max_x - min_x)) / 2.0
    pad_y = (span - (max_y - min_y)) / 2.0

    return [
        ((x - min_x + pad_x) / span, (y - min_y + pad_y) / span)
        for x, y in positions
    ]
