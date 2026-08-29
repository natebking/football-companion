"""Unified play schema. Every other engine module imports from here.

Binding spec: docs/CONTRACT.md, "Unified play schema". Integer columns use pandas
nullable dtypes (Int8/Int16/Int32) so a missing value never silently becomes 0.
"""
from pathlib import Path
from typing import Any, Dict, List, Tuple

import numpy as np
import pandas as pd

UNIFIED_COLUMNS: List[Tuple[str, str]] = [
    ("league", "str"), ("season", "Int16"), ("week", "Int8"),
    ("game_id", "str"), ("play_id", "str"), ("play_index", "Int32"),
    ("offense", "str"), ("defense", "str"),
    ("period", "Int8"), ("clock_seconds", "Int16"),
    ("down", "Int8"), ("distance", "Int8"), ("yards_to_goal", "Int8"),
    ("play_type_raw", "str"),
    ("is_pass", "bool"), ("is_rush", "bool"),
    ("is_special", "bool"), ("is_penalty_only", "bool"),
    ("yards_gained", "Int8"), ("value", "float32"), ("success", "bool"),
    ("score_diff", "Int8"), ("play_text", "str"),
]

COLUMN_NAMES: List[str] = [c for c, _ in UNIFIED_COLUMNS]
DTYPES: Dict[str, str] = dict(UNIFIED_COLUMNS)
LEAGUES = ("cfb", "nfl")
REQUIRED_NON_NULL = ("league", "season", "game_id", "play_id", "play_index", "offense", "defense", "period")
RANGES: Dict[str, Tuple[int, int]] = {  # inclusive (min, max), enforced on non-null values only
    "season": (1999, 2099), "week": (0, 25), "period": (1, 10), "clock_seconds": (0, 900),
    "down": (1, 4), "distance": (0, 99), "yards_to_goal": (1, 99),
    "yards_gained": (-99, 99), "score_diff": (-99, 99),
}


def empty_frame() -> pd.DataFrame:
    """Zero-row frame with the exact unified columns, order, and dtypes."""
    return pd.DataFrame({name: pd.Series([], dtype=dt) for name, dt in UNIFIED_COLUMNS})


def conform(df: pd.DataFrame) -> pd.DataFrame:
    """Reorder to UNIFIED_COLUMNS and cast to the declared dtypes. Ingesters call this."""
    _check_columns(df)
    return pd.DataFrame({name: df[name].astype(dt) for name, dt in UNIFIED_COLUMNS})


def _floats(x: Any) -> np.ndarray:
    return pd.to_numeric(pd.Series(x if np.ndim(x) else [x]), errors="coerce").astype("float64").to_numpy()


def success_flag(down: Any, distance: Any, yards_gained: Any) -> Any:
    """Standard success: 50% of distance on 1st, 70% on 2nd, 100% on 3rd/4th.

    Scalar in, bool out. Array-like in, ndarray of bool out. A null down (kickoff,
    PAT), null distance, or null yardage is not a success.
    """
    d, dist, gained = _floats(down), _floats(distance), _floats(yards_gained)
    needed = np.where(d == 1, 0.5 * dist, np.where(d == 2, 0.7 * dist, dist))
    known = ~(np.isnan(d) | np.isnan(dist) | np.isnan(gained))
    out = known & (gained >= needed)
    return bool(out[0]) if np.ndim(down) == 0 else out


def _check_columns(df: pd.DataFrame) -> None:
    missing = [c for c in COLUMN_NAMES if c not in df.columns]
    extra = [c for c in df.columns if c not in DTYPES]
    if missing or extra:
        raise ValueError("schema mismatch: missing={} unexpected={}".format(missing, extra))


