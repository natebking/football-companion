# Implementation progress — September 6, 2026

The full scope remains [the advanced-mode plan](/Users/nking/Documents/football-companion/docs/ADVANCED-MODE-PLAN-2026-09-06.md). This is a progress record, not a claim that the whole plan is finished.

**Third checkpoint: previous-season team and opponent comparisons**

The `read-3` selector can now use descriptive 2025 outcomes in 2026 games. A collapsed **Past games** disclosure shows the offense and opposing defense in matching down, distance, field, score and clock bands. Relevant third-down comparisons and early-down short-run counts can supply the main read; current-game patterns and urgent decisions retain priority. The default remains Read the game, with an explicit Beginner choice.

Profiles require 20 plays across 5 games. Individual conversion and yardage measures also have known-outcome thresholds; unclear results do not become failures. NFL conversions join the original nflverse game/play IDs and possession team. College penalties and fumbles with unclear possession remain unknown, and interception return yards do not enter offensive gain counts. These are counts, not fitted probabilities, opponent-adjusted rankings or causal run/pass recommendations. The separate live probability tables remain unchanged.

The game’s reported season and season type travel through the existing delay queue. Profiles are eligible only for the following season’s regular/postseason games; missing, preseason, older or stale season context suppresses them. The module receives approved context and static aggregates, not raw live reports. Exact dataset/team/context references and disclosure text are saved in the journal. Offline replay explicitly reports missing historical datasets as unverifiable.

Validation: 194 JavaScript tests and 27 Python tests pass. Python/browser context keys agree on all 34,032 distinct NFL and 119,354 distinct college archived contexts. See `history-profiles-audit.json` for source hashes, coverage and export sizes. A source-derived Oregon–Boise replay displayed Boise State’s 17/49 third-down conversions alongside 7/32 allowed by Oregon. Its browser journal reproduced the read using the matching dataset, with no missing support. Desktop and 390×844 mobile light/dark checks showed no overflow or JavaScript errors. The transport was mocked from saved reports; this is not evidence of live usefulness or improved predictions.

Third release production verification: app commit `b5f61b8` is pushed. Preview `dpl_7BDKRtWraYd7DMZunU7BBAmRQA5p` and production `dpl_3Au42qYdp3fCnyJhqheeweeC6hJw` are READY. The production URL is `https://football-companion-2xcdx1l5z-nates-projects-925609f4.vercel.app`, aliased to fluentin.football and the old rose URL. Local, preview and public build ID `d47c67cd503ff7b4501912a755fee72f5d4d1f9e240d87d1e67688d25d48f7fc` matches. Public app, read selector, history lookup/render modules, both profile datasets and index response hashes match the local manifest. The clean build excludes replay files; isolated browsers and the local server are closed. Wider play-caller research, more recognition examples, prospective evaluation and the optional paid-source trial remain outstanding. A follow-up timing check should cover updates to score, clock, season or feed health when the down/distance/spot remains identical; the existing queue currently identifies new snap contexts by that situation key.

**Second checkpoint: clock priority and real-source evaluation**

See [the complete results](CONTEXT-RESULTS-2026-09-06.md) and [the fixed evaluation protocol](CONTEXT-EVALUATION-PROTOCOL-2026-09-06.md). Read selector `read-2` keeps late-game score/clock ahead of routine patterns and applies pattern cooldowns across count changes. The live parser no longer confuses the surname Kneeland or a fake kneel with taking a knee. Finished Washington–Washington State and Texas A&M–Missouri State reviews were exported from final sources, and Oregon's review was regenerated with the checked parser.

The journal audit now replays saved background selections and keeps independent proposed/recorded histories. It deduplicates disclosure renders and feedback by teaching moment. The real journals contain 29 distinct visible guidance moments; final comparison found four changed play-display records, each with changed source evidence. Only three source-aligned pre-arrival probabilities are linkable, so live forecasting performance remains unestablished.

The separate NFL and CFB context evaluations are complete. Both show lower held-out historical error than the current estimator on matching inputs, and both pass the declared research gates. Calibration improves NFL but worsens college relative to its uncalibrated context model; do not silently choose a different college method from test results. Python/client parity passes across all unique held-out inputs. Research tables remain in ignored data, and live probability files are unchanged. New source checks corrected college snap clocks where explicit report times exist and corrected no-play/scramble classification. Older college clock semantics remain a limitation.

At this checkpoint 186 JavaScript tests and 22 Python tests pass. A browser replay of saved Washington releases shows the clock/possession read at 1:48 up 14; desktop and mobile light/dark are free of horizontal overflow. Remaining work is still the team/opponent comparison feature, wider verified play-caller coverage, expanded recognition examples, and prospective usefulness/forecast evaluation. The paid live-source question remains pending.

Second release production verification:

