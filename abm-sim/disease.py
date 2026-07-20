# disease.py
# Defines the disease parameters.

from dataclasses import dataclass, field, fields, asdict, replace


def _rate(default: float, symbol: str, description: str, hi: float = 1.0):
    """A transition rate, carrying the metadata the parameter panel is built from."""
    return field(
        default=default,
        metadata={'symbol': symbol, 'description': description, 'min': 0.0, 'max': hi},
    )


@dataclass(frozen=True)
class Disease:
    """
    Per-step transition probabilities for the compartment model.

    Frozen so a run's parameters cannot drift underneath it mid-simulation;
    use `.evolve(beta=0.4)` to derive a variant.
    """

    beta:  float = _rate(0.299,  'β', 'Susceptible -> Exposed, per infected contact')
    sigma: float = _rate(0.143,  'σ', 'Exposed -> Infected')
    gamma: float = _rate(0.071,  'γ', 'Infected -> Recovered')
    delta: float = _rate(0.001,  'δ', 'Infected -> Dire',   hi=0.2)
    zeta:  float = _rate(0.050,  'ζ', 'Dire -> Recovered')
    eta:   float = _rate(0.050,  'η', 'Dire -> Dead')
    omega: float = _rate(0.003,  'ω', 'Recovered -> Susceptible (waning immunity)', hi=0.2)
    alpha: float = _rate(0.0005, 'α', 'Baseline Covid death rate (unused by step)', hi=0.05)

    def evolve(self, **changes) -> 'Disease':
        """Return a copy with the named rates replaced."""
        return replace(self, **changes)

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict | None) -> 'Disease':
        """Build from a partial dict, ignoring unknown keys and clamping to range."""
        if not data:
            return cls()
        valid = {f.name: f for f in fields(cls)}
        kwargs = {}
        for key, value in data.items():
            if key not in valid:
                continue
            meta = valid[key].metadata
            kwargs[key] = max(meta['min'], min(meta['max'], float(value)))
        return cls(**kwargs)

    @classmethod
    def schema(cls) -> list[dict]:
        """
        Describe the fields so the frontend can generate its parameter panel.
        Adding a rate to this dataclass adds a slider to the UI for free.
        """
        return [
            {
                'name': f.name,
                'symbol': f.metadata['symbol'],
                'description': f.metadata['description'],
                'default': f.default,
                'min': f.metadata['min'],
                'max': f.metadata['max'],
            }
            for f in fields(cls)
        ]
