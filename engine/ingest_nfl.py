"""nflverse play-by-play -> unified play schema.

    python engine/ingest_nfl.py --seasons 2023-2025 # current published history
    python engine/ingest_nfl.py --seasons 2022-2024
    python engine/ingest_nfl.py --seasons 2023,2024 --out data/plays_nfl.parquet

Reads data/raw/nfl_pbp_{season}.parquet, downloading from the nflverse-data release
if absent. Writes one parquet for all requested seasons.

Classification decisions (see module docstring of docs/CONTRACT.md for the flags):

* Administrative rows are dropped, not ingested. nflverse emits GAME/END QUARTER/
  END GAME/COMMENT markers (null play_type) and one row per timeout
  (play_type == "no_play" and play_type_nfl == "TIMEOUT"). Neither is a play.
  Dropping them is also what makes offense/defense non-null for every kept row.
* is_pass / is_rush come from play_type, not from nflverse's `pass` / `rush`
  columns. Those columns count a QB scramble as a pass (designed dropback).
  play_type calls it a run. See the sanity numbers in the CLI output.
* qb_kneel and qb_spike get no flag at all: not a pass, not a rush, not special,
  not a penalty. Aggregation should exclude them with
  ``~df["play_type_raw"].isin(["qb_kneel", "qb_spike"])``.
* Two-point conversions are is_special (they are PATs), even though nflverse gives
  them play_type "pass"/"run" and leaves its own `special` column at 0.
* distance is nulled where down is null. In the source those rows carry ydstogo 0,
  which is a sentinel, not a real yards-to-go.
* success is recomputed with schema.success_flag. nflverse's `success` column is
  EPA-based and disagrees with the contract's yardage rule on ~12% of plays.
"""
import argparse
import sys
from pathlib import Path
from typing import List, Optional

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import schema  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = ROOT / "data" / "raw"
DEFAULT_OUT = ROOT / "data" / "plays_nfl.parquet"
RELEASE_URL = "https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_{}.parquet"

SOURCE_COLUMNS = [
    "season", "week", "game_id", "play_id", "order_sequence",
    "posteam", "defteam", "qtr", "quarter_seconds_remaining",
    "down", "ydstogo", "yardline_100",
    "play_type", "play_type_nfl", "two_point_attempt",
    "yards_gained", "epa", "desc", "score_differential",
]

SPECIAL_TYPES = ("kickoff", "punt", "field_goal", "extra_point")


def raw_path(season: int) -> Path:
    return RAW_DIR / "nfl_pbp_{}.parquet".format(season)


def ensure_raw(season: int) -> Path:
    """Return the local raw parquet for a season, downloading it if absent."""
    path = raw_path(season)
    if path.exists():
        return path
    import requests

    url = RELEASE_URL.format(season)
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    print("downloading {} -> {}".format(url, path))
    resp = requests.get(url, stream=True, timeout=120)
    resp.raise_for_status()
    tmp = path.with_suffix(".partial")
    with open(tmp, "wb") as fh:
        for chunk in resp.iter_content(chunk_size=1 << 20):
            fh.write(chunk)
    tmp.rename(path)
    print("  {:.1f} MB".format(path.stat().st_size / 1e6))
    return path


def _int(series: pd.Series, dtype: str) -> pd.Series:
    """Float-or-object series -> pandas nullable int, NaN preserved as pd.NA."""
    return pd.array(pd.to_numeric(series, errors="coerce").round(), dtype=dtype)


def _ids(series: pd.Series) -> pd.Series:
    """nflverse ids arrive as float64. Render them as plain integer strings."""
    num = pd.to_numeric(series, errors="coerce")
    return num.map(lambda v: "" if pd.isna(v) else str(int(v)))


