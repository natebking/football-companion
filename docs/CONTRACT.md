# Build contract

Interfaces every module codes against. Written before implementation so parallel work composes. If an implementation needs to deviate, it says so in its output rather than silently diverging.

## Cue selection — September 13, 2026 (`read-6`)

Broad game/drive player cues retain their existing minimum counts, naming-coverage gates and share requirements. When a supported goal-to-go, third-down-distance, second-and-long or currently relevant long-third-down observation is available, a broad player cue with no carry/target in the last two eligible offensive actions has priority 50. Age comes from same-team released action IDs, excludes penalties/no-play/clock plays and the other team's plays, and is recomputed after correction or replay seek. Unknown age never establishes staleness. A third-down-specific receiver remains governed by its narrower evidence. Urgent score/clock, fourth-down and verified drive patterns retain their priorities.

The long-third pattern has priority 75 on second/third-and-seven-plus and 49 elsewhere; it remains available when nothing stronger exists. Historical reads retain priority 70, so a matched historical comparison can win an active context replacement. The displaced workload appears as `supportingPlayer`, without a second watching instruction. Its count support and the two action IDs establishing age are included in `read.playIds`; journals preserve its wording and metadata, and the journal auditor compares both. Replay and refreshes need no additional selection state. See [the evaluation](CUE-SELECTION-2026-09-13.md).

## Finished-game replay — September 13, 2026

`FootballReplay.fromSummary` validates the requested College/NFL event and final status, sanitizes ESPN play reports, and calls `prepare`. Games has a Finished games view with date selection, team search, aborted/stale-request protection and explicit empty/error states. Final games open replay links rather than selecting a finished live feed. `snapshot(model, count)` creates an ESPN-shaped summary containing only the selected prefix, preserving original drive boundaries. Score, status and clock come from that prefix; unknown values remain unknown. Seeking resets LIVE and PRIME before applying the snapshot through the normal analysis pipeline. No future play's start block, final boxscore or full-game leader table enters the snapshot. Replay fetches the final summary once and has zero effective delay without changing the saved setting, never polls live endpoints, and does not write simulated arrivals, journal entries, prediction results or concept exposures. This is a demonstration of current analysis using final reports, not a reconstruction of historical live availability. Historical comparison tables are current, not frozen as of the replay date; they may contain later games and must not be treated as held-out forecasts. See [the original replay verification](REPLAY-2026-09-07.md) and [the September 13 audit](RECENT-GAME-AUDIT-2026-09-13.md).

## Evidence reads — September 6, 2026

The live-read pass uses `FootballRead` version `read-5`. Safe aggregates include named receivers/runners, eligible throw/run denominators, naming coverage and the exact supporting play IDs. A focus is rebuilt from released evidence on each selection; missing names, tied leaders, insufficient coverage or a changed possession can invalidate it. Overall carry share does not justify a runner focus on third-and-seven or longer. Consequential drive patterns and decisions can outrank player workload. All read types use the same priority rule, with the current read retained on ties. These are descriptive selection rules, not a fitted forecast or evidence of who is currently on the field.

`FootballPlay.describe` additionally returns `gameSummary`, `gameConsequence`, `takeaway` and `provenance`. The default feed uses the concise summaries and shows the newest takeaway directly. Unsupported takeaways remain empty; source revisions can remove previously valid details. Journals distinguish teaching levels, collapsed details and the actual lines rendered. The combined Game context disclosure controls whether historical percentages count as displayed. See [player-focus verification](PLAYER-FOCUS-2026-09-06.md).

The default main card is now selected by `FootballRead` from the pre-snap whitelist and `FootballInsights.forRead` aggregates of already released plays. This explicitly extends PRIME's input with safe named counts, supporting play IDs and verified drive totals; raw reports still never cross into PRIME. LIVE emits the evidence before the final next-snap event in a queue pump. Corrections recompute the evidence and cannot let newer queued plays jump ahead.

Beginner is an explicit preference and uses the original authored cards; the default does not use that fallback. Prediction questions are opt-in and tied to the main read. A quiet card is valid when there is no supported new observation. Existing historical probability tables are unchanged, displayed in a disclosure with their limitations, and suppressed for fourth-down and urgent late-game decisions.

Journals store read versions, support IDs, exact displayed wording and voluntary usefulness feedback. The offline journal audit reconstructs the evidence using only source revisions released before each visible prompt. Final review data is a correction reference, never a predictor input. These checks establish reproducibility and data support, not learning or forecasting accuracy.

