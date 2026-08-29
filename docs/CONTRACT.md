# Build contract

Interfaces every module codes against. Written before implementation so parallel work composes. If an implementation needs to deviate, it says so in its output rather than silently diverging.

## Architecture

Static site, no backend. The browser polls ESPN directly (ESPN 403s datacenter IPs but serves `access-control-allow-origin: *`) and looks up precomputed tendency tables shipped as static JSON. Card copy comes from a verified template library filled with computed numbers, so the live path makes zero LLM calls and cannot hallucinate.

```
CFBD API  ─┐
           ├─► engine/ingest_*.py ─► data/plays_{cfb,nfl}.parquet (unified schema)
nflverse  ─┘                                    │
                                                ▼
                                    engine/tendency.py (aggregate)
                                                │
                                                ▼
                                    web/tendency-{cfb,nfl}.json (static, shipped)
                                                │
browser: ESPN poll ─► situation ────────────────┴─► card template ─► rendered card
```

## Unified play schema

One row per play, identical columns for both leagues. Parquet.

| column | type | notes |
|---|---|---|
| `league` | str | `cfb` or `nfl` |
| `season` | int16 | |
| `week` | int8 | |
| `game_id` | str | source game id |
| `play_id` | str | unique within game |
| `play_index` | int32 | 0-based order within game |
| `offense` | str | team name, source spelling |
| `defense` | str | team name, source spelling |
| `period` | int8 | 1-4, 5+ = OT |
| `clock_seconds` | int16 | seconds remaining in period, null if unknown |
| `down` | int8 | 1-4, null on kickoffs/PATs |
| `distance` | int8 | yards to first down |
| `yards_to_goal` | int8 | 1-99, distance to opponent end zone |
| `play_type_raw` | str | source string, unmodified |
| `is_pass` | bool | |
| `is_rush` | bool | |
| `is_special` | bool | kickoff, punt, FG, PAT |
| `is_penalty_only` | bool | no-play penalties, excluded from tendency |
| `yards_gained` | int8 | |
| `value` | float32 | EPA (nfl) or PPA (cfb), null ok |
| `success` | bool | standard: 50% of distance on 1st, 70% on 2nd, 100% on 3rd/4th |
| `score_diff` | int8 | offense score minus defense score, pre-snap |
| `play_text` | str | source description |

Rows where `is_special` or `is_penalty_only` are excluded from tendency aggregation but kept in the parquet.

## Situation bucket

```python
def bucket(down: int, distance: int, yards_to_goal: int) -> str
```

- `distance_band`: `short` (1-3), `medium` (4-7), `long` (8+)
- `field_zone`: `own_deep` (yards_to_goal 80-99), `own` (60-79), `mid` (40-59), `opp` (20-39), `red` (1-19)
- key format: `d{down}_{distance_band}_{field_zone}`, e.g. `d3_medium_mid`

## Tendency query and fallback ladder

```python
def query(team: str, league: str, down: int, distance: int, yards_to_goal: int) -> TendencyBlock
```

Widen until a rung has `sample_size >= 30`. Rung drives confidence, and card copy softens as confidence drops.

| rung | filter | confidence |
|---|---|---|
| 1 | team, recent seasons, exact bucket | high |
| 2 | team, recent seasons, drop `field_zone` | high |
| 3 | team, recent seasons, `down` + `distance_band` only | medium |
| 4 | team, all seasons, `down` only | medium |
| 5 | league average, exact bucket | low |

Recency weighting inside a rung: exponential decay by season, half-life one season. Current season weight 1.0, prior 0.5, and so on.

`TendencyBlock` (also the shipped JSON row shape):

```json
{
  "bucket": "d3_medium_mid",
  "team": "USC",
  "rung": 1,
  "confidence": "high",
  "sample_size": 47,
  "pass_rate": 0.78,
  "league_pass_rate": 0.71,
  "success_rate": 0.52,
  "explosive_rate": 0.14
}
```

At `low` confidence the card must not attribute the number to the team; it says what offenses generally do.

## Shipped tendency JSON

`web/tendency-cfb.json`, `web/tendency-nfl.json`. Target under 400KB each uncompressed so the phone loads them once.

```json
{
  "generated": "2026-08-29",
  "seasons": [2023, 2024, 2025],
  "league_baseline": { "d3_medium_mid": { "pass_rate": 0.71, "...": 0 } },
  "teams": { "USC": { "d3_medium_mid": { "pass_rate": 0.78, "sample_size": 47, "rung": 1 } } }
}
```

Teams carry only buckets that reached rung 1 or 2. Everything else falls back to `league_baseline` client-side, which is what keeps the file small.

## Card library

`web/cards.json`. Verified content, written once, checked against real coaching references. No runtime generation.

```json
{
  "id": "d3_long_pass_expected",
  "applies": { "down": [3], "distance_band": ["long"], "min_pass_rate": 0.75 },
  "prime": {
    "situation": "3rd and {distance}, they need it in one play.",
    "tendency": "{team} throws here {pass_rate}% of the time.",
    "watch": "Watch the deepest defenders. They'll line up right around the first-down marker."
  },
  "concepts": ["sticks", "soft_coverage"],
  "explain_hint": "If the catch happened short of the marker, that cushion is why."
}
```

Rules, non-negotiable:

- **Prime cards receive pre-snap information only.** Situation, tendency block, ledger state. The play result is not passed to the prime path at all, so nothing can leak and no filter is needed.
- Outcome knowledge does exactly two things, both in code, never in copy: veto a queued prime (kneel, spike, penalty wipe) and gate explain cards.
- 25 word cap on primes, 40 to 70 on explains.
- No term appears undefined. First use carries a plain inline definition; the ledger tracks exposure and drops the definition at `learning`.
- No em dashes. No exclamation points. No hype.

## Concept ledger

`localStorage`, key `fc_ledger`. States: `unknown` → `introduced` (1) → `learning` (2-4) → `familiar` (5+). Dormancy and spaced re-surfacing are deferred until the loop survives three weekends.

```json
{ "concepts": { "sticks": { "exposures": 3, "last_seen": "2026-08-29T20:12:00Z", "state": "learning" } } }
```

## File ownership

One owner per file, so parallel work never collides.

| file | owner |
|---|---|
| `engine/schema.py` | shared, written first |
| `engine/ingest_nfl.py` | ingest-nfl |
| `engine/ingest_cfb.py` | ingest-cfb |
| `engine/buckets.py`, `engine/tendency.py` | engine |
| `engine/export_tables.py` | export |
| `engine/backtest.py` | backtest |
| `web/cards.json` | cards |
| `web/app.js`, `web/index.html` | site |
| `index.html` (v0 stopwatch) | frozen, do not edit |
