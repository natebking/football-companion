# Regime enrichment: findings

Run 2026-08-29. Question: does keying tendencies on coaching regime (coordinator or head coach) beat plain team keying?

**Answer: no.** The mechanism is real and dose-dependent, but a single global shrinkage constant captures ~97% of what a perfect regime table would buy, at 1/35th the Brier gain for permanent annual maintenance. Skip the coordinator table.

## Verdict

The harness blocks subagents from writing report files, so `FINDINGS.md` was not created. Full content follows as my return value.

---

# Coaching-regime enrichment: build decision

Reviewer verdict on the four experiments in `/Users/nking/Documents/football-companion/engine/regime/`. All four were re-run from scratch and reproduce their reported numbers **exactly**. Two methodology errors found, one missing control run; neither changes the direction of the answer. (Intended path: `/Users/nking/Documents/football-companion/engine/regime/FINDINGS.md` — blocked, paste this in.)

Reproduction: `magnitude.py` 5.5s, `test_coach_keying.py` 8.8s, `test_recency.py` 12.0s, `test_changepoint.py` 14.7s. Zero new API calls.

## 1. Verdict

**No. Do not build coordinator keying.** The regime effect the design doc describes is real and correctly signed, but roughly a tenth the size the doc assumes, and the engine's existing machinery already absorbs the reachable part. The best case for a perfect regime table, fitted in-sample on the data it is scored on, is **-0.00017 Brier (-0.07%)** on held-out 2025. Every shippable version measured worse than doing nothing: variant C (regime block with team fallback, the one you would actually ship) returns the status quo's exact prediction on all 30,313 plays for teams that changed staff, because a brand-new regime has no training rows to clear the sample floor, and it is *significantly worse* overall (+0.00051 Brier, 95% CI [+0.00024, +0.00084]). The premise fails not because coaching changes do not matter, but because the team number is over-trusted for **everyone**: `skill_vs_situation` is negative in every group measured, stable staffs included. The binding constraint is how much weight the team's history gets, not whose history it is. Shrinking that weight globally, zero maintenance and no coaching data, is worth **-0.00621 Brier out of sample, 36x the coordinator table's in-sample ceiling**. Do that instead.

## 2. Decisive numbers

Held-out 2025, trained 2023-2024, 122,416 CFB plays. "Fitted" rows use parameters from the 2024 holdout, never 2025.

| policy | Brier | vs shipped | maintenance |
|---|---|---|---|
| league average only (floor) | 0.24997 | +0.01660 | none |
| **engine as shipped** | **0.23337** | **0.00000** | none |
| half-life 1 → 3 | 0.23322 | -0.00016 | one character |
| rung 4 demoted below rung 5 | 0.23035 | -0.00303 | none, no parameter |
| situation baseline, no team at all | 0.22880 | -0.00457 | none |
| n/(n+200) shrink | 0.22812 | -0.00526 | one constant |
| global team-weight shrink w=0.31 | 0.22749 | -0.00589 | one constant |
| **per-rung shrink 0.37/0.39/0.27/0.06/0.00** | **0.22716** | **-0.00621** | five constants |

Everything the four regime experiments produced, on that same scale:

| regime intervention | result | verdict |
|---|---|---|
| perfect regime-aware shrink weight, in-sample ceiling | -0.00017 | 36x smaller than the per-rung shrink |
| same, honest out-of-sample (fitted 2024) | -0.00016 | noise |
| regime-keyed tables, pre-regime discarded (B) | -0.00181 | fake: matched by a regime-free placebo |
| **regime + team fallback (C), the shippable one** | **+0.00051** | significantly worse, CI excludes 0 |
| regime per rung, else team (C2) | +0.00039 | significantly worse, CI excludes 0 |
| truncate history at a detected changepoint | +0.00034 | worse than doing nothing |
| regime-aware half-life (hl 3 changed / 1.5 stable) | -0.00001 | nothing |

Four independent ways the hypothesis fails on its own terms:

1. **Variant C is a no-op where it matters.** 37 teams changed head coach for 2025. A regime table has zero rows for them, so the fallback fires on 100% of their 30,313 plays and returns the status quo number byte for byte. The design that keeps a number on the card delivers nothing to the group it exists for.
2. **B's apparent win is sample size.** B beats the status quo by -0.00181, but a placebo that keeps team keying and randomly downsamples each team to B's exact row count, carrying no regime information, beats B (0.23149 vs 0.23156 after the §3 correction). On changed-for-2025 the placebo reproduces B to five decimals (0.22939 vs 0.22939): both hand those plays to the league baseline. B - D is not significant in either changed group.
3. **The recency knob wants the opposite direction.** Optimal half-life is 3 seasons, not the contract's 1, and that holds *for coach-change teams too* (their optimum is 3; stable teams want 2). In the one group where forgetting should win by construction (2023 under a dead staff, 2024 current), forgetting 2023 **costs 0.00347**, the same penalty stable teams pay (+0.00328). Decay is variance reduction, not staleness removal.
4. **The best shrink weight does not move when you forget the stale season.** 0.32 at half-life 1, 0.32 at half-life 3. If decay had removed stale data, trust in the team number would have risen.