`engine/freeze_context_candidate.py` freezes separate research candidates and baseline tables without writing web assets. `engine/replay_forecasts.py` uses `forecast_replay.js` to compare them on saved context, with final outcomes joined separately by game/play/offense. A saved visible percentage, the frozen baseline and a counterfactual candidate are distinct values. Explicit pre-arrival target links and released basis evidence are required; later context cannot fill missing input. Development sessions and prospective sessions remain separate, as do NFL and college. See the [forecast protocol](FORECAST-REPLAY-PROTOCOL-2026-09-06.md) for sample gates and exclusions. No automatic retraining, background collection or live model promotion is introduced.

## Current evidence and learning views — September 5, 2026

The NFL export now covers 2023–2025. Its 2025 holdout Brier is **0.21896** versus **0.21901** for the situation-only baseline. The paired difference interval **[−0.00085, +0.00083]** includes zero. There is no demonstrated NFL team-specific forecasting edge in this newer test. The historical measurements below explain the original estimator decisions; they are not current performance claims. See [the refresh audit](DATA-REFRESH-2026-09-05.md) for complete results.

New modules keep the existing live truth boundary:

- `FootballPlay.describe` exposes a situational explanation, literal named people, validated movement, and optional passing components. Missing or inconsistent distances remain unknown. A short throw never establishes a screen; a sack never establishes a blitz.
- `FootballInsights.summarize` uses all released raw play records, deduplicated by play ID. A correction replaces the original. Drive totals require consistent positions and movement, with penalty progress separated. Player and direction counts describe available reports and disclose missing coverage.
- `FootballLearning` chooses eight observational lessons from the whitelisted pre-snap situation. Static diagrams show examples only. Self-reported observations are separate from prediction grading and are never evidence of mastery.
- `FootballDepth` renders these views. All game aggregates cross the same TV-delay queue as the play feed, including initial history and corrections. They never read an unreleased source snapshot to obtain scores or totals.
- `teaching-examples.json` contains twelve identified historical plays and six practice pairs, each using a different game for the second example. FTN-derived lessons retain attribution and CC-BY-SA 4.0 source links. Sources are not queried by the runtime library. Historical examples never modify the live game.

## Architecture

Static site, no backend. The browser polls ESPN directly (ESPN 403s datacenter IPs but serves `access-control-allow-origin: *`) and looks up precomputed tendency tables shipped as static JSON. Card copy comes from a verified template library filled with computed numbers, so the live path makes zero LLM calls. Feed errors and parsing mistakes remain possible and require explicit checks.

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

The calibration measurements below record the original method selection. The refreshed NFL nested fit selects `k=55.6`, with the existing `k=60` inside its flat range of 23.6–117.6; no parameter changed.

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

### Original validation (superseded for current NFL reporting)

Out of sample, against the league's rate for the identical situation bucket (`engine/backtest.py`, unchanged):

| | before | after | situation baseline | league average |
|---|---|---|---|---|
| CFB Brier | 0.23337 FAIL | **0.22740 PASS** | 0.22880 | 0.24997 |
| NFL Brier | 0.22136 FAIL | **0.21918 PASS** | 0.22134 | 0.24550 |
| CFB ECE | 0.0278 | **0.0092** | 0.0033 | |
| NFL ECE | 0.0217 | **0.0126** | 0.0075 | |

Team-clustered paired bootstrap, 2000 reps, against the situation baseline: CFB -0.00140, 95% CI [-0.00309, -0.00007]; NFL -0.00217, 95% CI [-0.00388, -0.00048]. Both excluded zero in that original test. The newer full-season NFL holdout above does not establish that advantage.

## Shipped tendency JSON

`web/tendency-cfb.json`, `web/tendency-nfl.json`. Written by `engine/export_tables.py`, read by the browser once at load.

The size gate is the **gzipped** bytes, because that is what crosses the wire and what the phone waits on: under 100KB each. CFB ships 74,008 gzipped over 920,201 raw, NFL 16,683 over 197,869 after the September 5 refresh (the exporter reports both on every run). Uncompressed size is a parse cost of a few milliseconds and no transfer cost, so it is reported and not budgeted. Rates round to 3 decimals, `shrink_weight` to the engine's 4 so the two never disagree about a confidence cut.