def validate(df: pd.DataFrame) -> Dict[str, Any]:
    """Raise on any contract violation. Return summary stats on success."""
    _check_columns(df)
    if list(df.columns) != COLUMN_NAMES:
        raise ValueError("column order must match UNIFIED_COLUMNS, got {}".format(list(df.columns)))
    wrong = ["{} is {}, expected {}".format(n, df[n].dtype, dt)
             for n, dt in UNIFIED_COLUMNS if df[n].dtype != dt]
    if wrong:
        raise TypeError("wrong dtypes: " + "; ".join(wrong))
    for col in REQUIRED_NON_NULL:
        null = df.index[df[col].isna()]
        if len(null):
            raise ValueError("{} must be non-null, {} null rows, first at index {}".format(col, len(null), null[0]))
    bad_league = sorted(set(df["league"].dropna().unique()) - set(LEAGUES))
    if bad_league:
        raise ValueError("league must be one of {}, found {}".format(list(LEAGUES), bad_league))
    for col, (lo, hi) in RANGES.items():
        v = pd.to_numeric(df[col], errors="coerce")
        bad = df.index[v.notna() & ((v < lo) | (v > hi))]
        if len(bad):
            raise ValueError("{} out of range [{}, {}], {} rows, first at index {} value {}".format(
                col, lo, hi, len(bad), bad[0], df.loc[bad[0], col]))
    elig = df[~(df["is_special"] | df["is_penalty_only"])]
    return {"rows": int(len(df)), "leagues": sorted(df["league"].dropna().unique().tolist()),
            "seasons": sorted(int(s) for s in df["season"].dropna().unique()),
            "games": int(df["game_id"].nunique()), "eligible_rows": int(len(elig)),
            "teams": int(pd.concat([df["offense"], df["defense"]]).nunique()),
            "null_down": int(df["down"].isna().sum()),
            "pass_rate": round(float(elig["is_pass"].mean()), 4) if len(elig) else None,
            "success_rate": round(float(elig["success"].mean()), 4) if len(elig) else None}


def write_plays(df: pd.DataFrame, path: Any) -> str:
    """Validate, then write parquet. Returns the path written."""
    validate(df)
    out = Path(path)
    out.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(out, index=False)
    return str(out)


def read_plays(path: Any) -> pd.DataFrame:
    """Read parquet, then validate. Raises if the file drifted from the contract."""
    df = pd.read_parquet(path)
    validate(df)
    return df


if __name__ == "__main__":
    rows = [
        ("nfl", 2024, 3, "g1", "p1", 0, "SF", "SEA", 1, 812, 1, 10, 75, "pass", True, False, False, False, 6, 0.41, None, 0, "short right"),
        ("nfl", 2024, 3, "g1", "p2", 1, "SF", "SEA", 1, 780, 2, 4, 69, "run", False, True, False, False, 2, -0.22, None, 0, "up the middle"),
        ("nfl", 2024, 3, "g1", "p3", 2, "SF", "SEA", 1, 744, None, None, 67, "punt", False, False, True, False, 0, None, None, 0, "punts 42 yards"),
        ("cfb", 2024, 3, "g2", "p1", 0, "USC", "UCLA", 2, 300, 3, 8, 45, "pass", True, False, False, False, 12, 1.42, None, -3, "complete deep"),
        ("cfb", 2024, 3, "g2", "p2", 1, "USC", "UCLA", 2, 262, 1, 10, 33, "penalty", False, False, False, True, 0, None, None, -3, "false start, no play"),
    ]
    df = conform(pd.DataFrame(rows, columns=COLUMN_NAMES))
    df["success"] = success_flag(df["down"], df["distance"], df["yards_gained"])
    print("dtypes ok:", all(str(df[n].dtype) == dt for n, dt in UNIFIED_COLUMNS),
          "| empty_frame ok:", list(empty_frame().dtypes.astype(str)) == [dt for _, dt in UNIFIED_COLUMNS])
    print("success:", df["success"].tolist(), "(1st&10 for 6 T, 2nd&4 for 2 F, punt F, 3rd&8 for 12 T, penalty F)")
    print("scalars:", success_flag(2, 10, 7), success_flag(2, 10, 6), success_flag(None, 10, 50))
    out = Path(__file__).resolve().parents[1] / "data" / "_schema_selftest.parquet"
    print("wrote:", write_plays(df, out))
    print("roundtrip stats:", validate(read_plays(out)))
    for name, mutate in [
        ("missing column", lambda d: d.drop(columns=["down"])),
        ("wrong dtype", lambda d: d.assign(down=d["down"].astype("float64"))),
        ("down out of range", lambda d: d.assign(down=d["down"].fillna(7))),
        ("yards_to_goal 0", lambda d: d.assign(yards_to_goal=d["yards_to_goal"].mask(d.index == 1, 0))),
        ("negative distance", lambda d: d.assign(distance=d["distance"].mask(d.index == 0, -1))),
        ("bad league", lambda d: d.assign(league=d["league"].mask(d.index == 0, "xfl"))),
    ]:
        try:
            validate(mutate(df))
            print("FAIL, no raise:", name)
        except (ValueError, TypeError) as exc:
            print("caught {}: {}".format(name, exc))
    out.unlink()
