# More useful football data, checked September 5, 2026

The NFL history now covers 2023–2025, and six historical lessons use recorded play details from nflverse, FTN Data and CollegeFootballData. Those sources add useful explanations. They do **not** establish a stronger ability to predict the next play.

## NFL refresh and quality

Source grain is one recorded play per `(game_id, play_id)`. The existing nflverse ingestion and estimator were preserved. The local source files were downloaded August 29, 2026; this run used those files without making new NFL data calls.

| Season | Normalized rows | Eligible tendency plays | Games | Teams | Recorded pass share |
|---|---:|---:|---:|---:|---:|
| 2023 | 46,160 | 35,474 | 285 | 32 | 58.19% |
| 2024 | 45,919 | 34,902 | 285 | 32 | 57.01% |
| 2025 | 45,186 | 34,502 | 285 | 32 | 56.92% |
| Total | 137,265 | 104,878 | 855 | 32 | |

Checks found zero duplicate play IDs, duplicate within-game order values, missing eligible situation fields, or unbucketable eligible plays. Every season has 285 games and all 32 teams. Eligible volume fell 1.6% from 2023 to 2024 and 1.1% from 2024 to 2025; the checks found no missing season partition or lost team behind that change. Schema ranges and category exclusions passed.

The published table has 1,495 team entries and 728 attributable entries, occupies 197,869 raw bytes / 16,683 gzipped bytes, and fits the 100 KB compressed budget. Client lookup agrees with the engine for all 104,878 eligible source plays. Under the existing attribution rule, 45.1% of source situations may name the team; the others use the league comparison.

### What the historical labels mean

The existing NFL classification uses nflverse's recorded `play_type`: scrambles count as runs, while sacks count as pass plays. In the 2025 source, 1,352 sacks have `play_type=pass`; 1,149 scrambles have `play_type=run`. No-play penalties, special teams, kneels and spikes are excluded from tendencies. This is a historical play classification, not an identification of the coach's original call and not the same as grading every play as an observed throw or handoff.

The engine's `success` is the contract's yardage rule: gain 50% of the needed distance on first down, 70% on second, and all of it on third/fourth. nflverse's own `success` instead uses EPA. Those are different definitions and must not be pooled under one unlabeled percentage. `value` keeps nflverse EPA; the CFB parquet's value is CFBD PPA. No cross-league equivalence is assumed.

## Fresh validation: a statistical tie

The outer split trains on 2023–2024 and tests on all 34,502 eligible 2025 plays. The inner validation set starts at 2024 week 10 and contains 25.7% of eligible training plays. No game IDs or weeks cross the fit/holdout boundary.

| Measure on the untouched 2025 season | Current estimator | Same situation, no team information |
|---|---:|---:|
| Brier score, lower is better | 0.21896 | 0.21901 |
| Correct run/pass category at 50% cutoff | 62.47% | 62.14% |
| Expected calibration error | 0.01125 | 0.00821 |

The paired team-clustered bootstrap (2,000 repetitions) gives a Brier difference of −0.00005 with a 95% interval of **[−0.00085, +0.00083]**. This is a **statistical tie**, not evidence that team-specific rates forecast better. The older NFL Brier and significant advantage in `CONTRACT.md` describe the older, single-season within-year test; they must not be quoted as the result for this refresh.

The nested validation fit chooses `k=55.6`; the existing `k=60` lies inside the nearly flat range 23.6–117.6. The half-life remains one season. The final-season best fit would be a different number, but choosing it would leak the answers into the method. No estimator parameter was changed.

Shipping decision: publish fresher **descriptive history**, retain the existing method, and withhold claims of improved prediction. The internal `high` flag describes how much a rate depends on the team's sample; it does not mean high certainty about the next play. New opponent, score-state or personnel models need a separately specified chronological test before affecting live probability copy.

## Source access and actual new usage

### CollegeFootballData

Four small authenticated read requests were made using the existing private key. No key or account email is included in public assets.

