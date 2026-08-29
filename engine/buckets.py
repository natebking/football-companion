"""Situation buckets and the widening steps the tendency ladder walks.

Binding spec: docs/CONTRACT.md, "Situation bucket".

    distance_band: short (1-3), medium (4-7), long (8+)
    field_zone:    own_deep (80-99), own (60-79), mid (40-59), opp (20-39), red (1-19)
    key format:    d{down}_{distance_band}_{field_zone}, e.g. d3_medium_mid

Scalar helpers return None for a value the contract does not cover (null, out of
range). `bucket()` returns a string or raises, because a caller that reached it
has a live snap in hand and a silent None there would poison a lookup key.
"""
from typing import Any, List, Optional, Tuple

import numpy as np
import pandas as pd

DOWNS: Tuple[int, ...] = (1, 2, 3, 4)
DISTANCE_BANDS: Tuple[str, ...] = ("short", "medium", "long")
# ordered from own end zone toward the opponent end zone; the ladder's rung 2
# pools each zone with its immediate neighbours in this order.
FIELD_ZONES: Tuple[str, ...] = ("own_deep", "own", "mid", "opp", "red")

# inclusive (name, lo, hi)
BAND_RANGES: Tuple[Tuple[str, int, int], ...] = (("short", 0, 3), ("medium", 4, 7), ("long", 8, 99))
ZONE_RANGES: Tuple[Tuple[str, int, int], ...] = (
    ("own_deep", 80, 99), ("own", 60, 79), ("mid", 40, 59), ("opp", 20, 39), ("red", 1, 19))

# Every valid exact key, 4 downs x 3 bands x 5 zones = 60.
BUCKET_KEYS: List[str] = ["d{}_{}_{}".format(d, b, z)
                          for d in DOWNS for b in DISTANCE_BANDS for z in FIELD_ZONES]
# Keys for the widened rungs. Rung 2 pools neighbouring zones and is written with
# a leading tilde on the zone so a widened match is never mistaken for an exact one.
POOLED_KEYS: List[str] = ["d{}_{}_~{}".format(d, b, z)
                          for d in DOWNS for b in DISTANCE_BANDS for z in FIELD_ZONES]
DISTANCE_KEYS: List[str] = ["d{}_{}".format(d, b) for d in DOWNS for b in DISTANCE_BANDS]
DOWN_KEYS: List[str] = ["d{}".format(d) for d in DOWNS]


def _num(x: Any) -> Optional[float]:
    """Scalar to float, or None for null / non-numeric. Handles NaN, None, pd.NA."""
    if x is None or x is pd.NA:
        return None
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    return None if v != v else v


def distance_band(distance: Any) -> Optional[str]:
    """short (1-3), medium (4-7), long (8+). None if distance is unknown.

    A distance of 0 (a handful of goal-to-go rows in the CFBD feed) lands in
    `short`, which is where it belongs.
    """
    d = _num(distance)
    if d is None or d < 0:
        return None
    for name, lo, hi in BAND_RANGES:
        if d <= hi:
            return name
    return "long"


def field_zone(yards_to_goal: Any) -> Optional[str]:
    """own_deep (80-99), own (60-79), mid (40-59), opp (20-39), red (1-19)."""
    y = _num(yards_to_goal)
    if y is None:
        return None
    for name, lo, hi in ZONE_RANGES:
        if lo <= y <= hi:
            return name
    return None


def zone_neighbors(zone: str) -> Tuple[str, ...]:
    """The zone plus the zones on either side of it. Rung 2's loosening.

    Always strictly wider than the single zone, at every position on the field,
    so rung 2 can never be an identical filter to rung 1.
    """
    if zone not in FIELD_ZONES:
        raise ValueError("unknown field_zone {!r}".format(zone))
    i = FIELD_ZONES.index(zone)
    return FIELD_ZONES[max(0, i - 1):i + 2]


def bucket(down: Any, distance: Any, yards_to_goal: Any) -> str:
    """d{down}_{distance_band}_{field_zone}. Raises on a situation outside the contract."""
    d = _num(down)
    band = distance_band(distance)
    zone = field_zone(yards_to_goal)
    if d is None or int(d) not in DOWNS or band is None or zone is None:
        raise ValueError(
            "cannot bucket down={!r} distance={!r} yards_to_goal={!r}: "
            "down must be 1-4, distance >= 0, yards_to_goal 1-99".format(down, distance, yards_to_goal))
    return "d{}_{}_{}".format(int(d), band, zone)


def pooled_key(down: Any, distance: Any, yards_to_goal: Any) -> str:
    """Rung 2 key: same down and distance band, zone pooled with its neighbours."""
    d, band, zone = _parts(down, distance, yards_to_goal)
    return "d{}_{}_~{}".format(d, band, zone)


