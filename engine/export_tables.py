"""Freeze the tendency ladder into the two static JSON files the phone loads.

Binding spec: docs/CONTRACT.md, "Shipped tendency JSON".

    {"generated": "...", "seasons": [...],
     "league_baseline": {"d3_medium_mid": {...}},
     "teams": {"USC": {"d3_medium_mid": {"pass_rate": 0.78, "sample_size": 47, "rung": 1}}}}

Teams carry only the buckets that reached rung 1 or 2. Everything else is absent
and the client falls back to `league_baseline`, which is what keeps the file
small. That means the shipped file has three states, not five:

    team entry present  -> rungs 1-2, high confidence, attribute to the team
    team entry absent   -> league_baseline, low confidence, do not attribute
    bucket absent too   -> no read, say nothing

Rungs 3 and 4 are computed by the engine but are not shippable under this rule,
so situations that would have landed there degrade to the league line. `lookup()`
below is the reference read; the site ports it to JS.

Rates round to 3 decimals here. The engine keeps 4, and re-rounding down is
lossless, so this file is the only place the shipped precision is decided.
"""
import json
import sys
from datetime import date
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import buckets  # noqa: E402
import schema  # noqa: E402
import tendency  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
SHIP_RUNGS = (1, 2)
SIZE_BUDGET = 400 * 1024  # bytes, uncompressed, per the contract
DECIMALS = 3

# One representative situation per bucket key, used to drive the real ladder
# instead of reaching into the tables. Every probe round-trips to its own key,
# asserted in the self-check below.
BAND_PROBE: Dict[str, int] = {"short": 2, "medium": 6, "long": 10}
ZONE_PROBE: Dict[str, int] = {"own_deep": 90, "own": 70, "mid": 50, "opp": 30, "red": 10}


def probe(key: str) -> Tuple[int, int, int]:
    """A (down, distance, yards_to_goal) that buckets back to `key`."""
    down, band, zone = key.split("_", 2)
    return int(down[1:]), BAND_PROBE[band], ZONE_PROBE[zone]


def _r(x: Optional[float]) -> Optional[float]:
    return None if x is None else round(float(x), DECIMALS)


def _compact(value: Any) -> str:
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False)


def dump(payload: Dict[str, Any]) -> bytes:
    """Exactly the bytes that hit disk.

    Compact inside every entry, one line per top-level member and per team and
    per baseline bucket. The newlines cost about 300 bytes on the larger file and
    buy a data file a human can `head` and git can diff by team.
    """
    lines = ['{"generated":' + _compact(payload["generated"]) + ",",
             '"league":' + _compact(payload["league"]) + ",",
             '"seasons":' + _compact(payload["seasons"]) + ","]
    for field in ("league_baseline", "teams"):
        lines.append(_compact(field) + ":{")
        items = list(payload[field].items())
        for i, (key, value) in enumerate(items):
            lines.append(_compact(key) + ":" + _compact(value) + ("," if i < len(items) - 1 else ""))
        lines.append("}," if field == "league_baseline" else "}}")
    return "\n".join(lines).encode("utf-8")


def export(tables: Dict[str, Any], generated: Optional[str] = None,
           budget: int = SIZE_BUDGET) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """Ladder tables in, shipped payload plus a build report out."""
    baseline: Dict[str, Any] = {}
    usage: Dict[str, int] = {}
    for key in buckets.BUCKET_KEYS:
        stats = tables["league_exact"].get(key)
        n = int(stats["sample_size"]) if stats else 0
        usage[key] = n
        if not stats or stats["pass_rate"] is None:
            continue
        baseline[key] = {"pass_rate": _r(stats["pass_rate"]),
                         "success_rate": _r(stats["success_rate"]),
                         "explosive_rate": _r(stats["explosive_rate"]),
                         "sample_size": n}

    teams: Dict[str, Any] = {}
    for team in tables["teams"]:
        row: Dict[str, Any] = {}
        for key in buckets.BUCKET_KEYS:
            block = tendency.query(tables, team, *probe(key))
            if block["rung"] in SHIP_RUNGS and block["pass_rate"] is not None:
                row[key] = {"pass_rate": _r(block["pass_rate"]),
                            "sample_size": int(block["sample_size"]),
                            "rung": int(block["rung"])}
        if row:
            teams[team] = row

    payload = {"generated": generated or date.today().isoformat(),
               "league": tables["league"],
               "seasons": [int(s) for s in tables["seasons"]],
               "league_baseline": baseline,
               "teams": teams}

    full = len(dump(payload))
    dropped = _fit(payload, usage, budget)
    return payload, {
        "bytes": len(dump(payload)),
        "bytes_before_trim": full,
        "budget": budget,
        "teams": len(payload["teams"]),
        "team_entries": sum(len(v) for v in payload["teams"].values()),
        "baseline_buckets": len(baseline),
        "empty_buckets": [k for k in buckets.BUCKET_KEYS if usage[k] == 0],
        "thin_baseline": {k: usage[k] for k in baseline if usage[k] < tendency.MIN_SAMPLE},
        "dropped": dropped,
    }


