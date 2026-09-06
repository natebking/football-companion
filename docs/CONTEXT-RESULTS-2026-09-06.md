# Score, clock and real-session audit

Score and clock improve the historical comparison in both leagues. This is enough to continue development, not to claim the live app has become a more accurate forecaster. The live probability files are unchanged.

The fixed-method [protocol](CONTEXT-EVALUATION-PROTOCOL-2026-09-06.md) separates tuning, calibration and testing by time. NFL and college are fitted separately. Both comparisons use the same qualifying plays for candidate and baseline. Earlier research already examined these 2025 seasons, so they are not untouched research holdouts. The baseline uses the current estimator with the corrected source labels described below. The candidate adds score/clock and a team residual; it does not use coaching identity.

| 2025 evaluation | NFL | College |
|---|---:|---:|
| Qualifying plays | 34,502 | 122,296 |
| Games | 285 | 933 |
| Current estimator Brier error | .218831 | .227384 |
| Context/team Brier error | .202638 | .216245 |
| With sigmoid calibration | .202532 | .216413 |
| Calibrated candidate accuracy | 67.20% | 64.72% |
| Current estimator accuracy | 62.48% | 61.22% |
| Current / calibrated ECE | .00915 / .00819 | .00918 / .01310 |

Lower Brier means smaller probability errors; it is not purely a calibration measure. The paired game-bootstrap difference versus the current estimator is −.016299 for NFL (95% interval −.017701 to −.014884), and −.010971 for college (−.011708 to −.010184). Both calibrated candidates pass the declared research checks for aggregate error, calibration bins and sufficiently represented score/phase subgroups.

Calibration has different effects. It improves NFL ECE, but worsens college ECE from .00546 for the uncalibrated context model to .01310. **There is no evidence here to prefer that extra calibration step for college.** Choosing a different method now requires a new validation comparison; do not select a winning variant on these test results and call that a fresh holdout. Calibration-bin errors and subgroup results are in [the machine-readable audit](context-evaluation-audit.json).

Python and the pure JavaScript reader agree to 2.23×10⁻¹⁶ across 34,478 unique NFL inputs and 121,684 college inputs. Tables are exported only to ignored `data/context-evaluation/`; the reader is not loaded by the live app. A missing score or clock produces no client estimate. An unseen team has no team adjustment and is identified as such. Small exact-context samples remain disclosed rather than being called high confidence.

**Source corrections found while doing the work**

- In the original college frame, 41,650 qualifying records had a structured clock different from an explicit leading time in the written report. After label exclusions below, 41,580 remain. In 219 plays the difference crosses a 2-minute or 5-minute context boundary. The evaluation and future CFBD ingestion now prefer the explicit snap time. Older records generally lack it; the structured clock's exact semantics remain unverified. NFL had no discrepancies among 253,613 qualifying records with an explicit written clock.
- A text-resolved scramble ending in a fumble could be classified as a pass. An explicit “no play” could also be overridden by a normal-looking play-type field. The CFBD classifier now keeps scrambles with rushes and excludes explicit no-plays. Original-play text following a revised ruling cannot override the current report. This changes 242 source rows across the college frame; 106 fewer 2025 test rows qualify. Both candidate and baseline use the corrected labels. Production tables have not been rebuilt.
- The live parser matched “Kneeland” as “kneel.” It now requires a whole action word, and a fake kneel remains a run. The drive/player summaries use the parser's explicit clock-play flag.

The original structured-clock results and intermediate results are retained in ignored data. These are corrections to inputs and definitions, not a search for parameters that pass the declared gates. The final clock/label run supersedes those intermediate numbers.

**What the real journals establish**

Two user-browser journals were saved through the app's export controls before refreshing its older open version. The raw journals remain local and ignored by Git.

| Session | Distinct visible guidance moments | Visible play-display records matched to final | Changed display records |
|---|---:|---:|---:|
| Texas A&M–Missouri State, `401856668` | 23 | 96 | 3 |
| Washington–Washington State, `401858437` | 6 | 7 | 1 |

The four changes were a six-to-seven-yard run correction, an added target name, a short/deep pass correction, and a changed penalty ruling. Each had changed source evidence. The final college passing feed supplied no additional air/after-catch splits in those visible display records. This does not mean the feed is never useful: its full-game review joins verified 30 and 39 completion splits respectively, much of which was already available from the written reports or outside the captured visible session.

The CFBD historical `/plays` response joined 170/171 Texas A&M final reports and 167/167 Washington reports by exact game, play and offense. The unmatched Texas A&M report lacked a matching offense identity and was excluded. Three explicit visible probabilities had a pre-arrival link to an eligible CFBD action label; Washington had none. **Three selected predictions cannot establish model accuracy.** There are no new-mode usefulness ratings or demonstrated learning gains in these exports.

The replay now keeps separate histories for recorded and proposed cards, including saved background selections. Disclosure renders are deduplicated, and the latest rating applies to the teaching moment. Candidate proposals are an offline comparison of saved moments, not full browser-event reproduction or evidence that users saw the new cards. Later games remain necessary for prospective testing.

**Visible follow-up fixes**

The default now keeps a late-game lead or deficit ahead of all-game patterns. A normal trend does not get a fresh cooldown merely because its count increased by one. Important clock and fourth-down decisions retain their place while they apply. The two new finished-game reviews are available through the journal/review interface. “Beginner” remains separate and explicit; the default never falls through to its basic definitions.

Verification at this checkpoint: 186 JavaScript tests and 22 Python tests pass. Browser replay uses the saved Washington releases at 1:48, up 14; it shows the possession/clock read rather than the long-third-down count, with no horizontal overflow or JavaScript errors. Mobile light and dark render checks pass. This replay does not measure TV delay.

Still to implement and evaluate: team/opponent historical comparisons in the main read, more verified play-caller transitions, more historical recognition examples, and a prospective improvement audit. A CFBD live-data subscription has not been purchased; the existing key cannot access that endpoint.

Run the reproducible work with:

```sh
uv pip install --python .venv/bin/python -r engine/requirements-context.txt
.venv/bin/python engine/context_evaluation.py
.venv/bin/python engine/audit_cfb_labels.py
node scripts/audit-journals.mjs --out data/journals/audit-final-reports.json data/journals/football-journal-cfb-401856668.json data/journals/football-journal-cfb-401858437.json
```

The label audit uses cached final CFBD responses; it does not call the network or upload journals. Research dependencies remain offline. [CFBD play fields](https://api.collegefootballdata.com/api/plays) and [scikit-learn calibration guidance](https://scikit-learn.org/stable/modules/calibration.html) support the source/measurement distinctions used here.
