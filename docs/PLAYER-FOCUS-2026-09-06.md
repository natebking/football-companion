# Player-focused live companion

September 6, 2026. Product direction: **“Who should I pay attention to?”** Runtime version `2026-09-06-player-focus`; selector version `read-4`.

## What changed

The primary card names one player, gives the reported involvement behind that choice, and offers an observation for the viewer. Fourth-down and urgent clock decisions take precedence. The newest completed play has a visible explanation; extra detail is available on demand.

To keep that path clear, the separate drive, player-stat and historical panels now share a collapsed **Game context** section. The journal moved to the footer. The feed starts with three plays, expandable to 25. Advanced mode hides basic definitions and formation/direction labels behind **More about this play**; Beginner remains an explicit preference. No bottom overlay was added.

## How player selection works

Only released reports contribute. Revised play IDs replace prior versions. Sacks count as dropbacks, not throws; no-play penalties do not become carries or targets. Player labels remain the names/numbers in the report.

| Candidate | Minimum support | Named coverage | Player share |
|---|---:|---:|---:|
| Receiver on third down | 2 targets | At least 2/3 of third-down throws | At least 50% |
| Receiver on this drive | 2 targets | At least 2/3 of drive throws | At least 50% |
| Runner on this drive | 2 carries | At least 2/3 of drive runs | At least 50% |
| Receiver in this game | 3 targets | At least 70% of game throws | At least 35% |
| Runner in this game | 4 carries | At least 75% of game runs | At least 40% |

A tied leader is not selected within its category. Partial naming coverage is disclosed. Every candidate carries the complete denominator's play IDs. Third-down receiver evidence ranks above drive evidence, which ranks above game totals. Competing receiver/runner leaders within a scope are compared by their share of their respective action, then count. Carry leaders are suppressed on third-and-seven or longer.

These thresholds are conservative product heuristics, not calibrated probabilities. Reports establish prior involvement, not current participation, injury status, formation or the next assignment. A recommendation is revalidated for the current game, offense, drive and situation; it is retained only while eligible. Cooldown exhaustion no longer blanks an otherwise supported card.

## What the replay now explains

Examples use the captured Louisville–Ole Miss game `401856661`, not synthetic live timing.

| Report | Revised output |
|---|---|
| `693`: Lindsey's four-yard catch | Catch five yards behind the line, followed by nine yards after the catch; all three positions reconcile. Lacy's 17 of 33 reported carries supplies the next player focus. |
| `709`: Fields gains 14 on first-and-25 | The gain still leaves 11 yards to the first-down line. It does not infer a cause from the preceding penalty. |
| `714`: revised incomplete pass | The report credits Banks with a quarterback hurry. It does not claim that pressure caused the incompletion or name an unreported receiver. |
| `720`: missed 57-yard field goal plus roughing | The accepted 15-yard penalty gives the offense a first down at LOU 25; the miss did not end the drive. The ruling appears once in advanced mode. |
| `683`: sack before fourth-and-24 | The primary card combines verified penalty losses and the sack into the drive's current problem. |

Passing components must reconcile with the gain and any reported catch spot. Single accepted penalty names need validated movement; declined, offsetting, multiple or contradictory rulings retain the full report rather than a compressed claim. Corrections remove unsupported takeaways and update the saved display record.

## Verification

- 253 JavaScript tests passed, including name coverage, denominator IDs, corrections, possession changes, current-drive priority, long-third suppression, display persistence and journal disclosure behavior.
- 36 Python tests passed. Historical probability tables and forecast candidates were not modified.
- Browser replay inspected at 1280px desktop and 390px mobile widths, in light and dark themes. Context, play-detail disclosure and Beginner switching were checked. No horizontal overflow or browser errors were found.
- A fresh browser visit correctly shows “Pick a game to start” and hides empty Game context. Raw replay fixtures and screenshots remain ignored under `data/qa/player-focus/`.

These checks establish supported output and working presentation. They do not establish improved viewer learning, prediction accuracy or reliable TV synchronization. No paid source, visual analysis, background retraining or delay-queue change is included.

The next useful evaluation is ordinary viewing feedback on the chosen player and latest explanation. An explicit explanation tied to the exact previously displayed player prompt remains separate follow-up work; this release does not claim that the app previously highlighted a play when it did not.