def _fit(payload: Dict[str, Any], usage: Dict[str, int], budget: int) -> List[Dict[str, Any]]:
    """Drop team entries, least-used bucket first, until the payload fits.

    Only the `teams` side is trimmed. `league_baseline` is 60 rows and stays
    whole, so every dropped bucket still has a client-side fallback.
    """
    dropped: List[Dict[str, Any]] = []
    order = sorted(buckets.BUCKET_KEYS, key=lambda k: (usage.get(k, 0), k))
    for key in order:
        if len(dump(payload)) <= budget:
            break
        hits = [t for t, row in payload["teams"].items() if key in row]
        if not hits:
            continue
        snaps = 0
        for team in hits:
            snaps += payload["teams"][team].pop(key)["sample_size"]
        payload["teams"] = {t: row for t, row in payload["teams"].items() if row}
        dropped.append({"bucket": key, "teams": len(hits), "team_snaps": snaps,
                        "league_snaps": usage.get(key, 0)})
    return dropped


def lookup(payload: Dict[str, Any], team: Optional[str], down: Any, distance: Any,
           yards_to_goal: Any) -> Dict[str, Any]:
    """Reference client read of a shipped file. The site ports this to JS.

    Returns a TendencyBlock. `rung` is 1 or 2 when the team entry survived the
    trim, 5 otherwise, and rung 5 never carries a team name.
    """
    key = buckets.bucket(down, distance, yards_to_goal)
    base = payload["league_baseline"].get(key)
    league_pass_rate = base["pass_rate"] if base else None
    entry = payload["teams"].get(team, {}).get(key) if team is not None else None
    if entry is not None:
        return {"bucket": key, "team": team, "rung": entry["rung"], "confidence": "high",
                "sample_size": entry["sample_size"], "pass_rate": entry["pass_rate"],
                "league_pass_rate": league_pass_rate, "success_rate": None,
                "explosive_rate": None}
    return {"bucket": key, "team": None, "rung": 5, "confidence": "low",
            "sample_size": base["sample_size"] if base else 0,
            "pass_rate": league_pass_rate, "league_pass_rate": league_pass_rate,
            "success_rate": base["success_rate"] if base else None,
            "explosive_rate": base["explosive_rate"] if base else None}


def write(payload: Dict[str, Any], path: Path) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = dump(payload)
    path.write_bytes(raw)
    return len(raw)


# --------------------------------------------------------------------------- #


def _kb(n: int) -> str:
    return "{:,} bytes ({:.1f} KB)".format(n, n / 1024.0)


def _run(name: str, seasons: Optional[List[int]], out: Path, generated: str) -> None:
    df = schema.read_plays(ROOT / "data" / name)
    tables = tendency.build(df, seasons=seasons)
    payload, rep = export(tables, generated=generated)
    size = write(payload, out)
    league = payload["league"]

    print("=" * 96)
    print("{}  <- {}  ({} eligible plays, {} teams in tables)".format(
        out.name, name, tables["plays"], len(tables["teams"])))
    print("  seasons {}   generated {}".format(payload["seasons"], payload["generated"]))
    print("  size on disk: {}   budget {}   under budget: {}".format(
        _kb(size), _kb(rep["budget"]), size <= rep["budget"]))
    print("  before trim: {}".format(_kb(rep["bytes_before_trim"])))
    print("  teams shipped: {}   team bucket entries: {}   baseline buckets: {}/60".format(
        rep["teams"], rep["team_entries"], rep["baseline_buckets"]))
    print("  baseline omitted (zero plays anywhere): {} {}".format(
        len(rep["empty_buckets"]), rep["empty_buckets"]))
    print("  baseline shipped below the {}-play floor: {}".format(
        tendency.MIN_SAMPLE, rep["thin_baseline"]))
    if rep["dropped"]:
        print("  DROPPED to fit, least-used first:")
        for d in rep["dropped"]:
            print("    {:<20} {:>4} teams  {:>7} team snaps  league n={}".format(
                d["bucket"], d["teams"], d["team_snaps"], d["league_snaps"]))
    else:
        print("  dropped: none, fits as built")
    _checks(df, tables, payload, out)