def distance_key(down: Any, distance: Any) -> str:
    """Rung 3 key: down and distance band, field position dropped."""
    d = _num(down)
    band = distance_band(distance)
    if d is None or int(d) not in DOWNS or band is None:
        raise ValueError("cannot key down={!r} distance={!r}".format(down, distance))
    return "d{}_{}".format(int(d), band)


def down_key(down: Any) -> str:
    """Rung 4 key: down only."""
    d = _num(down)
    if d is None or int(d) not in DOWNS:
        raise ValueError("cannot key down={!r}".format(down))
    return "d{}".format(int(d))


def _parts(down: Any, distance: Any, yards_to_goal: Any) -> Tuple[int, str, str]:
    key = bucket(down, distance, yards_to_goal)
    d, band, zone = key.split("_", 2)
    return int(d[1:]), band, zone


def distance_band_series(distance: pd.Series) -> pd.Series:
    """Vectorised distance_band. Object series of str, None where unknown."""
    d = pd.to_numeric(distance, errors="coerce")
    out = np.full(len(d), None, dtype=object)
    lo_prev = -np.inf
    for name, lo, hi in BAND_RANGES:
        out[((d >= max(0, lo)) & (d <= hi)).to_numpy()] = name
        lo_prev = hi
    out[(d > lo_prev).to_numpy()] = "long"
    return pd.Series(out, index=d.index, dtype="object")


def field_zone_series(yards_to_goal: pd.Series) -> pd.Series:
    """Vectorised field_zone. Object series of str, None where unknown."""
    y = pd.to_numeric(yards_to_goal, errors="coerce")
    out = np.full(len(y), None, dtype=object)
    for name, lo, hi in ZONE_RANGES:
        out[((y >= lo) & (y <= hi)).to_numpy()] = name
    return pd.Series(out, index=y.index, dtype="object")


def bucket_series(down: pd.Series, distance: pd.Series, yards_to_goal: pd.Series) -> pd.Series:
    """Vectorised bucket. None on any row the contract does not cover."""
    d = pd.to_numeric(down, errors="coerce")
    band = distance_band_series(distance)
    zone = field_zone_series(yards_to_goal)
    ok = d.isin(DOWNS).to_numpy() & band.notna().to_numpy() & zone.notna().to_numpy()
    out = np.full(len(d), None, dtype=object)
    if ok.any():
        keys = ("d" + d[ok].astype("Int64").astype(str) + "_" + band[ok] + "_" + zone[ok])
        out[ok] = keys.to_numpy()
    return pd.Series(out, index=d.index, dtype="object")


if __name__ == "__main__":
    print("BUCKET_KEYS", len(BUCKET_KEYS), BUCKET_KEYS[:3], "...", BUCKET_KEYS[-1])
    print("POOLED", len(POOLED_KEYS), "| DISTANCE", len(DISTANCE_KEYS), "| DOWN", len(DOWN_KEYS))
    print("bucket(3, 6, 45) ->", bucket(3, 6, 45))
    print("bucket(1, 10, 75) ->", bucket(1, 10, 75))
    print("bucket(2, 2, 8)  ->", bucket(2, 2, 8))
    print("pooled_key(3, 6, 45) ->", pooled_key(3, 6, 45),
          "| distance_key(3, 6) ->", distance_key(3, 6), "| down_key(3) ->", down_key(3))
    print("bands:", [(d, distance_band(d)) for d in (0, 1, 3, 4, 7, 8, 25, None)])
    print("zones:", [(y, field_zone(y)) for y in (99, 80, 79, 60, 40, 39, 20, 19, 1, 0, 100, None)])
    print("neighbors:", {z: zone_neighbors(z) for z in FIELD_ZONES})
    for args in [(None, 10, 50), (5, 10, 50), (3, None, 50), (3, 6, 0), (3, 6, None)]:
        try:
            bucket(*args)
            print("FAIL no raise:", args)
        except ValueError as exc:
            print("caught {}: {}".format(args, exc))
    df = pd.DataFrame({"down": pd.array([1, 3, None, 2], dtype="Int8"),
                       "distance": pd.array([10, 6, 10, 2], dtype="Int8"),
                       "ytg": pd.array([75, 45, 50, 8], dtype="Int8")})
    print("bucket_series:", bucket_series(df["down"], df["distance"], df["ytg"]).tolist())
    every = set()
    for d in DOWNS:
        for dist in range(0, 40):
            for y in range(1, 100):
                every.add(bucket(d, dist, y))
    print("exhaustive sweep produced", len(every), "keys, all in BUCKET_KEYS:", every == set(BUCKET_KEYS))
