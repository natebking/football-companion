# What the new model would have said

The two existing college journals support 21 counterfactual forecasts from saved, visible pre-snap situations. Only three of those moments visibly displayed a percentage. No prospective result is available: both sessions predate the frozen candidate, and their outcomes had already been examined. The live probability files remain unchanged.

The [protocol](FORECAST-REPLAY-PROTOCOL-2026-09-06.md), [freeze manifest](forecast-freeze-manifest.json) and [audit summary](forecast-replay-audit.json) preserve the method, source hashes and limits. Full rows and private journal exports stay in ignored local data. The input/output calculation is [forecast_replay.js](../engine/forecast_replay.js); [replay_forecasts.py](../engine/replay_forecasts.py) validates the frozen model files and supplies exact-game labels from cached final sources.

| Captured session | Saved guidance records | Eligible counterfactuals | With a displayed percentage | Prospective |
|---|---:|---:|---:|---:|
| Texas A&M–Missouri State | 23 | 19 | 3 | 0 |
| Washington–Washington State | 20 | 2 | 0 | 0 |
| Total | 43 | 21 | 3 | 0 |

Twenty-two records were excluded. Reason counts overlap: 14 were background/covered records, seven lacked an explicit saved link to the target play, and three had an ineligible outcome family. Matching clock/down/distance never creates a link. Quiz voids are not outcome labels; the evaluation uses the historical pass/rush definition.

The three displayed Texas A&M moments illustrate what adding context changes. All were in the fourth quarter with a 47-point lead. The candidate allows that score and clock to influence its pass estimate:

| Saved situation | Percentage actually displayed, as pass probability | Frozen current baseline | Candidate | Recorded outcome |
|---|---:|---:|---:|---|
| First-and-10 at own 28, 8:45 | 45% | 45.3% | 23.9% | Pass |
| Second-and-3 at own 35, 8:38 | 34% | 34.5% | 15.0% | Rush |
| First-and-10 at own 44, 8:08 | 48% | 48.0% | 25.0% | Pass |

These are diagnostic examples, not a performance estimate. The more contextual model was less confident in the two passes that actually occurred. That is not enough to reject or validate it, but it is a useful reminder that a sensible adjustment does not predict every play. The saved displayed value can differ from the frozen baseline because of rounding or an older artifact. The audit keeps those values separate.

Nineteen eligible moments have a later reported clock, score or period value different from the saved input. Much of that can be ordinary clock movement between plays. The audit retains both contexts without changing the prediction input or declaring each difference a bug. Later source data cannot repair what the app knew at the time.

The frozen 2026 NFL candidate uses 276,440 qualifying training plays through 2025; college uses 360,260. Shrinkage and sigmoid calibration are retained from the earlier fixed procedure. No 2026 outcome enters fitting, and the candidate bytes are identical before and after the development replay. Python and the browser reader agree within 2.23×10⁻¹⁶ across 274,615 distinct NFL and 358,590 college training situations. This proves calculation parity, not forecast performance. The frozen baseline reader also matches the Python reference across all situation buckets tested in both leagues.

There is no NFL live-journal evaluation yet. Its future labels need an exact-game source join; the college adapter is not reused as an NFL mapping. Before an aggregate prospective readout, the declared minimum is 2,000 eligible plays across 20 games per league. No aggregate error or accuracy is presented for this development sample. Usefulness ratings and practice answers remain separate from forecast error.

Validation: 217 JavaScript and 36 Python tests pass. New cases cover future-label/context changes leaving forecasts unchanged, pre-arrival linking, released basis evidence, conflicting links, latest-input selection, hidden percentages, quiz voids, team/position mismatches, future training rejection and baseline parity. No browser or production change is part of this checkpoint.

```sh
# A freeze directory is immutable; choose a new path when creating a new freeze.
.venv/bin/python engine/freeze_context_candidate.py --out data/forecast-freeze-new

# Use the existing freeze for replay. This does not fit or change either model.
.venv/bin/python engine/replay_forecasts.py \
  --freeze data/forecast-freeze-2026-09-06-v1 \
  --out data/journals/forecast-replay.json \
  data/journals/football-journal-cfb-401856668.json \
  data/journals/football-journal-cfb-401858437.json
```