- `/live/plays?gameId=401858433` returned **401**, explicitly requiring Tier 2 or higher. A second live feed cannot be connected with the current account access.
- `/passing/plays?year=2026&team=Oregon&gameId=401858433` returned **200 with zero rows**. Endpoint access is available, but this did not provide enrichment for the game being watched or establish how promptly those fields arrive.
- A 2025 Oregon week-1 request returned 227 rows across regular-season and postseason week 1. This is expected when `seasonType` is omitted, so targeted requests must specify it. The example exporter makes its own explicit postseason request and caches it privately under `data/raw`.
- Of the initial 227 records, 193 had air yards, 197 named the target, and 193 were marked completely parsed. Among **148 completions**, 122 (82.4%) had both air yards and yards after the catch; all 122 components reconciled to total yards. Missing components remain unknown and must never become zero. These are descriptive counts for this one targeted sample, not a league-wide coverage estimate.
- The chosen historical lesson uses Oregon–Indiana game `401769074`, play `401769074527`: 43 air yards, zero after the catch, 43 total. It is labeled as a parsed written report. Its structured clock differs from the time in its text, so the lesson deliberately does not claim an exact game-clock time.

The current [CFBD tier page](https://collegefootballdata.com/api-tiers) lists free access at 1,000 calls/month and Tier 2 at $5/month with 30,000 calls and live play-by-play. The refresh cost calculation now uses 1,000: its conservative cold-run projection is 286 calls/month, about 28.6%. Historical enrichment is already used in the lesson library; live performance and richer-field freshness remain unverified. [Passing field definitions](https://api.collegefootballdata.com/api/passing), [live endpoint](https://api.collegefootballdata.com/api/plays).

### FTN Data via nflverse

The public 2025 charting file returned **200**, requiring no account or key: 556,470 bytes, 47,316 rows, 285 games. Its `(nflverse_game_id, nflverse_play_id)` keys are unique and all 47,316 match the local nflverse play-by-play in a one-to-one join. This join establishes identity, not live availability.

Two lessons now use actual charting observations: a Josh Allen–James Cook screen, and Kyler Murray play action with motion. The latter says those actions were charted; it does not assert that a particular defender was fooled. The [public subset's documentation](https://nflreadr.nflverse.com/reference/load_ftn_charting.html) describes charting within 48 hours after games. That makes it appropriate for historical lessons, not a live observation of tonight's coverage.

The two FTN-derived lessons and their test source records retain **FTN Data via nflverse** attribution and the [CC-BY-SA 4.0 license](https://creativecommons.org/licenses/by-sa/4.0/). Those notices must remain visible when the lessons are displayed or reused.

### Sportradar

No Sportradar credential is configured in this repository's `.env` or the process environment. No paid account, trial or subscription was created. Documented fields are promising, but availability, delivery timing and completeness are untested for this app. This remains an access-dependent integration, not a connected source.

## Reproduce and verify

The compact machine-readable results are in [nfl-refresh-audit.json](nfl-refresh-audit.json). These commands use the repository virtual environment and preserve inspectable Python analysis rather than relying on a narrative claim:

```sh
.venv/bin/python engine/ingest_nfl.py --seasons 2023-2025
.venv/bin/python engine/audit_nfl_refresh.py --out docs/nfl-refresh-audit.json
.venv/bin/python engine/export_teaching_examples.py
.venv/bin/python -m unittest discover -s tests -p 'test_teaching_examples.py' -v
```

The audit checks the already-exported NFL table; use the existing exporter/refresh path when intentionally changing that table. Full `backtest.run()` and `calibrate.run()` were also executed against the new NFL parquet, along with the schema, bucket and tendency self-checks. The three lesson regression tests use small recorded source fixtures, reproduce all six shipped lessons, reject changed yardage, and reject ambiguous/missing FTN charting. Runtime lessons do not call paid APIs and do not modify the live game's state.