- Application commit `669cd66`, pushed to `origin/main`.
- Preview `dpl_J4CriaoP5hdKkCcjWjidfswWUxZ2`; production `dpl_6L4EHcixoFu4vVD8vB1tmsTiUjmZ`, READY.
- Production URL `https://football-companion-ejpo61cu5-nates-projects-925609f4.vercel.app`, aliased to `https://fluentin.football/` and the old rose URL.
- Local, preview and production build ID `c2f10048ef79bd075a14aeeb92e858d7858419f2a83d783e97435615a0a9cfce` matches. The actual public read-selector, play-parser and both new review responses also match their local SHA-256 hashes.
- Temporary replay files were removed by the final clean build. The local server and isolated verification browser were closed. Cleanup produced local replay-file 404s after testing; those were not production requests.
- No live probability change or paid source was deployed. The broader goal remains active.

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

The isolated Chrome session could not fetch ESPN’s schedule. Direct requests returned HTTP 200 with CORS enabled. The user's existing Codex in-app browser did receive live reports. After preserving its journals and reloading, it displayed the new default read for WASH–WSU: “8 of 12 reported third-down plays needed at least seven yards,” alongside the current situation and five-play feed. This verifies the deployed path in that browser, not stadium-to-TV latency or prediction accuracy.

The real browser also exposed two journals, downloaded through the app UI and copied to ignored `data/journals/`: `cfb:401856668` (TA&M–MOST, final, 524 source revisions) and `cfb:401858437` (WASH–WSU, still live at download, 187 revisions). The initial audit found 23 and 6 distinct visible guidance moments respectively. Most other WASH–WSU prompts were recorded as background/covered; do not treat them as read. These exports precede the new selector and have no usefulness ratings. Their old prompts cannot count as successful reproduction of the new selector. Final-review matching and comparison work remains.

Two follow-ups identified in that live check—late-game lead priority and independent counterfactual cooldown history—are implemented in the second checkpoint above. Neither change itself demonstrates a forecast improvement.

**Additional source access**

At 2026-09-06T23:32:43Z, a single CFBD `/live/plays` access probe using the existing key returned HTTP 401: “This endpoint requires a Patreon subscription at Tier 2 or higher.” The requested game was already finished; this was an access check, not a latency test. The record is in ignored `data/qa/cfbd-live-access.json`. A question about a $5/month trial is pending. No subscription has been purchased.

**Outstanding work under the same goal**

1. The separate NFL/college fit, calibration review, source-alignment audit and client parity are complete. The candidate remains research-only pending a prospective live-data gate; the old live model remains the comparison.
2. The first descriptive team/opponent comparison is implemented and verified in the third checkpoint. Extend current-game comparisons only where the same outcome definitions and adequate samples support them; do not imply causal effects or opponent-adjusted weakness.
3. Expand dated actual-play-caller coverage to several staff transitions and test the coaching idea. Keep staff/quarterback changes explicit. The one-caller pilot remains inconclusive.
4. Expand the verified historical charting/practice bank and test recognition on a different play. The existing six examples remain; this release does not yet add examples or establish learning gains.
5. Run the new audit across real exported live-viewer journals, review the actual feedback and compare candidate changes on untouched later games. The local QA journal is not a substitute for those observations.
6. If authorized and accessible, run a bounded CFBD live trial measuring useful fields, missingness, revisions and latency. Add a protected server adapter/shared game cache only if the trial establishes a useful replacement or supplement. Evaluate richer licensed NFL access separately; no assumed college/NFL feature parity.
7. Continue auditing the full original plan before declaring the goal complete. The first production deployment is verified below.

**Production deployment**

- Application commit: `3b6596e`, pushed to `origin/main`.
- Production: https://fluentin.football/ — READY.
- Production deployment: `dpl_5EbEP1uiiVjTWa1ZRZUeXXy1EeML` (`https://football-companion-p7mvd3f3t-nates-projects-925609f4.vercel.app`).
- Preview: `dpl_2KfSC9TCJ1cAad4beEDNRHxziY98`.
- Tested local, preview and production `build-info.json` IDs all match: `01410c22287174fe03f6d03e9e855030a5c1438d72a514b41b57a0cba8b322e7`.
- Browser verified `read-1`, default `game`, a distinct Beginner choice, questions disabled by default and no horizontal overflow. The user's existing tab was refreshed and the new live read appeared.
- Static deployment; no application server functions or function logs to scan. No continuous monitoring was created.
- `vercel curl` in CLI 54.14.5 forwards `--scope` to curl and rejects it. Use the linked project without that flag for authenticated preview reads. `vercel promote` created a separate production deployment; its content was independently checked against the local build.

Run a downloaded journal audit with:

```sh
node scripts/audit-journals.mjs --out data/journal-audit.json /absolute/path/to/football-journal-cfb-401858433.json
```

Pass multiple different game exports to compare sessions. Duplicate game exports are rejected so one session does not get counted twice. Inputs and reports can contain personal feedback; keep them in ignored local data unless the user chooses to share them.
