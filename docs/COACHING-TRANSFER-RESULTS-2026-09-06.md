# Coaching history: expanded results

Adding a caller’s earlier teams did **not establish a reliable forecasting improvement** over the current team’s history. This extends the Payton pilot to Kellen Moore and Arthur Smith: 9,977 held-out plays across 158 games, six transfer stints, and five first seasons at a new team within the 2023–2025 test window. All reported pooled and per-caller career-versus-team intervals include zero. Production probability tables are unchanged.

The [fixed protocol](COACHING-TRANSFER-PROTOCOL-2026-09-06.md), [source catalog](../engine/coaching-expanded-sources.json), [reproducible evaluator](../engine/coaching_transfer.py) and [full audit](coaching-expanded-audit.json) preserve the design and evidence. The original one-caller study remains separate.

| Comparison on the same 9,977 plays | Brier error (lower is better) | Run/pass classification | Calibration error (10 bins) |
|---|---:|---:|---:|
| Context + team history | 0.203262 | 67.04% | 0.0191 |
| Context + current caller/team stint | 0.203457 | 66.89% | 0.0133 |
| Context + caller career | 0.203317 | 67.19% | 0.0102 |
| Fixed 50/50 team/career blend | 0.202977 | 67.08% | 0.0131 |

Career minus team Brier difference is +0.000056; the paired game-clustered 95% interval is [−0.000647, +0.000772]. The blend is −0.000284 with interval [−0.000637, +0.000084]. Those tiny differences do not establish benefit. The lower retrospective calibration error is worth investigating, but it does not by itself validate a new live estimator.

For the 5,593 plays in 87 games from the first season at a new team, career versus team is −0.000208, interval [−0.001270, +0.000848]. Starting with no current-tenure observations therefore did not produce a reliably demonstrated transfer gain either.

| Caller, all evaluated transfer stints | Plays | Games | Career minus team Brier | 95% interval |
|---|---:|---:|---:|---|
| Arthur Smith | 3,216 | 53 | -0.000096 | [-0.001854, +0.001697] |
| Kellen Moore | 3,490 | 55 | +0.000601 | [-0.000525, +0.001686] |
| Sean Payton | 3,271 | 54 | -0.000377 | [-0.000973, +0.000228] |

These intervals concern the sampled games. Three callers do not establish coach-to-coach generalization. Some games involve two covered offenses, so per-caller game counts do not sum to the unique-game total. Multiple comparisons are exploratory, and these years have already been used in earlier research.

Roles and personnel matter. [Dallas retained Moore as caller when McCarthy arrived](https://www.dallascowboys.com/news/mccarthy-expects-that-moore-will-call-plays), while [the Eagles explicitly credited him as caller during his 2024 season](https://www.philadelphiaeagles.com/news/kellen-moore-named-new-orleans-saints-head-coach). [New Orleans announced he would call plays as head coach](https://www.neworleanssaints.com/news/kellen-moore-prepared-to-call-shots-for-new-orleans-saints-as-19th-coach-in-franchise-history). The [Steelers’ retrospective establishes Smith’s Tennessee/Atlanta calling history](https://www.steelers.com/news/what-does-arthur-smith-bring-to-the-steelers-offense), with separate game reporting supporting his Pittsburgh role. These are reported primary roles, not proof of who called every snap.

The raw-data joins also make personnel changes visible: Moore’s covered stints include Herbert/Stick in Los Angeles, Hurts in Philadelphia, and Shough/Rattler in New Orleans. Pittsburgh’s most frequent named passers change from Wilson/Fields in 2024 to Rodgers/Rudolph in 2025. The audit lists exact IDs and counts. These are named-passing-play records, not verified starts, and are not causal controls. No claim that the coach caused the difference is supported.

The product decision is to keep score/clock and observed game patterns ahead of coaching-based forecasts. Coaching history can provide dated descriptive context where the actual caller is verified, but this study does not justify changing live probabilities. College transfer remains a separate question; NFL findings cannot be assumed to apply. More useful next work is verified examples and testing whether viewers recognize an idea on a different play.

Validation: 30 Python tests cover chronology, immunity to changed held-out outcomes, source references, role boundaries and transfer identification. Raw named-passers joins verify game/play IDs, offense and regular/postseason type. The successful run retains input and catalog hashes and per-play predictions. No paid source was used.

```sh
.venv/bin/python engine/coaching_transfer.py
.venv/bin/python -m unittest discover -s tests -p 'test_coaching_transfer.py' -v
```
