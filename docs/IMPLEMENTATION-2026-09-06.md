# Implementation progress — September 6, 2026

The full scope remains [the advanced-mode plan](/Users/nking/Documents/football-companion/docs/ADVANCED-MODE-PLAN-2026-09-06.md). This is a progress record, not a claim that the whole plan is finished.

**Implemented and checked in the first release candidate**

- “Read the game” remains the default; “Beginner” is explicit and remembered. Switching modes replaces the whole main read, including at fourth down. The default no longer falls through to the old beginner card library.
- `web/game-read.js` ranks supported observations: fourth-down and clock decisions, repeated named third-down targets, long third downs, verified penalty-driven progress and multiple sacks on the current drive. Ordinary repeated reads have a six-moment cooldown; important fourth downs remain eligible. A quiet state replaces filler when nothing qualifies.
- `FootballInsights.forRead` projects only approved aggregates of released reports into PRIME. Raw ESPN objects stay in LIVE. Evidence is ready before the next snap is selected. Same-ID revisions recompute counts instead of accumulating duplicates.
- Historical run/pass estimates are secondary, in a disclosure that states which context the current tables match. They are hidden for fourth-down and urgent late-game decisions where the old situation-only rate is misleading. **No probability model has changed yet.**
- Prediction questions require explicit opt-in. Default-mode questions match the displayed decision: kick/go or gaining a first down. Beginner uses its authored cue rather than an unrelated randomly selected lesson. Near-coin-flip run/pass questions are suppressed.
- “Was this useful?” saves a rating with the shown card in the existing local journal. Nothing is uploaded. The journal records exact read wording, selector version, supporting play IDs and whether historical percentages were actually expanded.
- `engine/journal_audit.js` and `scripts/audit-journals.mjs` replay exported journals from their original release times. They check support, same-version reproduction, repetition and feedback, and compare displayed plays with an exact-game final review where available. They do not train a model or claim prediction/learning accuracy.
- Corrected queued plays retain their queue position while waiting for the revision’s full TV delay. Newer plays cannot jump ahead. Games hides raw scores whenever TV delay is enabled.

**Verification evidence**

`node --test tests/*.test.js`: 177 passing tests at this checkpoint. New tests cover fourth-down mode changes, unknown score/clock, named-target missingness and revisions, quiet/repeated reads, explicit questions, the aggregate boundary, queue order and timing, hidden historical percentages, and as-of journal reconstruction. `git diff --check` passes.

Chrome via agent-browser replayed the published Oregon–Boise review up to the fourth-down decision at 1:37. It used source-derived reports with their drive IDs and mocked transport, not a real live viewing session. The default showed the possession/clock tradeoff; Beginner showed its distinct teaching. Feedback saved and the CLI audit reproduced the recorded advanced read with no missing support. Desktop and 390×844 light/dark checks showed no horizontal overflow or JavaScript errors. The Games score-hiding behavior was verified with a 30-second delay.

The initial unmocked local browser could not fetch ESPN’s schedule from this environment. That limitation is separate from the replay verification. Do not describe the replay as verified stadium-to-TV timing or measured live prediction performance.

**Additional source access**

At 2026-09-06T23:32:43Z, a single CFBD `/live/plays` access probe using the existing key returned HTTP 401: “This endpoint requires a Patreon subscription at Tier 2 or higher.” The requested game was already finished; this was an access check, not a latency test. The record is in ignored `data/qa/cfbd-live-access.json`. A question about a $5/month trial is pending. No subscription has been purchased.

**Outstanding work under the same goal**

1. Fit and calibrate score/time-aware historical tables separately for NFL and college; align the forecast labels with recorded live actions and prove exported/client parity. Use chronological evaluation and keep the old model as the comparison. A retrospective NFL improvement alone does not satisfy the live-data gate.
2. Add useful team/opponent and action-consequence comparisons with sample-size and missing-data checks. Connect these to the read selector without overreacting to a few plays or implying causal effects.
3. Expand dated actual-play-caller coverage to several staff transitions and test the coaching idea. Keep staff/quarterback changes explicit. The one-caller pilot remains inconclusive.
4. Expand the verified historical charting/practice bank and test recognition on a different play. The existing six examples remain; this release does not yet add examples or establish learning gains.
5. Run the new audit across real exported live-viewer journals, review the actual feedback and compare candidate changes on untouched later games. The local QA journal is not a substitute for those observations.
6. If authorized and accessible, run a bounded CFBD live trial measuring useful fields, missingness, revisions and latency. Add a protected server adapter/shared game cache only if the trial establishes a useful replacement or supplement. Evaluate richer licensed NFL access separately; no assumed college/NFL feature parity.
7. Finish deployment verification and record the production build below. Continue auditing the full original plan before declaring the goal complete.

Run a downloaded journal audit with:

```sh
node scripts/audit-journals.mjs --out data/journal-audit.json /absolute/path/to/football-journal-cfb-401858433.json
```

Pass multiple different game exports to compare sessions. Duplicate game exports are rejected so one session does not get counted twice. Inputs and reports can contain personal feedback; keep them in ignored local data unless the user chooses to share them.
