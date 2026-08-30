"""Freeze the tendency ladder into the two static JSON files the phone loads.

Binding spec: docs/CONTRACT.md, "Shipped tendency JSON".

    {"generated": "...", "league": "cfb", "seasons": [...],
     "rules": {"shrink_k": 60.0, "min_sample": 30,
               "confidence_cuts": {"high": 0.5, "medium": 0.35},
               "attribute_min_diff": 0.03},
     "league_overall": {"pass_rate": 0.45, ...},
     "league_baseline": {"d3_medium_mid": {"pass_rate": 0.71, ...}},
     "teams": {"USC": {"d3_medium_mid": {"pass_rate": 0.78, "pass_rate_raw": 0.83,
                                         "sample_size": 47, "shrink_weight": 0.439,
                                         "rung": 1, "can_attribute": true}}}}

What changed when shrinkage landed
----------------------------------
Three things, and the third is the one the copy hangs on.

1. `pass_rate` is now the shrunk number, `pass_rate_raw` the team's own unshrunk
   one, and `shrink_weight` says how much of the printed number is the team's.
   Confidence is a function of `shrink_weight` alone, so the client needs it.
   `shrink_weight` is exactly `n / (n + shrink_k)` and could be recomputed from
   `sample_size`, but it is shipped anyway so the file is readable without
   knowing the formula. It is the cheapest 10 KB gzipped to reclaim if the file
   ever needs to shrink.

2. Rung 4 is gone from the engine, so it can no longer appear here. The ordinal
   stays retired: 4 is never reused, and rung 5 still means "league, no team".

3. Team cells now carry `can_attribute`, precomputed. Copy may name the team only
   when BOTH of these hold:

       confidence is not "low"                    (shrink_weight >= 0.35)
       |pass_rate - league bucket rate| >= 0.03   (the team differs from everyone)

   Either one alone is a trap. 92% of CFB snaps clear the confidence gate, but
   only 56% of those produce a number more than 3 points off the league's, so
   gating on confidence alone would print "USC throws here 78%" over a number
   that is just what offenses do. Measured by reading the shipped files over
   every eligible play in the parquet: 52.4% of CFB snaps and 46.5% of NFL snaps
   can honestly name the team. Call it half.

   The boolean is computed here, once, from the rounded numbers that actually
   ship, so a reader can reproduce it from the file alone and the client can
   never get the rule wrong. It compares in whole thousandths rather than floats,
   because `abs(0.68 - 0.65) >= 0.03` is False in binary floating point.

Which rungs ship
----------------
Rungs 1, 2 and 3. Rung 3 was excluded when the shipped confidence flag was a
function of the rung, which made a rung-3 cell "low" by construction and
therefore unprintable. Confidence now comes from `shrink_weight`, so a rung-3
cell on 200 plays is exactly as trustworthy as a rung-1 cell on 200 plays and is
gated by the same two conditions as every other cell. Shipping it costs 1,405
CFB cells and buys the file an exact match to the engine on every snap: the
client read and `tendency.query` now agree on all 360,592 CFB and 34,902 NFL
eligible plays, rather than agreeing except on the 1.9% and 4.2% that land on
rung 3. Rung 4 is not shippable because it no longer exists.

So the shipped file has three states:

    team cell, can_attribute true   -> "USC throws here 78%"
    team cell, can_attribute false  -> "offenses throw here 71%", from the baseline
    no team cell                    -> "offenses throw here 71%", from the baseline
    no baseline row either          -> say nothing about the tendency

`lookup()` below is the reference read; the site ports it to JS.

Size
----
The gate is the gzipped size, because that is what crosses the wire and what the
phone waits on. 100 KB, and the CFB file sits at 72.3 KB with every field
present. Uncompressed it is 898.6 KB, which is a parse cost of a few
milliseconds and no transfer cost at all. Rates round to 3 decimals here; the
engine keeps 4, and this file is the only place the shipped precision is
decided.
"""
import gzip
import io
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

# Rungs a team cell may claim. Rung 4 is retired and rung 5 is the league line,
# which is `league_baseline`, not a team cell.
SHIP_RUNGS = (1, 2, 3)

# The binding size gate, on the gzipped bytes. See "Size" above.
GZIP_BUDGET = 100 * 1024

# Copy may name the team only when the shrunk rate is at least this far from the
# league's rate for the same bucket. Below it the team is saying what everyone
# says, and naming them would credit the league's number to them.
ATTRIBUTE_MIN_DIFF = 0.03