```json
{
  "generated": "2026-08-29",
  "league": "cfb",
  "seasons": [2023, 2024, 2025],
  "rules": {"shrink_k": 60.0, "min_sample": 30,
            "confidence_cuts": {"high": 0.5, "medium": 0.35},
            "attribute_min_diff": 0.03},
  "league_overall": {"pass_rate": 0.495, "success_rate": 0.43,
                     "explosive_rate": 0.154, "sample_size": 360592},
  "league_baseline": {
    "d3_long_own": {"pass_rate": 0.809, "success_rate": 0.253,
                    "explosive_rate": 0.197, "sample_size": 10320}},
  "teams": {
    "Ohio State": {
      "d3_long_own": {"pass_rate": 0.851, "pass_rate_raw": 0.903, "sample_size": 49,
                      "shrink_weight": 0.4495, "rung": 1, "can_attribute": true}}}
}
```

Teams carry every bucket that reached rung 1, 2 or 3. Rung 3 ships now that confidence is a function of `shrink_weight` rather than of the rung: a rung-3 cell on 200 plays is exactly as trustworthy as a rung-1 cell on 200 plays, and the same two conditions gate it. It costs 1,405 CFB cells and buys an exact match to the engine on every snap, so the client read and `tendency.query` now agree on all 360,592 CFB and 104,878 NFL eligible plays. Rung 4 cannot appear because the engine no longer has it; the ordinal stays retired. Rung 5 is the league line, which is `league_baseline`, not a team cell.

`rules` carries the constants the file was built under so the client holds no magic numbers. `league_overall` is the last-resort league line for the handful of buckets the league itself never filled (four in the NFL, every one of them 1st and short, in all four zones outside the red zone); a team can still reach rung 2 or 3 there through a widened filter, and the engine shrinks toward the overall rate, so the client must fall back to the same thing.

### `can_attribute`

The one field the copy hangs on. Precomputed per cell, true only when **both** hold:

| condition | test | meaning |
|---|---|---|
| the number is mostly the team's | confidence is not `low`, i.e. `shrink_weight >= 0.35` | at least a third of it is their own history |
| the team differs from everyone | `abs(pass_rate - league bucket rate) >= 0.03` | naming them says something the league line does not |

Both, never one. 92.2% of CFB snaps clear the confidence gate and only 56.8% of those also clear the difference gate; the NFL runs 90.7% and 51.2%. Gating on confidence alone would print "USC throws here 78%" on nine snaps in ten while printing the league's own number on nearly half of them.

It is computed once at export, from the rounded numbers that actually ship, comparing whole thousandths rather than floats (`abs(0.68 - 0.65) >= 0.03` is False in binary floating point). A reader can reproduce every value from the file alone, and the client applies no rule of its own.

Shipping at 3 decimals rather than the engine's 4 moves the boolean on 36 of 7,110 CFB cells (all promotions) and 8 of 1,120 NFL cells (7 promotions, 1 demotion), every one of them within 0.0008 of the 0.03 cut. Both rates round independently, each by at most half a thousandth, so the shipped gap can land up to 0.001 either side of the true one; promotions dominate because a gap of 0.0296 needs only one of the two roundings to clear the cut while a demotion needs both to move the other way from an exact half. Net effect on the headline share is +0.6 points on CFB (52.4% shipped against 51.8% at full precision) and +0.1 on the NFL (46.5% against 46.3%). A 2.96-point separation and a 3.00-point separation are not a distinction this product can defend, so the cheaper file wins.

One residual the rule does not catch. A rung-2 or rung-3 cell's raw rate was measured over a wider filter than the bucket it ships under, while the difference gate compares the result to the league's rate for the *exact* bucket. A team that is perfectly ordinary at the filter that actually measured them can therefore clear the gate on the widening alone. Checked against the league's rate at each cell's own matched filter, that is 229 of 3,589 attributable CFB cells (6.4%, 5.4% of attributable cell-snaps) and 12 of 493 NFL cells (2.4%, 2.8%). Closing it would mean shipping league rates at every widened filter too, which this file does not carry and which would cost more than the error does. Logged, not fixed.

Measured by reading the shipped files over every eligible play in the parquet:

| | CFB | NFL |
|---|---|---|
| snaps a team cell answers | 95.9% | 95.4% |
| snaps that may name the team | **52.4%** | **46.5%** |
| snaps that must say "offenses" | 47.6% | 53.5% |

Call it half. This is the governing fact for card copy: half the time the card says "Ohio State throws here 85%", and the other half it says "offenses throw here 81%".

### Client read

`export_tables.lookup()` is the reference implementation; `web/app.js` ports it.