def _checks(df: pd.DataFrame, tables: Dict[str, Any], payload: Dict[str, Any], out: Path) -> None:
    print("-" * 96)
    print("CHECKS / {}".format(payload["league"]))

    # 1. Every probe situation buckets back to the key it stands for.
    bad = [k for k in buckets.BUCKET_KEYS if buckets.bucket(*probe(k)) != k]
    print("  probes that do not round-trip to their own bucket: {} (must be 0)".format(len(bad)))

    # 2. The file parses, and parses to what we held in memory.
    reread = json.loads(out.read_bytes().decode("utf-8"))
    print("  re-read from disk equals in-memory payload: {}".format(reread == payload))
    print("  top-level keys: {}".format(sorted(reread.keys())))

    # 3. No shipped team entry may claim a rung outside 1-2, or a null rate.
    rungs: Dict[int, int] = {}
    nulls = 0
    for row in payload["teams"].values():
        for e in row.values():
            rungs[e["rung"]] = rungs.get(e["rung"], 0) + 1
            nulls += int(e["pass_rate"] is None or e["sample_size"] < tendency.MIN_SAMPLE)
    print("  shipped rung histogram: {} (must be rungs 1 and 2 only)".format(rungs))
    print("  shipped entries null-rate or below the floor: {} (must be 0)".format(nulls))

    # 4. Walk every real (team, situation) snap in the parquet. Compare the client
    #    read of the shipped file against the engine's own query.
    counts = (tendency.eligible(df)
              .assign(key=lambda f: buckets.bucket_series(f["down"], f["distance"], f["yards_to_goal"]))
              .groupby(["offense", "key"]).size())
    served = fell_back = no_read = mismatch = attributed = 0
    lost: Dict[int, int] = {}
    for (team, key), n in counts.items():
        n = int(n)
        want = tendency.query(tables, team, *probe(key))
        got = lookup(payload, team, *probe(key))
        if got["rung"] in SHIP_RUNGS:
            served += n
            if (got["rung"] != want["rung"] or got["team"] != want["team"]
                    or got["sample_size"] != want["sample_size"]
                    or got["pass_rate"] != _r(want["pass_rate"])):
                mismatch += n
        elif got["pass_rate"] is None:
            no_read += n
        else:
            fell_back += n
            lost[want["rung"]] = lost.get(want["rung"], 0) + n
        attributed += int(got["rung"] == 5 and got["team"] is not None)
    total = served + fell_back + no_read
    print("  snaps served by a team entry:  {:>6} ({:.1%})".format(served, served / total))
    print("  snaps falling back to league:  {:>6} ({:.1%})  engine rungs behind them: {}".format(
        fell_back, fell_back / total, {r: "{} ({:.1%})".format(v, v / total) for r, v in sorted(lost.items())}))
    print("  snaps with no read at all:     {:>6} ({:.1%})".format(no_read, no_read / total))
    print("  team-served reads disagreeing with engine query: {} (must be 0)".format(mismatch))
    print("  rung-5 reads carrying a team name: {} (must be 0)".format(attributed))

    # 5. Named spot checks, straight out of the shipped dict.
    for team, key in _SPOTS.get(payload["league"], []):
        entry = payload["teams"].get(team, {}).get(key)
        engine = tendency.query(tables, team, *probe(key))
        print("  {:<12} {:<18} shipped={}  engine pass_rate={} rung={}".format(
            team, key, entry, engine["pass_rate"], engine["rung"]))


_SPOTS = {
    "cfb": [("Alabama", "d3_medium_mid"), ("Air Force", "d3_medium_mid"),
            ("Air Force", "d2_short_red"), ("Ohio State", "d3_long_own"),
            ("Alabama", "d4_short_opp"), ("Alabama", "d1_medium_red")],
    "nfl": [("KC", "d3_medium_mid"), ("PHI", "d1_long_own"), ("BAL", "d3_long_own"),
            ("BAL", "d2_short_red"), ("KC", "d1_medium_red"), ("KC", "d4_short_opp")],
}


if __name__ == "__main__":
    today = date.today().isoformat()
    web = ROOT / "web"
    for parquet, seasons, name in (("plays_cfb.parquet", [2023, 2024, 2025], "tendency-cfb.json"),
                                   ("plays_nfl.parquet", None, "tendency-nfl.json")):
        if (ROOT / "data" / parquet).exists():
            _run(parquet, seasons, web / name, today)
        else:
            print("skip {}, not on disk".format(parquet))