# Rates ship at 3 decimals: the engine keeps 4 and a card prints two. The weight
# ships at the engine's 4, because it decides the confidence flag and a 3-decimal
# copy of it would disagree with the engine on any weight sitting within half a
# thousandth of a cut. One extra character per cell buys exact agreement.
DECIMALS = 3
WEIGHT_DECIMALS = 4

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


def _w(sample_size: Any, shrink_k: float) -> float:
    """The shipped `shrink_weight`, rounded exactly as the engine rounds it."""
    return round(tendency.shrink_weight(sample_size, shrink_k), WEIGHT_DECIMALS)


def _mil(x: float) -> int:
    """A shipped rate as whole thousandths, so comparisons are exact integers."""
    return int(round(float(x) * 1000))


def can_attribute(pass_rate: Optional[float], league_pass_rate: Optional[float],
                  shrink_weight: Optional[float]) -> bool:
    """May copy name the team over this number? Both conditions, never one.

    Takes the rounded rates that ship, so the answer is reproducible from the
    file itself. See the module docstring.
    """
    if pass_rate is None or league_pass_rate is None:
        return False
    if tendency.confidence(shrink_weight) == tendency.LOW_CONFIDENCE:
        return False
    return abs(_mil(pass_rate) - _mil(league_pass_rate)) >= _mil(ATTRIBUTE_MIN_DIFF)


def _compact(value: Any) -> str:
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False)


def dump(payload: Dict[str, Any]) -> bytes:
    """Exactly the bytes that hit disk.

    Compact inside every entry, one line per top-level member and per team and
    per baseline bucket. The newlines cost about 800 bytes on the larger file and
    buy a data file a human can `head` and git can diff by team.
    """
    lines = ['{"generated":' + _compact(payload["generated"]) + ",",
             '"league":' + _compact(payload["league"]) + ",",
             '"seasons":' + _compact(payload["seasons"]) + ",",
             '"rules":' + _compact(payload["rules"]) + ",",
             '"league_overall":' + _compact(payload["league_overall"]) + ","]
    for field in ("league_baseline", "teams"):
        lines.append(_compact(field) + ":{")
        items = list(payload[field].items())
        for i, (key, value) in enumerate(items):
            lines.append(_compact(key) + ":" + _compact(value) + ("," if i < len(items) - 1 else ""))
        lines.append("}," if field == "league_baseline" else "}}")
    return "\n".join(lines).encode("utf-8")


def gzipped(raw: bytes) -> int:
    """Bytes over the wire. mtime pinned to 0 so the number is stable across runs."""
    buf = io.BytesIO()
    with gzip.GzipFile(fileobj=buf, mode="wb", compresslevel=9, mtime=0) as fh:
        fh.write(raw)
    return len(buf.getvalue())


def export(tables: Dict[str, Any], generated: Optional[str] = None,
           budget: int = GZIP_BUDGET) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """Ladder tables in, shipped payload plus a build report out."""
    overall = tables["league_overall"]
    league_overall = {"pass_rate": _r(overall["pass_rate"]),
                      "success_rate": _r(overall["success_rate"]),
                      "explosive_rate": _r(overall["explosive_rate"]),
                      "sample_size": int(overall["sample_size"])}

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
            if block["rung"] not in SHIP_RUNGS or block["pass_rate"] is None:
                continue
            rate = _r(block["pass_rate"])
            league_rate = _league_rate(baseline, league_overall, key)
            weight = _w(block["sample_size"], tables["shrink_k"])
            row[key] = {"pass_rate": rate,
                        "pass_rate_raw": _r(block["pass_rate_raw"]),
                        "sample_size": int(block["sample_size"]),
                        "shrink_weight": weight,
                        "rung": int(block["rung"]),
                        "can_attribute": can_attribute(rate, league_rate, weight)}
        if row:
            teams[team] = row

    payload = {"generated": generated or date.today().isoformat(),
               "league": tables["league"],
               "seasons": [int(s) for s in tables["seasons"]],
               "rules": {"shrink_k": float(tables["shrink_k"]),
                         "min_sample": int(tables["min_sample"]),
                         "confidence_cuts": {label: cut for cut, label in tendency.CONFIDENCE_CUTS},
                         "attribute_min_diff": ATTRIBUTE_MIN_DIFF},
               "league_overall": league_overall,
               "league_baseline": baseline,
               "teams": teams}

    full_raw = dump(payload)
    dropped = _fit(payload, usage, budget)
    raw = dump(payload)
    return payload, {
        "bytes": len(raw),
        "gzip": gzipped(raw),
        "bytes_before_trim": len(full_raw),
        "gzip_before_trim": gzipped(full_raw),
        "budget": budget,
        "teams": len(payload["teams"]),
        "team_entries": sum(len(v) for v in payload["teams"].values()),
        "attributable_entries": sum(1 for row in payload["teams"].values()
                                    for e in row.values() if e["can_attribute"]),
        "baseline_buckets": len(baseline),
        "empty_buckets": [k for k in buckets.BUCKET_KEYS if usage[k] == 0],
        "thin_baseline": {k: usage[k] for k in baseline if usage[k] < tendency.MIN_SAMPLE},
        "dropped": dropped,
    }


