# Coaching history and deeper context: completed offline pilot

September 5, 2026. **Score and time were much more useful than adding coaching history in this test.** A longer history following one verified play caller to his new team produced a small improvement, but the uncertainty still includes no improvement. These are research results; production probabilities have not changed.

## What ran

The reproducible experiment is [coaching_pilot.py](../engine/coaching_pilot.py), with machine-readable results in [coaching-pilot-audit.json](coaching-pilot-audit.json). It downloaded five additional NFL seasons into the private raw cache and combined **2018–2025: 361,470 conformed play records, 276,440 eligible run/pass plays, 2,227 games**. No eligible record lacked the context fields used here, and eligible play identities were unique. Source file hashes are retained in the audit. This does not alter the app's historical tables.

Each of the **2023, 2024 and 2025** seasons was held out in turn. Model settings were chosen using only the previous season, with earlier seasons as training, then refitted on everything before the test year. The 104,878 test plays never selected their own settings. Those earlier test years become historical training for subsequent folds, as they would in a yearly update.

The current production estimator was called directly on both the previous three seasons and all available previous seasons. Separate context models added score bands and clock phases to the same down/distance/field buckets. The NFL data dictionary defines the [score differential and time as pre-play fields](https://nflfastr.com/reference/fast_scraper.html); final scores, play descriptions, yardage, EPA and the result were not predictor inputs.

Team and caller adjustments use the historical difference between observed passing and the contextual expectation, grouped by down and distance. Thin evidence is pulled toward no adjustment. The adjustment strength was selected on **all NFL team histories in the earlier validation year**, then applied equally to team, current-tenure and coach-career versions. It was not tuned on Denver's held-out results. A fixed two-season recency half-life was used for these experimental models; it was not optimized on the test years.

## What changed accuracy

Lower Brier means better probability forecasts. Accuracy is the fraction of recorded pass/run outcomes correctly classified at a 50% cutoff; it is not a measure of recognizing a play's design.

| Model, same 104,878 held-out plays | Brier | Run/pass accuracy |
|---|---:|---:|
| Current estimator, previous three seasons | 0.21962 | 62.13% |
| Current estimator, all earlier seasons | 0.21983 | 62.03% |
| Matched situation-only control | 0.21960 | 62.03% |
| Situation plus score and clock | 0.20298 | 66.96% |
| Situation, score, clock and team adjustment | 0.20264 | 67.10% |

The matched control uses the experimental estimator's same data window, recency weights and independently tuned shrinkage, but removes score/time. Its comparison with the context model is **−0.01662 Brier, 95% team-clustered paired bootstrap interval [−0.01766, −0.01560]**. This supports a score/time effect rather than attributing the gain to a different window or estimator. Improvement appeared in all three held-out seasons. Merely adding older seasons to the current estimator was slightly worse: +0.00021 Brier, interval [+0.00010, +0.00031]. More data is useful for testing richer questions, not automatically a better input to the same model.

There is a tradeoff: pooled calibration error was **0.01053** for the current estimator and **0.01244** for context plus team. The new model improves Brier and classification, but this ten-bin calibration measure is slightly worse. It needs calibration review and a separate live-data evaluation before production use. These historical percentages are not claims about the site's live performance.

## What coaching history means here

The pilot follows **Sean Payton's reported primary offensive play-calling role from New Orleans (2018–2021) to Denver (2023–2025)**. It distinguishes head coach, offensive coordinator and play caller. The dated [source manifest](../engine/coaching_pilot_sources.json) contains official team sources, role boundaries, exceptions and limitations. This is a pilot with one transferring caller, not a complete staff database.

The [Saints' own pregame transcript](https://www.neworleanssaints.com/news/saints-transcripts-dennis-allen-media-availability-friday-december-17) identifies Pete Carmichael as caller for the December 19, 2021 Tampa Bay game while Payton was absent. Its **60 eligible New Orleans plays** remain in league/team training but are excluded from Payton's history. Unmapped teams/seasons stay unknown; they never inherit a caller from the head coach field.

The first Denver test season had **4,290 earlier Payton plays across New Orleans but zero under his Denver tenure**. This directly tests the career-transfer idea the old team/head-coach-tenure study could not test. Subsequent years test whether that older coaching history helps once the current tenure also has data.

| Denver only, 3,271 held-out plays in 54 games | Brier | Difference from team model |
|---|---:|---:|
| Score/time context plus team history | 0.20542 | reference |
| Replace team with current Payton-at-Denver tenure | 0.20541 | −0.00001 |
| Replace team with Payton's career across both teams | 0.20504 | −0.00038 |
| Fixed 50/50 team and career blend | 0.20513 | −0.00029 |

Career versus team has a **game-clustered paired interval [−0.00097, +0.00023]**. Current tenure and the blend also have intervals including zero. The career estimate was marginally better in each test year, but the total evidence is not strong enough to conclude transfer improves forecasting. A benefit remains plausible; it is not established. These intervals concern the sampled Denver games, not a population of different coaches.

A practical example of why accurate roles matter: [Denver announced Davis Webb would call plays in 2026](https://www.denverbroncos.com/news/i-wouldn-t-do-it-if-i-didn-t-think-it-was-going-to-help-our-team-win-hc-sean-payton-announces-oc-davis-webb-to-call-plays-for-broncos-offense), while Payton remains head coach. The manifest records that boundary and tests it; no 2026 game outcomes enter this study. Extending Payton's caller label just because he still coaches the team would be incorrect.

## Limits and decision

The caller assignments establish the reported primary role, not who called every individual snap. Retrospective official sources can confirm those roles, but this is not a staff database archived before every historical game. One known temporary exception is handled; unreported delegation may remain.

This is not a causal coaching analysis. The team, quarterbacks, supporting players and opponents changed. The current-team and current-tenure controls are useful comparisons, but they do not isolate those factors. It also does not infer motion, formation, routes or defensive coverage. Quarterback scrambles remain runs under the app's existing recorded-play target; this is not an estimate of intended play calls.

The data is finalized play-by-play. A field that is correct after the game might have been absent, late or incorrect live. Compare archived live inputs and displayed outputs with final records before trusting an offline gain in the live product. Multiple comparisons, including the fixed transfer blend, are reported without a multiple-testing correction; the coach result should stay exploratory.

**Next implementation priority:** test score/time context against the newly captured live records and review calibration. Expand the verified caller sample to several actual transitions before changing probabilities on coaching evidence. Keep the coaching history useful as sourced educational context in the meantime, with basic definitions on request rather than making every lesson a run/pass guess.

## Reproduce

```sh
.venv/bin/python engine/coaching_pilot.py
.venv/bin/python -m unittest discover -s tests -p 'test_coaching_pilot.py' -v
```

The first command downloads missing public raw seasons through the existing ingester, caches a separate conformed dataset, and saves per-play predictions under ignored `data/coaching-pilot/`. It regenerates the public audit JSON but does not write `web/tendency-*.json`. Six regression tests verify chronology, immunity to changed future outcomes, unknown context, source references, new-tenure fallbacks, paired game resampling and the Payton-to-Webb role boundary.