| state | card says | number comes from |
|---|---|---|
| team cell, `can_attribute` true | name the team | the cell's `pass_rate` |
| team cell, `can_attribute` false | "offenses" | `league_baseline[key].pass_rate` |
| no team cell | "offenses" | `league_baseline[key].pass_rate` |
| no baseline row either | "offenses" | `league_overall.pass_rate` |

A cell whose `can_attribute` is false is never read by copy, because the card prints the league line over that situation either way. It ships as a diagnostic and is the first thing dropped if the file ever exceeds its budget: `_fit()` drops non-attributable cells first, then team cells bucket by bucket, least-used bucket first, leaving `league_baseline` whole so every dropped cell still has a fallback. Neither stage has run. Both files fit as built.

## Live feed repair

The next situation is read from the `end` block of the last play in ESPN's summary. Measured over six complete college games on 2026-09-05 (1,036 poll states, replayed prefix by prefix against the next real play's `start` block), the raw read was wrong on 50 of them and produced no card on 58 more where a card was due. Four rules in `web/app.js` (`isMarker`, `fixSituation`, `preSnap`, `sameSnap`) bring that to 21 wrong, of which 7 are the seconds between a half's last snap and the clock reading 0:00, and 3 are the harness disagreeing with itself. The rest are ESPN moving the spot or the down between one play's `end` and the next play's `start`, which nothing pre-snap can see.

| what ESPN does | how often | rule |
|---|---|---|
| Timeout, End Period, End of Half and End of Game rows carry stale or zeroed `start` and `end` blocks, and are sometimes inserted out of order | 58 of 1,036 poll states had one as the last play | `preSnap` steps back past marker rows to the last real play. Markers never emit `result`, so a timeout before the snap leaves a pending call standing. |
| `end.yardsToEndzone` in the wrong perspective, exactly `100 - true` | 21 of 917 end blocks | `possessionText` ("OSU 48", "50") agreed with the truth on all 917. It overrides the number only when the number is its exact mirror; a correction of a few yards is never second-guessed. |
| `end.distance` 0 or negative | a handful per game | On an end block it means the marker was reached and the down not yet advanced: 1st and 10. On a `start` block, 0 is how ESPN writes "and goal", so it becomes the yards to goal. |
| After a change of possession, `end.down` and `end.distance` still describe the drive that just ended | fumble recoveries, punt returns | Possession changed (`start.team` differs from `end.team`): 1st and 10, or and goal inside the ten. |
| Halftime | every game | `STATUS_HALFTIME`, or period 2 or 4 with the clock at 0:00, means no next snap: no card until the kickoff. Between quarters the situation carries over and the card stays. |
| Spot corrected by a few yards between `end` and the next `start` | about one snap in fifty | A released play settles a call when the offense and down match and the ball is within five yards. Exact match was leaving those calls ungraded. |

`sitKey` is `down|distance|yardsToGoal|teamId` after these rules, built by the same function for the end block the card comes from and the start block a released play is matched by, so the two agree.

The scoreboard call needs no `groups` or `limit` parameter: the default returns the same 68 FBS games as `groups=80&limit=200`.

## Card library

`web/cards.json`. Verified content, written once, checked against real coaching references. No runtime generation.

Rules:

- **Prime cards receive pre-snap information only.** Situation and tendency block. Released result fields settle an existing pick; they do not choose a card or write its watch instruction.
- Full `watch` definitions are the default. `watch_short` requires the user's explicit Shorter hints setting (`fc_short_hints`). Exposure or correct guesses never shorten the copy automatically.
- Suggestions invite the reader to look. They do not assert a formation, coverage, route, or coaching intent that the live data has not established.
- Stored `explain_hint` and `ask.resolve` are editorial reference material, not post-play evidence. They are never attached to a prediction grade.
- No em dashes. No exclamation points. No hype.

## Post-play descriptions and grading

`web/play-facts.js` exposes the pure `FootballPlay.describe(play, teamAbbreviations)` function. It returns a summary, consequence, optional reported players and facts, original report, and conservative grading fields. LIVE owns this output and releases it through the existing TV-delay queue. Player names and optional formation, direction, and depth never enter PRIME.

The renderer uses reported end states for the next down, respects changes of possession and scoring conversions, and declines malformed or contradictory fields. Accepted penalties and called-back plays show the original report by default rather than guess the ruling. Optional details disappear when missing; absent direction is not evidence of any particular direction.