def _league_rate(baseline: Dict[str, Any], overall: Dict[str, Any], key: str) -> Optional[float]:
    """The league line for a bucket: its own rate, or the league's overall rate.

    The fallback matters for the four NFL buckets the league itself never filled
    (1st and short from deep in your own end). A team can still reach rung 2 or 3
    there through a widened filter, and the engine shrinks it toward the overall
    rate, so the client has to shrink toward the same thing or the two disagree.
    """
    row = baseline.get(key)
    return row["pass_rate"] if row else overall["pass_rate"]


def _fit(payload: Dict[str, Any], usage: Dict[str, int], budget: int) -> List[Dict[str, Any]]:
    """Shrink the payload until it fits, cheapest loss first. Gzipped bytes.

    Two stages, in this order:

    1. Drop every cell whose `can_attribute` is false. No copy path reads one:
       the card prints the league line over those situations either way, so the
       cell is a diagnostic and nothing more. `can_attribute` stays in the
       surviving cells, constant true, so the client rule does not change.
    2. Drop team cells bucket by bucket, least-used bucket first, as before.

    `league_baseline` is 60 rows and is never trimmed, so every dropped cell
    still has a client-side fallback.
    """
    dropped: List[Dict[str, Any]] = []
    if gzipped(dump(payload)) <= budget:
        return dropped

    cells = snaps = 0
    for team, row in payload["teams"].items():
        for key in [k for k, e in row.items() if not e["can_attribute"]]:
            snaps += row.pop(key)["sample_size"]
            cells += 1
    payload["teams"] = {t: row for t, row in payload["teams"].items() if row}
    dropped.append({"bucket": "(all non-attributable cells)", "teams": 0,
                    "cells": cells, "team_snaps": snaps, "league_snaps": 0})

    order = sorted(buckets.BUCKET_KEYS, key=lambda k: (usage.get(k, 0), k))
    for key in order:
        if gzipped(dump(payload)) <= budget:
            break
        hits = [t for t, row in payload["teams"].items() if key in row]
        if not hits:
            continue
        snaps = 0
        for team in hits:
            snaps += payload["teams"][team].pop(key)["sample_size"]
        payload["teams"] = {t: row for t, row in payload["teams"].items() if row}
        dropped.append({"bucket": key, "teams": len(hits), "cells": len(hits),
                        "team_snaps": snaps, "league_snaps": usage.get(key, 0)})
    return dropped