def transform(raw: pd.DataFrame) -> pd.DataFrame:
    """One season of nflverse play-by-play -> conformed unified frame."""
    play_type = raw["play_type"]
    is_admin = play_type.isna() | (
        play_type.eq("no_play") & raw["play_type_nfl"].eq("TIMEOUT")
    )
    d = raw.loc[~is_admin].copy()

    penalty_only = d["play_type"].eq("no_play").to_numpy()
    two_point = d["two_point_attempt"].fillna(0).eq(1).to_numpy()
    special = ~penalty_only & (d["play_type"].isin(SPECIAL_TYPES).to_numpy() | two_point)
    live = ~penalty_only & ~special
    is_pass = live & d["play_type"].eq("pass").to_numpy()
    is_rush = live & d["play_type"].eq("run").to_numpy()

    down = _int(d["down"], "Int8")
    # ydstogo is 0 on every down-less row (kickoff, PAT, two-point). That 0 is a
    # sentinel, so it must not survive as a real distance.
    distance = _int(d["ydstogo"].where(d["down"].notna()), "Int8")
    yards_gained = _int(d["yards_gained"], "Int8")

    out = pd.DataFrame({
        "league": "nfl",
        "season": _int(d["season"], "Int16"),
        "week": _int(d["week"], "Int8"),
        "game_id": d["game_id"].astype("str"),
        "play_id": _ids(d["play_id"]),
        "play_index": _int(
            d.groupby("game_id")["order_sequence"].rank(method="first") - 1, "Int32"),
        "offense": d["posteam"].astype("str"),
        "defense": d["defteam"].astype("str"),
        "period": _int(d["qtr"], "Int8"),
        "clock_seconds": _int(d["quarter_seconds_remaining"], "Int16"),
        "down": down,
        "distance": distance,
        "yards_to_goal": _int(d["yardline_100"], "Int8"),
        "play_type_raw": d["play_type"].astype("str"),
        "is_pass": is_pass,
        "is_rush": is_rush,
        "is_special": special,
        "is_penalty_only": penalty_only,
        "yards_gained": yards_gained,
        "value": pd.to_numeric(d["epa"], errors="coerce").astype("float32"),
        "success": schema.success_flag(down, distance, yards_gained),
        "score_diff": _int(d["score_differential"], "Int8"),
        "play_text": d["desc"].astype("str"),
    })
    return schema.conform(out.reset_index(drop=True))


def ingest(seasons: List[int]) -> pd.DataFrame:
    frames = []
    for season in seasons:
        raw = pd.read_parquet(ensure_raw(season), columns=SOURCE_COLUMNS)
        conformed = transform(raw)
        print("{}: {} source rows -> {} plays".format(season, len(raw), len(conformed)))
        frames.append(conformed)
    return schema.conform(pd.concat(frames, ignore_index=True))


def parse_seasons(text: Optional[str]) -> List[int]:
    """'2024', '2022-2024', '2021,2023' -> sorted list of ints."""
    if not text:
        return [2024]
    out = set()
    for part in text.split(","):
        part = part.strip()
        if "-" in part:
            lo, hi = (int(x) for x in part.split("-", 1))
            out.update(range(lo, hi + 1))
        elif part:
            out.add(int(part))
    return sorted(out)


def _report(df: pd.DataFrame) -> None:
    flags = ["is_pass", "is_rush", "is_special", "is_penalty_only"]
    counts = {f: int(df[f].sum()) for f in flags}
    unflagged = df.loc[~df[flags].any(axis=1)]
    print("\nrows {}".format(len(df)))
    for f in flags:
        print("  {:<16} {:>6}  {:.4f}".format(f, counts[f], counts[f] / len(df)))
    print("  {:<16} {:>6}  {:.4f}  {}".format(
        "unflagged", len(unflagged), len(unflagged) / len(df),
        unflagged["play_type_raw"].value_counts().to_dict()))
    print("  flag overlap (should be 0): {}".format(int((df[flags].sum(axis=1) > 1).sum())))

    print("\nvalidate(): {}".format(schema.validate(df)))

    elig = df[~(df["is_special"] | df["is_penalty_only"])]
    clean = elig[~elig["play_type_raw"].isin(["qb_kneel", "qb_spike"])]
    print("\nsanity: leaguewide pass rate")
    for label, frame in (("eligible (contract filter)", elig), ("kneels+spikes removed", clean)):
        third_long = frame[(frame["down"] == 3) & (frame["distance"] >= 8)]
        first_ten = frame[(frame["down"] == 1) & (frame["distance"] == 10)]
        print("  {:<26} 3rd&long n={:<6} {:.4f} | 1st&10 n={:<6} {:.4f} | all downs {:.4f}".format(
            label, len(third_long), third_long["is_pass"].mean(),
            len(first_ten), first_ten["is_pass"].mean(), frame["is_pass"].mean()))
    by_down = clean.groupby(clean["down"].astype("float"))["is_pass"].agg(["size", "mean"])
    print("\npass rate by down (kneels+spikes removed):")
    for down, row in by_down.iterrows():
        print("  down {:.0f}  n={:<6} pass={:.4f}".format(down, int(row["size"]), row["mean"]))


def main() -> int:
    ap = argparse.ArgumentParser(description="nflverse play-by-play -> unified schema")
    ap.add_argument("--seasons", help="e.g. 2024, 2022-2024, 2021,2023. Default 2024.")
    ap.add_argument("--out", default=str(DEFAULT_OUT))
    args = ap.parse_args()

    seasons = parse_seasons(args.seasons)
    print("seasons: {}".format(seasons))
    df = ingest(seasons)
    _report(df)
    path = schema.write_plays(df, args.out)
    print("\nwrote {} ({:.1f} MB)".format(path, Path(path).stat().st_size / 1e6))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