Grades describe actual actions: a scramble is a run; a sack is ungraded. Penalties, missing data, and ambiguous play types do not count against a prediction. Return yardage on a turnover is not offensive progress. Markers such as timeouts do not settle predictions. When the feed moves on without a matching result, an answered pick is recorded as ungraded; switching games closes the old pick with its original league and game.

Play IDs are versioned by content. Corrections replace their existing rows through the delay queue; late backfills preserve source ordering and cannot settle predictions or supply timing samples. A correction that changes grading evidence invalidates the existing prediction record. The next-card heading uses normalized numeric down/distance.

Repeated source clocks across three eligible scrimmage plays are marked unreliable by `web/feed-health.js`. Do not infer a ticking clock or a TV offset from those values. The TV-delay panel measures first receipt to a viewer tap for newly received plays; applying that measured delay is explicit. Request success and the age of the last play update are separate diagnostics. See [the timing incident](TIMING-INCIDENT-2026-09-05.md).

Timing samples exclude revised reports, batches of multiple new forward non-marker plays, and the first updates after a response gap longer than the nine-second freshness window. An interruption invalidates an existing sample; selection must use the latest non-marker row without falling back to an older eligible play. Poll and queue-release diagnostics distinguish arrival batches, response gaps, overdue local releases, and intentional delay changes. A pump publishes only its final due snap/nosnap, so intermediate catch-up situations cannot create learning exposures or predictions. Each logical transition still closes an unmatched pending pick before later results can grade it. Multiple releases more than nine seconds overdue require a fresh timing sample unless triggered by an intentional delay change.

Scoreboard snapshots and approved context refreshes share the ordered TV-delay queue. Same-play clock/score/season/health changes refresh guidance without opening another prediction or counting another snap; a different source play ID advances even if its end situation repeats. A pump coalesces due context refreshes with a due new snap into one final display. A report correction removes dependent queued context as well as the old snap before its revised delay. Journals label context refreshes so clock ticks do not consume read cooldowns in offline replay.

A selected game has at most one active summary request, with a 15-second timeout. A game or league change aborts and invalidates old requests and clears the old queue before new tables load. Summary refreshes are three seconds during play and thirty seconds after a final; stale scoreboard responses are also ignored.

## Concept exposure and prediction history

`localStorage`, key `fc_ledger`, records `exposures` and `last_seen` for terms on cards shown. It does not measure recognition or understanding. There are no automatic learning or familiarity states.

```json
{ "concepts": { "sticks": { "exposures": 3, "last_seen": "2026-09-05T20:12:00Z" } } }
```

`fc_asks` separately records prediction answers, correctness when gradable, and latency. The visible prediction score includes only answered, graded picks. This score is not evidence of learning football concepts.

## Presentation

The companion has light and dark themes, with System as the default. `web/theme.js`
applies the saved `fc_theme` preference before the stylesheet loads; this preference
is local to the device and independent of the game, delay, and learning ledger.
`web/styles.css` owns the responsive layout. `web/ui.js` measures the sticky header
and manages dialog focus and keyboard dismissal without accessing feed state.

Predictions and their results sit below the teaching card in normal page flow.
There is no fixed bottom bar. The Games button lives in the header. Team logos
use the URLs supplied by ESPN in scoreboard and summary records; names remain
visible if a logo is missing or fails to load. Logos stay in LIVE and do not
expand PRIME's input whitelist.

The field-position diagram in PRIME reads only the existing released pre-snap whitelist.
`field-view.js` adds a local per-game TV orientation preference. Until the viewer chooses a direction, the diagram uses the conventional offense-to-the-right view and offers Match TV. A chosen direction mirrors the ball, first-down/goal line, possession arrow and labels of the defended ends. Regulation possession changes retain each team's end; the second and fourth quarters reverse the directions within a half. Halftime and each overtime period require a fresh match, because goal choice is not reported. NCAA overtime uses the same selected scoring end for both teams' possession series. The NFL retains opposite directions within its overtime period. These are presentation rules, not inferred camera or player-tracking data. Period and possession reach the diagram only through the existing TV-delay queue. Changing the view never changes yardage, analysis or predictions. Storage failure retains the choice for the current session.
Underlined football terms open a definition popover from `web/glossary.js`, including keyboard dismissal and focus restoration. The header links to a How it works dialog. The raw play description remains available under each play's disclosure. No card
copy, attribution rule, grading rule, or broadcast-delay rule changes with the theme.

### UX voice