def lookup(payload: Dict[str, Any], team: Optional[str], down: Any, distance: Any,
           yards_to_goal: Any) -> Dict[str, Any]:
    """Reference client read of a shipped file. The site ports this to JS.

    Returns a TendencyBlock. `rung` is 1, 2 or 3 when a team cell answered and 5
    otherwise; rung 5 never carries a team name and never attributes. `confidence`
    is computed from `shrink_weight`, never from the rung.
    """
    key = buckets.bucket(down, distance, yards_to_goal)
    base = payload["league_baseline"].get(key)
    overall = payload["league_overall"]
    league_pass_rate = _league_rate(payload["league_baseline"], overall, key)
    entry = payload["teams"].get(team, {}).get(key) if team is not None else None
    if entry is not None:
        return {"bucket": key, "team": team, "rung": entry["rung"],
                "confidence": tendency.confidence(entry["shrink_weight"]),
                "sample_size": entry["sample_size"],
                "shrink_weight": entry["shrink_weight"],
                "pass_rate": entry["pass_rate"],
                "pass_rate_raw": entry["pass_rate_raw"],
                "league_pass_rate": league_pass_rate,
                "can_attribute": entry["can_attribute"],
                "success_rate": None, "explosive_rate": None}
    return {"bucket": key, "team": None, "rung": 5, "confidence": tendency.LOW_CONFIDENCE,
            "sample_size": base["sample_size"] if base else 0,
            "shrink_weight": 0.0,
            "pass_rate": base["pass_rate"] if base else None,
            "pass_rate_raw": None,
            "league_pass_rate": league_pass_rate,
            "can_attribute": False,
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

    print("=" * 96)
    print("{}  <- {}  ({} eligible plays, {} teams in tables)".format(
        out.name, name, tables["plays"], len(tables["teams"])))
    print("  seasons {}   generated {}   rules {}".format(
        payload["seasons"], payload["generated"], payload["rules"]))
    print("  size on disk:  raw {}   gzip {}".format(_kb(size), _kb(rep["gzip"])))
    print("  gzip budget {}   under budget: {}".format(_kb(rep["budget"]), rep["gzip"] <= rep["budget"]))
    print("  before trim:   raw {}   gzip {}".format(
        _kb(rep["bytes_before_trim"]), _kb(rep["gzip_before_trim"])))
    print("  teams shipped: {}   team cells: {}   of those attributable: {} ({:.1%})".format(
        rep["teams"], rep["team_entries"], rep["attributable_entries"],
        rep["attributable_entries"] / rep["team_entries"]))
    print("  baseline buckets: {}/60   omitted (zero plays anywhere): {} {}".format(
        rep["baseline_buckets"], len(rep["empty_buckets"]), rep["empty_buckets"]))
    print("  baseline shipped below the {}-play floor: {}".format(
        tendency.MIN_SAMPLE, rep["thin_baseline"]))
    if rep["dropped"]:
        print("  DROPPED to fit:")
        for d in rep["dropped"]:
            print("    {:<32} {:>5} cells  {:>7} team snaps  league n={}".format(
                d["bucket"], d["cells"], d["team_snaps"], d["league_snaps"]))
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

    # 3. No shipped cell may claim a retired or league rung, a null rate, a sample
    #    below the floor, or a `can_attribute` that its own numbers do not support.
    rungs: Dict[int, int] = {}
    conf: Dict[str, int] = {}
    nulls = att_breaks = identity_breaks = weight_breaks = 0
    k = tables["shrink_k"]
    for team, row in payload["teams"].items():
        for key, e in row.items():
            rungs[e["rung"]] = rungs.get(e["rung"], 0) + 1
            conf_flag = tendency.confidence(e["shrink_weight"])
            conf[conf_flag] = conf.get(conf_flag, 0) + 1
            nulls += int(e["pass_rate"] is None or e["sample_size"] < tendency.MIN_SAMPLE)
            league_rate = _league_rate(payload["league_baseline"], payload["league_overall"], key)
            att_breaks += int(e["can_attribute"] != can_attribute(
                e["pass_rate"], league_rate, e["shrink_weight"]))
            weight_breaks += int(e["shrink_weight"] != _w(e["sample_size"], k))
            w = e["shrink_weight"]
            want = w * e["pass_rate_raw"] + (1 - w) * league_rate
            identity_breaks += int(abs(want - e["pass_rate"]) > 0.0015)
    print("  shipped rung histogram: {} (must be rungs {} only, never 4 or 5)".format(
        dict(sorted(rungs.items())), list(SHIP_RUNGS)))
    print("  shipped confidence histogram, from shrink_weight: {}".format(dict(sorted(conf.items()))))
    print("  cells null-rate or below the {}-play floor: {} (must be 0)".format(
        tendency.MIN_SAMPLE, nulls))
    print("  cells whose can_attribute the file's own numbers do not reproduce: {} (must be 0)".format(
        att_breaks))
    print("  cells where shrink_weight != n/(n+{}): {} (must be 0)".format(k, weight_breaks))
    print("  cells where pass_rate != w*raw + (1-w)*league to 3dp: {} (must be 0)".format(
        identity_breaks))

    # 4. What shipping at 3 decimals cost the attribution gate. `can_attribute`
    #    rounds to thousandths internally, so measure against the gate applied at
    #    the engine's full 4-decimal precision instead. Both the team rate and
    #    the league rate round independently, each by at most half a thousandth,
    #    so the shipped gap can sit up to 0.001 either side of the true one and a
    #    flip beyond 0.001 from the cut is a bug rather than a boundary case.
    #    Promotions dominate heavily, because a gap of 0.0296 needs only one of
    #    the two roundings to clear the cut while a demotion needs both to move
    #    the other way from an exact half. That is why the shipped share sits
    #    about half a point above the 4dp share: 52.4% against 51.8% on CFB.
    promoted: List[float] = []
    demoted: List[float] = []
    promoted_snaps = demoted_snaps = 0
    for team, row in payload["teams"].items():
        for key, e in row.items():
            blk = tendency.query(tables, team, *probe(key))
            p4, l4 = blk["pass_rate"], blk["league_pass_rate"]
            fine = (tendency.confidence(blk["shrink_weight"]) != tendency.LOW_CONFIDENCE
                    and p4 is not None and l4 is not None
                    and abs(round(p4 * 10000) - round(l4 * 10000)) >= round(ATTRIBUTE_MIN_DIFF * 10000))
            if fine == e["can_attribute"]:
                continue
            gap = abs(abs(p4 - l4) - ATTRIBUTE_MIN_DIFF)
            if e["can_attribute"]:
                promoted.append(gap)
                promoted_snaps += e["sample_size"]
            else:
                demoted.append(gap)
                demoted_snaps += e["sample_size"]
    cells = sum(len(r) for r in payload["teams"].values())
    worst = max(promoted + demoted) if (promoted or demoted) else 0.0
    print("  cells the 3dp round moved across the 0.03 cut: {} promoted ({} snaps), "
          "{} demoted ({} snaps), of {} cells ({:.2%})".format(
              len(promoted), promoted_snaps, len(demoted), demoted_snaps, cells,
              (len(promoted) + len(demoted)) / cells))
    print("  furthest any of them sits from the cut: {:.5f} (must be under 0.00100)".format(worst))

    # 5. Walk every real (team, situation) snap in the parquet. Compare the client
    #    read of the shipped file against the engine's own query.
    counts = (tendency.eligible(df)
              .assign(key=lambda f: buckets.bucket_series(f["down"], f["distance"], f["yards_to_goal"]))
              .groupby(["offense", "key"]).size())
    served = fell_back = no_read = mismatch = attributed = 0
    can_att_snaps = can_att_cells = cells = 0
    lost: Dict[int, int] = {}
    conf_snaps: Dict[str, int] = {}
    for (team, key), n in counts.items():
        n = int(n)
        cells += 1
        want = tendency.query(tables, team, *probe(key))
        got = lookup(payload, team, *probe(key))
        conf_snaps[got["confidence"]] = conf_snaps.get(got["confidence"], 0) + n
        if got["can_attribute"]:
            can_att_snaps += n
            can_att_cells += 1
        if got["rung"] in SHIP_RUNGS:
            served += n
            if (got["rung"] != want["rung"] or got["team"] != want["team"]
                    or got["sample_size"] != want["sample_size"]
                    or got["confidence"] != want["confidence"]
                    or got["shrink_weight"] != want["shrink_weight"]
                    or got["pass_rate"] != _r(want["pass_rate"])
                    or got["pass_rate_raw"] != _r(want["pass_rate_raw"])):
                mismatch += n
        elif got["pass_rate"] is None:
            no_read += n
        else:
            fell_back += n
            lost[want["rung"]] = lost.get(want["rung"], 0) + n
        attributed += int(got["rung"] == 5 and got["team"] is not None)
    total = served + fell_back + no_read
    print("  snaps served by a team cell:   {:>6} ({:.1%})".format(served, served / total))
    print("  snaps falling back to league:  {:>6} ({:.1%})  engine rungs behind them: {}".format(
        fell_back, fell_back / total,
        {r: "{} ({:.1%})".format(v, v / total) for r, v in sorted(lost.items())}))
    print("  snaps with no read at all:     {:>6} ({:.1%})".format(no_read, no_read / total))
    print("  team-served reads disagreeing with engine query: {} (must be 0)".format(mismatch))
    print("  rung-5 reads carrying a team name: {} (must be 0)".format(attributed))
    print("  confidence share of real snaps: {}".format(
        {c: "{:.1%}".format(v / total) for c, v in sorted(conf_snaps.items())}))
    print("  CAN NAME THE TEAM: {:.1%} of snaps ({} of {}), {:.1%} of live cells ({} of {})".format(
        can_att_snaps / total, can_att_snaps, total, can_att_cells / cells, can_att_cells, cells))
    print("  every other snap says 'offenses' instead: {:.1%}".format(1 - can_att_snaps / total))

    # 6. Named spot checks, straight out of the shipped dict.
    for team, key in _SPOTS.get(payload["league"], []):
        entry = payload["teams"].get(team, {}).get(key)
        base = payload["league_baseline"].get(key, {}).get("pass_rate")
        print("  {:<12} {:<18} league={}  shipped={}".format(team, key, base, entry))


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
