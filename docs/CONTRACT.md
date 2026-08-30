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
def build(df, seasons=None, half_life=1.0, shrink_k=60.0) -> tables
def query(tables, team, down, distance, yards_to_goal) -> TendencyBlock
```

Widen until a rung has `sample_size >= 30`, then shrink the team's rates toward the league's rates for the same situation.

| rung | filter |
|---|---|
| 1 | team, recent seasons, exact bucket |
| 2 | team, recent seasons, field zone pooled with its neighbours |
| 3 | team, recent seasons, `down` + `distance_band` only |
| 5 | league average, exact bucket, no team attribution |

Rung 4 (team, all seasons, `down` only) is **removed**, and 4 is retired rather than reused so rung ordinals already written to disk keep their meaning. It was the worst thing in the engine: on 7,577 held-out CFB plays it scored 0.2395 Brier against the league's 0.1907 for the same situations, and -0.0700 skill in the NFL. Its error is bias, not variance, so shrinkage cannot rescue it -- pooling every distance and field position behind one down gives it the largest samples in the engine, so `n / (n + k)` would hand it the *most* trust of any rung. Fitting `k` on rung 4 alone returns `k = inf`: the estimator's own optimum is to delete it. Removing it is worth -0.0030 Brier on CFB with no fitted parameter (0.23337 to 0.23035 unshrunk, same held-out plays). Blocks that used to land there now fall to the league rung.

Recency weighting inside a rung: exponential decay by season, half-life one season. Current season weight 1.0, prior 0.5, and so on. The weights move the rates; `sample_size` stays the raw play count.

### Shrinkage

Rates computed on 30 to 50 plays carry a standard error near 0.08, so extreme buckets are mostly noise. Unshrunk, the engine's 0.9-1.0 CFB bin predicted 0.9331 and observed 0.8037, its 0.0-0.1 bin predicted 0.0522 and observed 0.1628, and the engine lost to a baseline carrying no team information at all. Every rate in the block is corrected by one constant:

```
shrunk = (n * team_rate + k * league_rate) / (n + k)
       = w * team_rate + (1 - w) * league_rate,   w = n / (n + k)
```

`k` is the number of plays at which a team's own history and the league's rate for that exact bucket deserve equal say. `league_rate` is the league's rate for the same bucket, falling back to its overall rate for the few buckets the league itself has never filled.

**`SHRINK_K = 60`**, fitted in `engine/calibrate.py` on a nested split: `k` is chosen on the last quarter of the training frame and scored on a holdout it never saw. Per-league honest picks are 49.9 (CFB) and 68.8 (NFL); the constant minimising summed validation regret is 58.6, and the pooled curve is within 0.0002 of its minimum for `k` in [38.2, 90], so the constant is identified to about a factor of two, not to three digits.

`k` is a property of *this* ladder. Fitted against the old five-rung ladder the same procedure returned `k` near 138; rung 4's large samples and bad predictions were what pulled it up, and deleting the rung more than halved it. **Any change to the ladder invalidates the constant.** Section 8 of `calibrate.py` re-fits on the ladder as it stands and prints whether the shipped constant is still inside the plateau.

The half-life stays at 1.0. Fitting `k` separately at each half-life and scoring the holdout frozen, the whole axis [0.5, inf] spans 0.00012 Brier on the CFB holdout against 0.00092 unshrunk. The decay knob was measuring the variance shrinkage now removes directly.

### Confidence

Confidence is a function of `shrink_weight` alone, never of the rung. The rung says which filter answered, which is a different question: rung 1 on 34 plays is a precise filter over a sample too thin to trust.

| flag | cut | at k=60 | meaning |
|---|---|---|---|
| `high` | `w >= 0.50` | `n >= 60` | at least half the printed number is the team's own history |
| `medium` | `w >= 0.35` | `n >= 32` | the block cleared the sample floor with room |
| `low` | `w < 0.35` | `n < 32` | the number is two thirds league or more |

`high` is not a free parameter: `w >= 0.50` is exactly `n >= k`, read off the constant already fitted. The `medium` cut is forced from below. The sample floor of 30 produces `w = 0.333` at k=60, so any medium cut at or under that weight makes every team rung medium or better and `low` becomes an exact synonym for "rung 5" -- the flag collapses back into the rung. Measured on the CFB holdout, cuts of (0.50, 0.25) put 8.3% of snaps in `low` and every one is the league rung. 0.35 is the smallest round weight strictly above the floor's.

The league rung is always `low`: it carries no team at all. At `low` the card must not attribute the number to the team; it says what offenses generally do.

`TendencyBlock` (also the shipped JSON row shape):

A real block, USC on 1st and 10 from their own 25, CFB tables over 2023-2025:

```json
{
  "bucket": "d1_long_own",
  "team": "USC",
  "rung": 1,
  "confidence": "high",
  "sample_size": 374,
  "shrink_weight": 0.8618,
  "pass_rate": 0.5417,
  "pass_rate_raw": 0.5559,
  "league_pass_rate": 0.4531,
  "success_rate": 0.4966,
  "explosive_rate": 0.192,
  "matched_key": "d1_long_own"
}
```

- `pass_rate` is the number to print, already shrunk. `pass_rate == w * pass_rate_raw + (1 - w) * league_pass_rate` holds to the stored precision.
- `pass_rate_raw` is the team's own unshrunk rate, `None` on the league rung. It is a diagnostic. Nothing user-facing prints it, because it is the number measured to be wrong.
- `shrink_weight` is `w`. It decides whether copy may attribute the number to the team, and it is the only honest basis for that call.
- `success_rate` and `explosive_rate` are shrunk toward their own league counterparts with the same `k`.

### Measured against the bar

Out of sample, against the league's rate for the identical situation bucket (`engine/backtest.py`, unchanged):

| | before | after | situation baseline | league average |
|---|---|---|---|---|
| CFB Brier | 0.23337 FAIL | **0.22740 PASS** | 0.22880 | 0.24997 |
| NFL Brier | 0.22136 FAIL | **0.21918 PASS** | 0.22134 | 0.24550 |
| CFB ECE | 0.0278 | **0.0092** | 0.0033 | |
| NFL ECE | 0.0217 | **0.0126** | 0.0075 | |

Team-clustered paired bootstrap, 2000 reps, against the situation baseline: CFB -0.00140, 95% CI [-0.00309, -0.00007]; NFL -0.00217, 95% CI [-0.00388, -0.00048]. Both exclude zero. Team attribution now earns its place, having previously lost to a model with no team in it.

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