Write like a knowledgeable person watching alongside the reader: direct, calm,
and specific. Give the observation or next action without slogans, pep talks,
or generic reassurance. Use “Your pick: Run” for a submitted answer and “413
plays” for a sample count. Do not repeat the down and distance under its heading.
Prompts suggest what to look for; they must not claim to have seen a formation
or infer a coach's intent from the play feed. Practice history records exposure
and answers, not demonstrated mastery of football concepts.

## Descriptive previous-season profiles

`engine/history_profiles.py` exports separate league files. `game-history.js` matches only approved pre-snap fields to static aggregates. No raw report is passed to PRIME. The selected game must explicitly report the year immediately following the profile season and a regular/postseason type. Missing context yields no historical comparison; there is no broader-cell fallback.

The grouping uses down, distance (1–3/4–6/7+), field area (goal-to-go/inside-20/outside-20), offensive score margin (ahead9+/behind9+/within8), and clock phase (last5minutesQ4/last2minutesQ2/other). Counts require 20 plays in 5 games. A conversion statistic requires 20 clear outcomes; an action’s yardage statistic requires 15. At least 90% of relevant outcomes must be known. These thresholds govern display, not a statistical-confidence label. Unknown outcomes are excluded from the denominator and disclosed. Contexts with impossible distance/field relationships or unknown score/clock are excluded.

A conversion means the offense gained a first down or scored a touchdown without losing possession. NFL outcomes join raw nflverse identifiers and offense; flagged plays are unknown. College plays with ambiguous penalties/fumbles remain unknown; ordinary gains and offensive touchdown/interception types establish the result. Interception return yards never count as offensive gains. Source clocks and college labels use the same shared alignment as the research evaluation.

Historical reads are subordinate to urgent decisions and stronger current-game evidence, with the same repetition cooldown. Journal entries preserve exact dataset IDs, team, side and context. An audit without the referenced dataset must report that historical read as unverifiable. These counts do not replace live probability estimates, adjust for opponents, establish causation, or identify the current coaching staff.

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

## Historical practice — September 6, 2026

`web/practice.js` owns the separate local `ff_recognition_v1` record. Opening a worked example records its source identity; starting practice freezes the bank version/hash, question, source play, supporting facts, level and prior exposure information. Only the first answer in that attempt is accepted. “Not sure” is stored separately from unsupported answers. A repeat is never substituted for an earlier result. Practice targets are omitted from the library listing so their answer-bearing titles and summaries are not shown before the question.

Answers are interpretations of supplied historical evidence, not reports of what the viewer saw on television. No practice event enters the live game, prediction ledger, game journal or main-card selector. There is no mastery score or automatic adjustment to teaching level. The recorded level is the one at question opening; later preference changes do not relabel it.

The optional history holds at most 200 attempts and never drops earlier ones automatically. It can be downloaded or explicitly cleared. Storage failures are visible; in-memory answers remain downloadable and unreadable stored records are not overwritten. Unknown prior history is recorded as unknown. Opening/rendering an example is not evidence that a viewer read it, and these answers alone cannot establish learning gains or video recognition.

The [practice audit](PRACTICE-AUDIT-2026-09-06.md) verifies exports against their exact source bank and separates first recorded, repeated and unknown exposure. It does not pool browser exports as unique viewers, turn “Not sure” into an incorrect answer, or treat QA as viewer evidence.

### First visit, settings and diagnostics (September 6, 2026)

A new browser waits for explicit game selection. Boot and league changes may restore a saved unfinished game but may not substitute another live game. Scoreboard refresh never selects a game. Without a valid saved delay, hold updates for 45 seconds and label the control Sync TV; the delay sheet must state that this is an unmeasured estimate. Explicit settings, including zero, are preserved. Manual adjustment is a chosen delay, not a claim of measured synchronization.

Games contains team search and the schedule. Settings is a separate dialog, reachable from Games and the footer. Read the game remains the default and prediction questions remain opt-in. Opening a dialog makes it focusable immediately; the visibility transition must not prevent focus from entering it.

Diagnostics remain browser-local. Consecutive unchanged polls may be coalesced, retaining their count, first and last time, and latest/maximum response gap; meaningful source, queue, clock, correction and resumption changes are not coalesced. Consumers must not equate event-row counts with the number of polls. Dirty records persist every 30 seconds and when the page hides or backgrounds. Copy diagnostics reads the current in-memory ring.

The public source/privacy explanation is `web/data.html`; source-specific notices are in `NOTICE.md`. FTN-derived examples and practice display attribution and adaptation notices. This does not change the historical bank, probability tables, or data-sharing behavior.