What is real, stated fairly: 24-26% of FBS schools change head coach per offseason, touching 19.6% of 2025 snaps. Season-over-season shift is higher after a change (median 0.1156 vs 0.1023 pass-rate points, Cliff's delta +0.21, p=0.014), but 0.0850 of the stable-staff 0.1023 is pure sampling noise, and stable staffs routinely out-shift coach changes: New Mexico State, Boston College, Washington State, Vanderbilt and Colorado all moved more under an unchanged head coach than 59 of the 61 coaching changes did. Alabama's Saban-to-DeBoer moved 0.0764, **below Alabama's own 0.0792 noise floor**. The cleanest isolation of the true effect is `test_coach_keying.py` §6's difference in differences, holding sample size and plain recency fixed: **-0.00104 Brier**. Real, correctly signed, smaller than the +0.00115 it costs in sample size to act on it.

## 3. Audit of the four scripts

**Leakage: clean.** All four hold out 2025 and build tables on the training frame only, so rung 4 ("all seasons") also sees training seasons only. `magnitude.py`'s OOS weights are fitted on the 2024 holdout. `test_recency.py` §6 fits half-lives on 2025 weeks 1-7 and scores weeks 8-16, with tables that never see 2025, correctly labelling why the season-level fit is degenerate. Using 2025 coach identity to label 2025 is not leakage: staffs are known before kickoff. One minor exception: `test_changepoint.main()` computes the residual's league baseline over all three seasons, so the 60-changepoint yield and 16.7% precision are in-sample statistics. The decisive §7 test correctly recomputes on training data alone.

**Error 1, real: the changepoint detector's headline lift does not survive a correct null.** `chance_precision` averages the per-team random-split hit rate over all 134 tested teams unweighted, including the 76 with no coach change to hit (rate 0). But precision is computed over 60 detections on 50 teams, and **54.0% of firing teams had a coach change against 43.3% of teams tested**, so the detector's selection is in the numerator but not the denominator.

| baseline | chance | lift | one-sided p |
|---|---|---|---|
| as written (all 134 tested teams) | 8.56% | 1.95x | 0.0304 |
| the 50 teams that fired | 10.70% | 1.56x | 0.1034 |
| per detection (a 3-detection team gets 3 votes) | 11.11% | 1.50x | 0.1246 |

"Detector leans toward coach boundaries, p=0.030" does not hold. The detector's alignment with coach changes is not distinguishable from a same-sized random detector. This makes the changepoint verdict **more** negative. Everything else there stands: sound self-check, good null calibration (7.5% vs nominal 5%), and the changepoints are genuine persistent level shifts (mean |delta| 0.12 vs 0.048 at a random split, level holds past 8 games). They are just not coaching.

**Error 2, cosmetic: the placebo is not rebased to a shared league table.** `test_changepoint.py` correctly pins every policy to one `league_exact` via `_rebase`. `test_coach_keying.py` does not do this for placebo D, whose tables come from a ~57% downsample, so D's rung-5 predictions and `base_situation` are estimated from less data than A's and B's. Correcting it improves D by 0.00003-0.00004 across all three seeds, so **D - B goes from -0.00004 to -0.00007**. The flaw ran against the reported conclusion; fixing it strengthens it.

**Missing control, which I ran: about half the dose-response is a volatility confound.** `magnitude.py` §5c is the strongest surviving pro-regime evidence (optimal team weight falling 0.44 → 0.21 → 0.07 with staleness). Its docstring names the worry (coach changes cluster at unstable programs) and answers it with the staleness ladder, but the ladder cannot separate "this data is stale" from "this program was always erratic" because the same teams carry both labels. The missing control is a **pre-change placebo**: score the 2024 holdout, split by whether the team would change coach a year *later*, when nothing is stale yet.

| test | teams | plays | best team weight |
|---|---|---|---|
| 2024 holdout, teams that would change for 2025 (nothing stale yet) | 25 | 20,368 | **0.22** |
| 2024 holdout, teams that would not change | 76 | 65,271 | **0.40** |
| 2025 holdout, same changers, now genuinely stale | 29 | 24,049 | 0.07 |
| 2025 holdout, same non-changers | 76 | 64,257 | 0.44 |

The gap is already -0.18 **before any staleness exists**, against -0.37 after. Roughly half the dose-response is program volatility. The staleness-attributable half is consistent with the DiD's -0.00104. Coach identity is partly a proxy for "chaotic program", which a coordinator table cannot capture and a global shrink handles for free.

**Diluted-variance check: this one is done right.** Variant C differs from the status quo on only 24,154 of 122,416 plays (19.7%), being identical by construction on the 30,313 changed-for-2025, 60,481 continuous-staff and 7,468 unmatched plays. The overall +0.00051 is exact arithmetic on the concentrated +0.00256 (24,154/122,416 × 0.00256 = 0.00051), not diluted noise, and the paired team-clustered bootstrap is correct for it: teams whose difference is identically zero contribute zero variance rather than washing the signal out. C2's rung distribution matching the status quo's is the point of that control, not a defect.

**Not measured by any of the four, and it matters: the NFL.** All four are CFB-only, correctly (CFBD `/coaches` is college; the NFL parquet is one season so decay is literally unreachable, 13 settings producing 1 distinct Brier, spread 0.0000000000). But the recommended fix is league-agnostic and `backtest.py` already runs the cross-league transfer. NFL's own best weight is 0.50 against CFB's 0.32. Applying CFB's 0.32 to the NFL costs 0.00029 against the NFL's optimum; applying NFL's 0.50 to CFB costs 0.00041. Both still beat the shipped engine by 10-20x that. **The shrink transfers. Fit it per league anyway, it is free.**

## 4. Recommendations, ranked

### Do now

1. **Demote rung 4 below rung 5.** Rung 4 (team, down only, all seasons, unweighted) is the worst thing in the engine: `skill_vs_situation` **-0.2561** on 7,577 CFB held-out plays, Brier 0.2395 against the situation baseline's 0.1907. Also bad in the NFL (-0.0700). When the league's exact bucket clears the sample floor, the league number beats the team's down-only number by a mile. `backtest.py` already computes this variant (`pred_demoted`) and it buys **-0.00303 Brier with zero fitted parameters**. Effort: one condition in `tendency.query`, 10 minutes. Highest value per line of code in the review.
2. **Shrink the team number toward the league situation rate, per rung.** Weights fitted on the 2024 holdout are 0.37 / 0.39 / 0.27 / 0.06 / 0.00 by rung; applied unchanged to 2025 they buy **-0.00621**, beating a single global w=0.31 (-0.00589). Fit separately for CFB and NFL. Effort: ~30 min in `tendency.query` (it already has `league_pass_rate` in hand) plus regenerating the shipped JSON. **Budget 1-2 hours beyond that** to re-tune `web/cards.json`: the `applies.min_pass_rate` gates were written against unshrunk numbers, and a stated 78% becomes roughly 62%, so cards will stop firing where they used to. That re-tune is the real cost, not the engine change.
3. **Change the contract's half-life from 1.0 to 2.0.** Better Brier (0.23337 → 0.23322), better ECE (0.02784 → 0.02633), better accuracy, confirmed independently by three of the four scripts. Effort: one character plus a rebuild, 5 minutes. A rounding error next to items 1 and 2, so ship it in the same commit and spend no thought on it.

### Defer

4. **Confidence downgrade for new staffs, not a number change.** The one honest route back to the design doc, and a product call the Brier scores cannot make. Card-copy error for new-head-coach teams is 0.1253 mean absolute against 0.1087 for stable staffs, and **19.4% of their plays state a number off by more than 20 points, against 13.7%**. If "never assert a stale number about a new staff" is a trust requirement rather than an accuracy one, drop those 19.6% of snaps one confidence level so the copy softens, without touching the number. Cost: 3 cached API calls a year and a ~40-row list, not a coordinator table. Effort: 2 hours. Decide on product grounds; the accuracy grounds say it buys nothing.
5. **Revisit after two more CFB seasons.** See §5.

### Drop entirely

6. **The coordinator table.** Ceiling -0.00017 in-sample, -0.00016 honest, for permanent annual maintenance across ~135 schools with no clean data source and in-season churn the public record misses. Head coach undercounts coordinator churn, so a real coordinator table is strictly more work for a signal already inside the measurement error of the thing it would replace.
7. **Changepoint truncation.** Hurts (+0.00034 overall, +0.00167 restricted to the 24,868 plays it touches, which rules out dilution as the excuse). Beats a random cut of the same size by only -0.00018, inside the control's own spread. Most of what it does is "drop 9.7% of your data". Also costs rung-1 reach, 69.2% → 65.0%.
8. **Shortening the half-life as a regime proxy.** Wrong direction at every setting tested, in every group including brand-new staffs.

Keep the four scripts. They are the evidence for a decision that will get re-litigated, they run in under 15 seconds each, and `magnitude.py` holds the `/coaches` cache.

## 5. What would change this verdict

1. **A regime with training data on both sides of the change.** Every negative traces to one structural fact: with a two-season window, a team that changed staff for the held-out season has *zero* rows under its current regime, so regime keying degenerates into the league baseline. Six or more CFB seasons would let a second-year regime carry a full season of its own history while the prior staff's is still available to discard. That is when variant C stops being a no-op on the group it exists for, and it is the condition most likely to flip the answer. Re-run `test_coach_keying.py` unchanged then; it is already written to answer this.
2. **A coordinator source with in-season resolution.** Head coach is a strict under-count: it misses coordinator churn under a stable head coach, and 50% of detected changepoints are mid-season where no season-keyed table could put one. For a coordinator label to clear the per-rung shrink's -0.00621, the true regime effect would need to exceed the head-coach proxy by roughly 6x (the DiD bounds the plausible at -0.00104). Nothing here rules that out, and nothing supports it.
3. **Within-season recency becoming reachable.** Everything measured is season decay. Week-level decay is a different mechanism, untestable on one NFL season, and it is where a genuine mid-season regime shift would show up. If the app ships live in-season table updates, re-open this with a week-decay sweep, not a coordinator table.
4. **A different loss function.** The verdict is Brier and ECE on pass rate. If the product metric becomes "share of cards off by more than 20 points", the new-staff 19.4% against 13.7% is a 42% relative gap that Brier's -0.00017 ceiling does not capture. That justifies recommendation 4, not a coordinator table.
5. **A real NFL panel.** Three or more NFL seasons would make the decay parameter reachable and let the whole battery run on a league with 32 teams, far more plays per team, and public coordinator records that are actually maintained. If regime keying works anywhere, it works there first.

## 6. Caveats

**The base is thin, and that is the biggest limit on everything above.** Three CFB seasons (2023-2025), two training and one holdout. Consequences, cutting against confidence in the negative result as much as the positive:

- The half-life grid is not a grid. With a two-season window, `0.5**((max_season - season)/half_life)` collapses to one number, the weight on 2023 relative to 2024. The 13-setting sweep is a one-parameter line from r=0 to r=1, and nothing here speaks to windows of four or more seasons.
- One holdout season is one draw. Every headline number rests on 2025. The 2024 holdout was used to fit parameters honestly but is a weaker test (one-season training window), so there is no second independent confirmation of any effect's magnitude, only of its sign.
- Regime keying is judged in the regime where it is structurally worst: no current-regime training data for 24.8% of the league. That is a fair description of what shipping it *today* would do and an unfair description of the idea in general. §5 item 1 is the honest caveat.
- 61 offseason coach changes and 267 usable team-season pairs is small for effect-size work. Cliff's delta +0.21 at p=0.014 is genuine but fragile, and negligible-to-small by conventional thresholds.

**Head coach proxies coordinator.** It undercounts churn in both directions and is the only clean source that exists (CFBD has no coordinator endpoint, verified). Every magnitude here is an upper bound on what a *head-coach*-keyed table could recover and a lower bound on total regime churn.

**NFL is one season and cannot test any of this.** Season decay is unreachable (13 settings, 1 distinct Brier, spread 0.0000000000). No coach transition to observe. Its only role here, which it does well, is confirming the recommended shrink transfers across leagues.

**Smaller ones.** Tenure starts are left-censored at 2023 (harmless, training starts there). The 9 in-season 2025 takeovers sit inside the changed-for-2025 group whose held-out season is itself a regime mix, and the 6 in-season takeovers were split out of the shift comparison rather than forced into either side. `magnitude.py` §5c's "no change since 2023" group quietly includes in-season takeovers, making its contrast conservative. `magnitude.py` §6's in-sample row is a ceiling by construction and is labelled as one. The persistence table's `retained` column is truncated by the end of 2025 for late changepoints. The placebo is averaged over three seeds (sd 0.00005).
## Magnitude

`/Users/nking/Documents/football-companion/engine/regime/magnitude.py` — runs in 5s, 3 API calls (cached to `data/raw/coaches_{2023,2024,2025}.json`). Imports `tendency`, `buckets`, `backtest`, `schema`, `ingest_cfb`. No existing file touched, no commit.

**VERDICT: real, directional, dose-dependent, and not worth building. Skip the coordinator table.**

## 1. Turnover (CFBD `/coaches`, head coaches only)

```
 offseason  schools  changed  rate    offseason_hire  in_season_takeover
2023->2024      133       32  24.1%               32                   0
2024->2025      134       35  26.1%               29                   6
```
Schools in `/coaches` with no plays under that name: **0** (CFBD naming matches the parquet exactly).
2025 exposure: **24,049 / 122,416 eligible bucketable snaps = 19.6%** (21.2% of FBS-matched offenses).

## 2. Season-over-season tendency shift
Sample-weighted mean TV distance across shared buckets (= weighted mean |Δpass_rate|, weight `min(n_prev, n_cur)`, buckets need n≥10 both seasons, pair weight ≥100). 267 usable team-season pairs.

```
                          group    n      q1  median    mean      q3     max      sd
     new coach (offseason hire)   61  0.0873  0.1156  0.1187  0.1360  0.3199  0.0439
                     same coach  200  0.0868  0.1023  0.1041  0.1168  0.1960  0.0259
             in-season takeover    6  0.0799  0.0918  0.0914  0.0959  0.1190  0.0166
                      ALL pairs  267  0.0870  0.1038  0.1071  0.1208  0.3199  0.0314
  sampling-noise floor (new hc)   61  0.0830  0.0867  0.0856  0.0882  0.0912  0.0033
    sampling-noise floor (same)  200  0.0834  0.0853  0.0850  0.0875  0.0937  0.0045
```

The noise floor is each pair redrawn binomially from its own pooled per-bucket rate at the observed n. **0.0850 of the 0.1023 same-coach shift is pure sampling noise.**

## 3. Effect size, new coach vs same coach

```
median          0.1156 vs 0.1023   (+0.0133 pass-rate points, +13.0% relative)
mean            0.1187 vs 0.1041   (+0.0146)
Cliff's delta   +0.2082            (negligible-to-small)
Cohen's d       +0.4720
Mann-Whitney U  7370, two-sided p = 0.0139
noise floor     0.0856 vs 0.0850
drift above noise  0.0823 vs 0.0601 -> regime-attributable part 0.0222
```

Stable across the bucket floor (min_n 5/10/20/30 → gap 0.0135/0.0133/0.0158/0.0139, p 0.003–0.022).

Context that kills the strong version of the claim: **stable staffs routinely out-shift coach changes.** Top stable-staff shifts — New Mexico State 2025 (Sanchez→Sanchez) 0.1960, Boston College 2025 (O'Brien→O'Brien) 0.1959, Wash St 2024 (Dickert→Dickert) 0.1685, Vanderbilt 2025 (Lea→Lea) 0.1679, Colorado 2025 (Sanders→Sanders) 0.1612 — all exceed 59 of the 61 coach changes. Meanwhile **Alabama 2024, Saban→DeBoer, shifted 0.0764, below its own 0.0792 noise floor.** Head-coach identity is a weak predictor of which team's numbers went stale.

## 4. The decisive test: held-out 2025, trained 2023-2024

```
5. group             teams  plays   share  brier_eng  brier_sit  skill    best_team_w  brier_at_best
   new coach            29  24049  19.6%    0.23862    0.22923  -4.10%          0.07       0.22918
   same coach           99  84635  69.1%    0.23113    0.22841  -1.19%          0.40       0.22637
   in-season takeover    6   4504   3.7%    0.23744    0.23041  -3.05%          0.12       0.23028

5b. rung 1 only (team, exact bucket)
   new coach            29  17506           0.24361    0.23718  -2.71%          0.07       0.23714
   same coach           99  63190           0.23571    0.23624  +0.23%          0.53       0.23353

5c. confound control, by how much of the training window predates the staff
   both train seasons stale   29  24049      0.23862    0.22923  -4.10%         0.07       0.22918
   2023 stale, 2024 current   29  24882      0.23471    0.22882  -2.57%         0.21       0.22834
   no change since 2023       76  64257      0.23018    0.22839  -0.78%         0.44       0.22577
```

5c is the strongest evidence Nathan is right about the *mechanism*: the optimal weight on the team's own number falls monotonically **0.44 → 0.21 → 0.07** as more of the training window predates the current staff. That is a clean dose-response, not a volatility artifact, and it replicates out of sample (weights fitted on the 2024 holdout: 0.36 same / 0.09 changed).

## 5. What the table would actually buy

```
policy                                                    brier   vs best regime-blind
engine as shipped (team weight 1.00)                     0.23337        +0.00589
situation baseline, no team at all (0.00)                0.22880        +0.00132
one global weight, fitted in-sample w=0.32               0.22748         0.00000
regime-aware weights, in-sample ch=0.07 same=0.37        0.22732        -0.00017
one global weight, fitted on 2024 w=0.31                 0.22749         0.00000
regime-aware, fitted on 2024 ch=0.09 same=0.36           0.22732        -0.00016
```

- In-sample **ceiling** on regime keying: **-0.00017 Brier (-0.07%)**.
- Honest out-of-sample: **-0.00016 (-0.07%)**.
- Even restricted to the 24,049 plays it would touch: 0.22988 → 0.22918, **-0.00070 (-0.30%)**.
- Accuracy: shipped 0.6013, global shrink 0.6149, regime-aware 0.6147 (regime keying is *worse* on accuracy).
- The regime-blind global shrink to w≈0.32 is worth **+0.00589**, i.e. **35x more than regime keying**, and costs one constant.

User-visible error, |stated pass rate − what that team actually did in that bucket in 2025|:
```
group        plays  mean_abs_err  median  share off by >20pts
new coach    24049        0.1253  0.0962              19.4%
same coach   84635        0.1087  0.0816              13.7%
```
1.7 percentage points of extra card-copy error, on 1 play in 5.

## 6. Plain answer

The regime effect is **small and mostly indistinguishable from noise on the shift metric** (Cliff's δ 0.21, gap 1.3 pass-rate points against a 8.5-point sampling floor), but **real and dose-dependent on the predictive test** (0.44/0.21/0.07 blend weights, replicated across two independent seasons). Nathan's mechanism is right; his magnitude is wrong.

It is not worth building because a global shrink already absorbs it. The team number is over-trusted for *everyone* — `skill_vs_situation` is negative in every group, including stable staffs — so shrinking it globally to w≈0.32 captures 97% of what a perfect regime table would give you. A hand-maintained coordinator table would buy 0.07% Brier for permanent annual maintenance on ~135 schools, and head coach undercounts coordinator churn, so a real coordinator table would be more work for a signal already inside the measurement error of the thing it replaces.

Caveats worth stating: three CFB seasons only; head coach proxies coordinator; 6 in-season takeovers were split out rather than forced into either group; the weights in section 6 are fitted on aggregate held-out data, and the in-sample row is a ceiling by construction.

Next action: tell the engine owner to add one global team-weight constant (w≈0.32, or the `n/(n+k)` variant `backtest.best_k` already fits) and close the regime question.

## Method 1

`/Users/nking/Documents/football-companion/engine/regime/test_recency.py` — 12s, 0 API calls (coach JSON already cached by `magnitude.py`). Imports `tendency`, `buckets`, `backtest`, `schema`, `magnitude`. No existing file touched, no commit.

**VERDICT: no. The existing knob cannot absorb regime change, and it is already set too short. Optimum is half-life 3, not 1 — the engine should forget SLOWER, and that is true for coach-change teams too.**

## 1. What the knob actually is

CFB train window = 2023+2024, so `half_life` collapses to one number: `r = 0.5**(1/hl)`, the weight on 2023 relative to 2024. Contract's `hl=1.0` → r=0.50. Sweep spans r=0 to r=1. Decay never touches `sample_size`, so **rung-1 reach is 0.69207 at every decay setting** (1 distinct value) — decay moves rates, never the ladder.

## 2. Sweep, held-out 2025 (122,416 plays, identical row set every setting, 0 dropped)

```
              setting  r_2023  plays_in_window    brier      ece  accuracy  rung1_reach  best_shrink_w
       half_life 0.05  0.0000           238176  0.23656  0.04308   0.59514      0.69207           0.27
      half_life 0.125  0.0039           238176  0.23650  0.04230   0.59665      0.69207           0.27
       half_life 0.25  0.0625           238176  0.23567  0.03961   0.59696      0.69207           0.28
        half_life 0.5  0.2500           238176  0.23413  0.03240   0.59928      0.69207           0.31
       half_life 0.75  0.3969           238176  0.23358  0.02964   0.60091      0.69207           0.32
   half_life 1 (SHIP)  0.5000           238176  0.23337  0.02784   0.60130      0.69207           0.32
        half_life 1.5  0.6300           238176  0.23325  0.02659   0.60184      0.69207           0.32
          half_life 2  0.7071           238176  0.23322  0.02633   0.60151      0.69207           0.32
     half_life 3 BEST  0.7937           238176  0.23322  0.02568   0.60182      0.69207           0.32
          half_life 4  0.8409           238176  0.23323  0.02504   0.60138      0.69207           0.32
          half_life 8  0.9170           238176  0.23325  0.02509   0.60127      0.69207           0.32
        half_life inf  1.0000           238176  0.23330  0.02559   0.60073      0.69207           0.32
  current season only  0.0000           119519  0.23556  0.03833   0.59399      0.48780           0.28
```

Brier is **monotone decreasing in half-life** up to 3, then flat. ECE is monotone all the way to `inf` (0.04308 → 0.02504 at hl=4): every shortening of the half-life makes calibration worse. "Current season only" is worse than the contract on Brier (+0.00219), ECE (+0.01049), accuracy (-0.0073), and drops rung-1 reach from 69.2% to 48.8%.

**Floor:** league average only (0.4962 for every play) = **0.24997**. Situation rate, no team = 0.22880. Every setting in the sweep loses to the situation baseline.

Tuning the knob buys **-0.00016 Brier (-0.067%)**. Total sweep spread 0.00334.

## 3. Optimum restricted to coach-change teams — the requested test

24,049 new-coach plays (19.6%), 84,635 same-coach (69.1%).

```
              setting       r  brier_new_coach  brier_same_coach      gap
       half_life 0.05  0.0000          0.24178           0.23438  0.00740
        half_life 0.5  0.2500          0.23938           0.23190  0.00748
          half_life 1  0.5000          0.23862           0.23113  0.00749
          half_life 2  0.7071          0.23845           0.23097  0.00748
          half_life 3  0.7937          0.23844           0.23097  0.00747
        half_life inf  1.0000          0.23850           0.23106  0.00745
  current season only  0.0000          0.24076           0.23342  0.00733
```

**New coach optimum: half-life 3. Same coach optimum: half-life 2.** The coach-change group wants a *longer* half-life than stable teams, the exact opposite of the prediction. Gains vs contract: -0.00018 (new) and -0.00015 (same). The two curves are parallel — the new/same gap is 0.00733-0.00750 at every single setting, moving 0.00017 across the whole sweep.

## 4. Sharpest test: the group where decay should win outright

Split by which training season is stale. Group A changed coach for 2024 and not 2025, so 2023 is under a dead staff and 2024 is the current one — decay targets the wrong season and keeps the right one. If the mechanism works anywhere, it works here.

```
                         group  teams  plays  brier_hl_0.05  brier_hl_1  brier_hl_inf  best_setting  gain_vs_contract  short_minus_long
    A 2023 stale, 2024 current     29  24882        0.23825     0.23471       0.23478   half_life 2          -0.00010          +0.00347
  B both seasons current staff     76  64257        0.23334     0.23018       0.23005   half_life 3          -0.00019          +0.00328
          C both seasons stale     29  24049        0.24178     0.23862       0.23850   half_life 3          -0.00018          +0.00327
```

Group A prefers half-life 2 and is **hurt by 0.00347 for forgetting 2023** — a season we know was run by a different head coach. `short_minus_long` is +0.0033 in all three groups, identical to three decimals. The decay curve has the same shape whether the old season is stale or current, which means decay is doing variance reduction, not staleness removal. This is the clean refutation.

## 5. Honest out-of-sample regime-aware half-life

The natural OOS fit (train 2023, score 2024) is degenerate: a one-season window makes every half-life produce weight 1.0, nothing to fit. Instead, fit on 2025 weeks 1-7 (61,362 plays), score weeks 8-16 (61,054). Tables never see 2025 either way.

Fitted: global `hl 1.5`, new coach `hl 3`, same coach `hl 1.5`.

```
                                      policy    brier  vs_contract
                 league average only (floor)  0.24998     +0.01708
                     situation rate, no team  0.22827     -0.00463
                      contract half_life 1.0  0.23290      0.00000
         one tuned half-life (half_life 1.5)  0.23272     -0.00018
  regime-aware (half_life 3 / half_life 1.5)  0.23271     -0.00019
```

Regime-aware half-life vs one tuned half-life: **-0.00001 Brier (-0.003%)**. Nothing.

## 6. Two knobs on one scale

```
                                        policy    brier  vs_contract
                   league average only (floor)  0.24997     +0.01660
                       situation rate, no team  0.22880     -0.00457
      contract: half_life 1.0, team weight 1.0  0.23337      0.00000
  recency knob alone, best decay (half_life 3)  0.23322     -0.00016
     shrink knob alone, half_life 1.0 + w=0.32  0.22748     -0.00589
  shrink knob alone, half_life 1.0 + n/(n+200)  0.22812     -0.00526
                    both, half_life 3 + w=0.32  0.22752     -0.00585
```

**Recency tuning recovers 2.7% of what the shrink recovers.** Combining them is worse than the shrink alone (-0.00585 vs -0.00589): the two knobs are substitutes, not complements. The decisive tell is that the best shrink weight is **0.32 at half-life 1.0 and 0.32 at half-life 3** — if decay had removed the stale data, the optimal trust in the team number would have risen. It does not move at all.

## 7. NFL: cannot be run, and that is a fact about the mechanism, not the sample

```
              setting     n       brier         ece    accuracy  rung1_reach
       half_life 0.05  9452  0.22136104  0.02170341  0.62949640   0.51005078
          half_life 1  9452  0.22136104  0.02170341  0.62949640   0.51005078
        half_life inf  9452  0.22136104  0.02170341  0.62949640   0.51005078
  current season only  9452  0.22136104  0.02170341  0.62949640   0.51005078
```

13 settings, **1 distinct Brier value, spread 0.0000000000**. The parquet is season 2024 only, so `0.5**((max_season - season)/half_life)` is 1.0 for every row at every half-life. The parameter is unreachable, not weak. A within-season week decay would be a new mechanism, not a tuning of this one, and one NFL season could not validate it anyway.

## 8. Plain answer

No. Three separate ways of asking produce the same negative:

1. The global optimum is **longer** than shipped (3 vs 1), worth -0.00016.
2. The coach-change optimum is **also longer** (3), and the new/same gap is flat across the entire sweep (0.00733-0.00750).
3. In the one group where decay should win by construction (2023 stale, 2024 current), forgetting 2023 **costs 0.00347**, the same penalty stable teams pay.

Season decay is a variance/bias trade on a two-season window, and at n this small the variance term dominates everywhere, including for teams that genuinely changed staff. It cannot express regime because the thing it discounts (age) is only weakly correlated with the thing that matters (staleness), and discarding a stale season still costs more in sample than it saves in bias.

Two things follow for the engine owner. The contract's `half_life = 1.0` is mildly mis-set: 2.0-3.0 is better on Brier (-0.00016), better on ECE (0.02784 → 0.02568), and better on accuracy (0.6013 → 0.6018), for a one-character change. That is a rounding error next to the shrink. And the shrink (w≈0.32, worth -0.00589) remains the only intervention on the table that matters, which is the same conclusion `magnitude.py` reached from the coordinator side.

Caveats: two training seasons only, so the half-life grid is really a one-parameter r sweep and nothing here speaks to windows of 4+ seasons; head coach proxies coordinator; the section 5 fit uses a within-season week split because the season-level OOS fit is degenerate.

Next action: open `engine/regime/test_recency.py` section 5b (the three-group staleness table) — it is the one result that answers the design doc directly.

## Method 2

`/Users/nking/Documents/football-companion/engine/regime/test_changepoint.py` — runs in 14s, zero API calls, imports `tendency`/`buckets`/`backtest`/`schema` and `regime.magnitude` (coach ground truth). No existing file touched, no commit.

**VERDICT: detection works, and detects the wrong thing. Changepoints are real level shifts, only weakly aligned with coaching, and acting on them makes held-out Brier worse. Do not build this either.**

## 1. Setup

5,521 team-games, 360,592 eligible bucketable plays, 237 teams, 134 with ≥20 games. Series = per-game mean of `is_pass − league_rate[bucket]` (pass rate over expectation), weight = play count.

The situation adjustment is small but real: per-game situation mix has sd 0.0258 and explains 12.7% of raw game pass-rate variance; raw sd 0.1207 → adjusted sd 0.1141, so 10.7% of between-game variance is removed before detection.

Detector: weighted CUSUM `|S_k − W_k·S/W| / sqrt(W_k(W−W_k)/W)`, binary segmentation, 999-permutation p-values, min segment 6 games. Self-check: planted 0.20 step at game 15 → found at 15 (p=0.001, stat 4.20); pure noise → no detection; permuted-matrix path equals the direct curve; down-weighting post-step games moves the statistic 4.20 → 1.59.

## 2. Null calibration and yield

```
 alpha  teams  null_cps  null_teams  null_rate  real_cps  real_teams  real_rate
 0.05     134        11          10     7.46%        60          50     37.31%
 0.01     134         1           1      0.75%        30          28     20.90%
```
Well calibrated (7.5% vs nominal 5%; 0.75% vs 1%). 60 changepoints on 50 of 134 teams: 41 teams with 1, 8 with 2, 1 with 3.

## 3. Against the head-coach ground truth (±2 games)

```
 alpha  cps  teams  precision  chance  recall     f1
 0.05    60     50     16.67%   8.56%  16.39%  0.1653
 0.01    30     28     23.33%   8.56%  11.48%  0.1538
```

61 coach changes, all reachable. Precision 10/60 = 16.7% against an 8.6% chance rate (a detector firing at a uniformly random legal split), **lift 1.95x, one-sided binomial p = 0.0304** — 10 hits where luck gives 5.1. Recall 16.4%.

Placement relative to the nearest season boundary: exactly on it 12/60 (20%), within ±2 games 30/60 (50%). So half the changepoints are mid-season, where no coordinator table could ever put one.

Real but useless at this rate: at α=0.05 you would truncate 50 teams' histories to catch 10 of 61 coach changes.

## 4. What the detector is actually finding

Three ground truths, same 60 detections:
```
 ground_truth              events  matched  precision  chance  lift  recall
 head coach change             61       10     16.67%   8.56%  1.95  16.4%
 primary passer handoff       312       27     45.00%  34.36%  1.31   8.7%
 either one                   373       31     51.67%  37.53%  1.38   9.9%
```

Passer read out of `play_text` (83% extraction, plus a "pass from NAME" fallback). Using the modal starter over the 6 games either side of the split: **the QB differs across 50% of unmatched changepoints vs a 40% random-split base rate**, and 80% of matched ones vs 40%. The QB explanation is directional and weak — the naive version (modal passer over whole segments) reads 86% vs 73% and is an artifact of segment length.

What is unambiguous: the changepoints are **real level shifts, not noise**.
- mean |Δ adjusted pass rate|: detected 0.1189 (unmatched) / 0.1426 (matched) vs **0.0484 at a random legal split** — 2.5x.
- Persistence past the first 8 games:
```
 qb_matched  cps  games_checked  |shift| first 8  |shift| rest  retained  same_sign
 False        23            334            0.1221        0.1020     0.835      91.3%
 True         23            294            0.1254        0.1293     1.031      95.7%
```
The new level holds. This is not the detector chasing hot streaks.

## 5. Four inspected by hand

- **Boston College, game 25 (2024 bowl)**, p=0.001, adj −0.078 → +0.104. Castellanos → Grayson James → Lonergan; Bill O'Brien both sides. The detector split one game *before* the season boundary because the bowl game already looked like the new offense. Real. Independent confirmation: `magnitude.py` flagged BC 2025 as the second-largest stable-staff shift (0.1959).
- **Alabama, game 26 (2024 bowl)**, p=0.001, delta +0.1411. Milroe → Ty Simpson, DeBoer both sides. `magnitude.py` measured the Saban→DeBoer head-coach change at 0.0764, *below Alabama's own 0.0792 noise floor*. **The QB change moved Alabama's tendencies nearly twice as much as the head-coach change did.**
- **Western Michigan, game 33 (2025 w10)**, p=0.028, adj −0.041 → −0.210. Six straight games at raw pass rates of 0.41, 0.26, 0.14, 0.24, 0.22, 0.31 against ~0.48 expected. A team that abandoned the pass entirely. No coach change, no clean QB handoff. This is the case a maintained table would never contain and the app would most want.
- **Louisiana Tech, game 20 (2024 w11)**, p=0.007, same QB (Bullock) both sides. Post-split games run −0.12, −0.20, +0.09, −0.02, +0.09, −0.04. This one looks like the detector latching onto two bad weeks. Marginal, and honest to call near-noise.

## 6. The decisive test: detect on 2023-2024 only, truncate, score held-out 2025

Train-only detector: 34 changepoints on 30 of 133 teams; 6 land on the 2024 coach change (18%). Every policy scored against an identical situation baseline (0.22880).

```
 policy                                           kept    brier   skill_vs_sit   acc   rung1
 engine as shipped (half-life 1 season)         100.0%  0.23337       -2.00%  0.6013  69.2%
 truncate at last changepoint (alpha 0.05)       90.3%  0.23371       -2.15%  0.6003  65.0%
 truncate at last changepoint (alpha 0.01)       94.7%  0.23359       -2.10%  0.6007  67.0%
 control: random cut, same teams, same size      ~90%   0.23389 (0.23361-0.23409)
 control: most recent season only                50.2%  0.23380       -2.18%  0.5986  48.8%
 control: half-life 0.5 seasons                 100.0%  0.23413       -2.33%  0.5993  69.2%
 control: half-life 2 seasons                   100.0%  0.23322       -1.93%  0.6015  69.2%
 control: half-life 100 (no decay)              100.0%  0.23329       -1.96%  0.6012  69.2%
```

- **Truncation vs shipped: +0.00034 Brier (+0.145%). It hurts.** Accuracy 0.6013 → 0.6003.
- It beats a random cut of the same size by only −0.00018, well inside the control's own spread (0.23361–0.23409). Most of what truncation does is "drop 9.7% of your data".
- The strict threshold (α=0.01, 17 teams) still loses to shipped, so this is not a threshold-tuning problem.
- **Restricted to the 24,868 held-out plays truncation touches: shipped 0.23017 → truncated 0.23184 (+0.00167).** Concentrating on the affected plays makes it worse, not better, which rules out dilution as the explanation.
- Truncation costs rung-1 reach 69.2% → 65.0%. It buys recency by paying sample size, and at this granularity the sample size was worth more.
- The half-life sweep is the quiet finding: **less decay is better.** Half-life 2 seasons scores 0.23322 and no decay at all 0.23329, both beating the shipped 1-season half-life (0.23337); half-life 0.5 is worst at 0.23413. The engine is already discarding history slightly too fast.

## 7. Plain answer

Detection is statistically sound and finds genuine, persistent, mid-season play-calling shifts of ~0.12 in adjusted pass rate that no coordinator table would ever contain. But it is not a coaching-change detector (16.7% precision, 16.4% recall, 1.95x lift), it is not clearly a QB detector either (50% vs 40% base rate), and truncating on it loses to doing nothing. The reason is the same one `magnitude.py` found: the team number is over-trusted for everyone (`skill_vs_situation` is negative in every row above), so any policy that trades sample size for recency is optimizing the wrong axis.

Caveats: three CFB seasons; head coach proxies coordinator; the ±2-game tolerance is generous to the detector and the chance rate is computed under it; `retained` in the persistence table is truncated by the end of the 2025 data for late changepoints.

Next action: tell the engine owner two constants, both regime-blind — the global team-weight shrink from the magnitude run (w≈0.32), and change the recency half-life from 1 season to 2 (0.23337 → 0.23322 on held-out 2025, free).

## Method 3

`/Users/nking/Documents/football-companion/engine/regime/test_coach_keying.py` — 8.7s, 0 new API calls (reuses `data/raw/coaches_{2023,2024,2025}.json`). Imports `tendency`, `buckets`, `backtest`, `schema`, `ingest_cfb`, `magnitude`. Nothing outside `engine/regime/` touched, no commit.

**VERDICT: no. All three regime variants lose to plain team keying, and the one that appears to win does so for a reason that has nothing to do with regimes.**

## Setup
Train 2023-2024 (238,176 eligible), hold out 2025 (122,416 scored, 0 dropped). Regime id = `{school}#{tenure_start}`, tenure walked backwards through the primary head coach per school-year. 136 FBS schools in 2025: **71 continuous since 2023, 28 changed for 2024, 37 changed for 2025** (9 in-season takeovers, 2 new to the coach list — reconciles with magnitude's 35 over 134 matched schools). 94 unmatched offenses (FCS opponents) = 7,468 plays, identical under every variant. Verified: A and B produce byte-identical predictions on all 60,481 continuous-staff plays.

## 1. Overall, 122,416 held-out plays

```
variant                                 brier      vs_A   skill_v_sit    acc      ece    mean_n
A team-keyed (shipped)                0.23337   0.00000     -0.0200   0.6013   0.0278     307
B regime-keyed, pre-regime discarded  0.23156  -0.00181     -0.0121   0.6060   0.0228    3604
C regime, fall back to team           0.23388  +0.00051     -0.0222   0.5999   0.0315     298
C2 regime per rung, else team         0.23376  +0.00039     -0.0217   0.6003   0.0307     297
D placebo: team, B's sample size      0.23147  -0.00190     -0.0114   0.6072   0.0207    2410
situation baseline (no team at all)   0.22880
```
Team-clustered bootstrap, 2000 draws: B−A −0.00181 [−0.00286, −0.00087]; **C−A +0.00051 [+0.00024, +0.00084]**; **C2−A +0.00039 [+0.00019, +0.00060]**. C and C2 are significant losses. The placebo D — team-keyed, zero regime information, each team randomly downsampled to exactly B's row count — beats B (0.23147 vs 0.23156, sd 0.00005 across seeds 11/12/13). Every variant is worse than dropping team attribution entirely.

Rung distribution (share of plays): A 69.2/19.9/2.7/6.2/2.1; **B 47.7/17.2/3.8/4.9/26.4**; C 64.8/22.1/4.6/6.4/2.1; D 47.8/17.2/3.7/4.9/26.4.

## 2. Restricted to teams that changed coach

**Changed for 2025 (37 teams, 30,313 plays, 24.8%)** — the target population:
```
A  0.23790   rung1 69.1%   ece 0.0356
B  0.22939   rung5 100.0%  ece 0.0065   skill_vs_situation exactly 0.0000
C  0.23790   identical to A on every play
C2 0.23790   identical to A on every play
D  0.22951
```
Two facts kill the proposal here. **B has zero training rows for these teams, so it lands on rung 5 for 100% of their plays — it is not a regime table, it is the league baseline.** B−D = −0.00009 [−0.00025, +0.00005], not significant: the entire −0.00850 gain is "no team number", none of it is regime. And **variant C returns exactly A's prediction on all 30,313 plays**, because the regime block never clears the floor, so the fallback fires every time. The fallback design delivers literally nothing to the group it exists for.

**Changed for 2024 (28 teams, 24,154 plays)** — the only group where a regime table has data and less of it:
```
A  0.23441   rung1 73.9%  mean_n 122   ece 0.0278
B  0.23590   rung1 51.6%  mean_n  94   ece 0.0439   +0.00149 [+0.00017, +0.00291]  sig LOSS
C  0.23697   rung1 51.6%  mean_n  75   ece 0.0425   +0.00256 [+0.00137, +0.00385]  sig LOSS
C2 0.23637   rung1 73.9%  mean_n  70   ece 0.0414   +0.00196
D  0.23531                                          +0.00115
```
B−D = +0.00059 [−0.00090, +0.00209], **not significant**. Regime-selected training rows are no better than a random subsample of the same size, and point-estimate slightly worse.

## 3. Sample size vs regime, four separations

```
group                A         B       B-A       D       D-A     size part   regime part
changed for 2025  0.23790  0.22939  -0.00850  0.22951  -0.00839   -0.00839     -0.00011
changed for 2024  0.23441  0.23590  +0.00149  0.23556  +0.00115   +0.00115     +0.00034
continuous        0.22981  0.22981   0.00000  0.22981   0.00000    0.00000      0.00000
```
**Rung-matched** (58,376 plays where A and B both reach rung 1, ladder depth held constant): A 0.23794, B 0.23869 (+0.00074), D 0.23848 (+0.00054). B still loses with depth fixed, and 73% of that loss is reproduced by the regime-free placebo. On changed-for-2024 alone: A 0.25065 (mean n 159) vs B 0.25413 (mean n 79).

**Difference in differences** (train on 2024 alone vs 2023 alone, both team-keyed, sample size matched by construction, 2024 is the current regime only for the changed group):
```
changed for 2024      2023-only 0.23918  2024-only 0.23592  gain -0.00326 [-0.00611, -0.00029]
continuous 2023-2025  2023-only 0.23281  2024-only 0.23059  gain -0.00222 [-0.00426, -0.00024]
DiD = -0.00104
```
This is the one place the regime hypothesis is confirmed: with volume and plain recency differenced out, the current-regime season is worth 0.00104 Brier more to a team that changed staff. Real, correctly signed, and an order of magnitude smaller than the 0.00115 it costs to discard the other season to get it.

## 4. The engine already has this knob, and it wants it turned the other way

```
half_life  brier_all  changed_2024  changed_2025  continuous
   2.00     0.23322      0.23430       0.23774      0.22964
   1.00     0.23337      0.23441       0.23790      0.22981   <- shipped
   0.50     0.23413      0.23518       0.23862      0.23059
   0.25     0.23567      0.23689       0.24008      0.23210
```
Monotone in every group. **Weighting the stale season more is better even for teams with a brand-new head coach.** Shortening the half-life is the regime intervention in continuous, zero-maintenance form, and it makes predictions worse at every setting tested. Discarding data hard (B) is the limit of that same bad direction.

## 5. After the global shrink magnitude recommended

```
A  shrunk w=0.32  0.22748
B  shrunk w=0.37  0.22729   -0.00019
C  shrunk w=0.31  0.22745   -0.00003
C2 shrunk w=0.31  0.22748   -0.00001
situation baseline           0.22880
```
Best case for regime keying once the team number is shrunk properly: **0.00019 Brier, 0.08%** — and that best case is B, which achieves it by having no data for a quarter of the league.

## 6. Answer

Regime keying does not beat team keying. Variant B's headline win (−0.00181) is fully accounted for by two things that are not regime information: it hands 24.8% of plays to the league baseline, and the equal-sample-size placebo with no regime labels beats it. Variants C and C2, the versions you would actually ship because they keep a number on the card, are **significantly worse than the status quo** (+0.00051 and +0.00039, CIs excluding zero) and worse calibrated on exactly the changed-staff plays they target (ECE 0.0390 and 0.0387 vs A's 0.0327).

The regime effect exists — the DiD isolates it at −0.00104 — but it is smaller than the sample-size cost of acting on it, and the existing exponential season decay already captures the accessible part. The engine's recency decay is a soft regime filter that never needs a table maintained.

Caveats: three CFB seasons; head coach proxies coordinator and undercounts churn; tenure starts are left-censored at 2023 (harmless, training starts there too); the placebo is averaged over three seeds (sd 0.00005); the 37-team 2025 change group includes 9 in-season takeovers whose held-out season is itself a regime mix.

Next action: run `.venv/bin/python engine/regime/test_coach_keying.py` and read section 3, "CHANGED FOR 2025" — variant C returning A's exact number on all 30,313 plays is the single line that settles it.