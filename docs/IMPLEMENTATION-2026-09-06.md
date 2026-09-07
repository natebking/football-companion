# Implementation progress — September 6, 2026

The full scope remains [the advanced-mode plan](/Users/nking/Documents/football-companion/docs/ADVANCED-MODE-PLAN-2026-09-06.md). This is a progress record, not a claim that the whole plan is finished.

**Seventh checkpoint: TV field direction and practice auditing**

The user's added field request is implemented with Match TV / Flip field below the main diagram. It mirrors the ball, target line and defended-end labels, preserves the teams' ends on regulation possession changes and reverses them for the second/fourth quarters through the existing TV-delay queue. It remembers choices by game, requests a new match after halftime or at the start of an overtime period, and respects the college overtime shared-end rule. See [implementation, rule sources and browser checks](TV-FIELD-2026-09-06.md). All 229 JavaScript tests pass; desktop light and mobile dark checks have no overflow or JavaScript errors. Production verification follows after deployment.

The separate [practice audit](PRACTICE-AUDIT-2026-09-06.md) is ready for voluntary exports. It verifies question/source versions and separates first recorded attempts, repeats, unknown history, unanswered questions and “Not sure.” The two available QA responses verify the workflow only. No real viewer practice results or learning gains are established.

**Sixth checkpoint: frozen forecast replay**

The [forecast replay workflow](FORECAST-REPLAY-PROTOCOL-2026-09-06.md) now compares a frozen candidate and the shipped historical baseline on the exact pre-snap context saved in a journal. Separate 2026 NFL and college candidates train only through 2025, retaining the previously selected shrinkage and calibration. The freeze records model, baseline, training-source and code hashes. It does not update the live probability files.

The two existing college exports contain 43 guidance records. Twenty-one support a visible, pre-arrival, explicitly linked counterfactual; only three visibly displayed a percentage. All are development examples, with no prospective observations. Nineteen have a later reported clock, score or period difference, which is retained separately and never used to repair the original input. Ordinary clock movement can cause these differences; the count is not a count of bugs. Exact source/play/offense joins, outcome-family exclusions and unknown inputs are preserved. [Results and limitations](FORECAST-REPLAY-RESULTS-2026-09-06.md) include all three displayed cases, with no small-sample accuracy claim.

Validation: 217 JavaScript and 36 Python tests pass. The candidate's Python and browser calculations agree within 2.23×10⁻¹⁶ across 633,205 distinct training contexts in the two leagues. Tests cover outcome leakage, source arrival/release timing, conflicting links, latest-input selection, missing context, hidden probabilities and baseline parity. These establish calculation and replay correctness, not improved live predictions. There is no browser change or deployment at this checkpoint.

Later sessions can use the existing freeze without fitting again. The declared minimum for an aggregate prospective readout is 2,000 eligible plays across 20 games per league. NFL additionally needs an exact-game final-label join; no NFL live journal is in this evaluation. Genuine viewer feedback and practice results are still needed to assess usefulness and learning separately.

**Fifth checkpoint: historical practice**

Explore past plays now has twelve verified source plays and six paired questions. Each question follows a worked example with a play from a different game. Added contrasts include a screen with no gain, a catch behind the line that FTN did not chart as a screen, a large completion short of the marker, play action without an established defensive reaction, and sacks with four versus five rushers. The library withholds target titles and summaries until after the answer. Practice stays near the footer and never interrupts live watching.

The separate local practice record saves the question and source facts, bank hash/version, first answer, opening/answer times, level, and prior exposure. Prior questions about the same target count even when the question differs. “Not sure” remains separate from an unsupported answer. Download and explicit clearing are available in Practice history; storage failures stay visible and existing records are not silently discarded. No answer changes live predictions or marks a concept as learned.

Validation: 209 JavaScript tests and 32 Python tests pass. The exporter rejects missing or changed FTN values, wrong season/week joins, ambiguous outcomes and inconsistent yardage. [Source hashes and checks](teaching-examples-audit.json) are preserved. Desktop light and 390×844 mobile dark browser checks exercised worked example → different-game question → answer → explanation, with no horizontal overflow or JavaScript errors. A browser download preserved both synthetic QA answers. The isolated browser again could not fetch the external ESPN schedule; this did not prevent the static practice flow and is not a live-feed validation. Final repeat-target accounting has a focused regression test. The local browser and server are closed.

This is evidence interpretation from written facts and illustrations, not video recognition. It enables voluntary testing on another example; it does not establish learning gains. Current coverage is eleven NFL plays and one college play, with no claimed college formation charting. Production verification: app commit `4f5f0fb` and reset-label follow-up `a3b38de` are pushed. Final preview `dpl_3HiWZ2hx14fVukhWAnEWes6kc9DH` and production `dpl_BU9zsnL2sN4ZSNUygAc4spuLUr8h` are READY. The production URL `https://football-companion-hfjz1j9rg-nates-projects-925609f4.vercel.app` has the fluentin.football and rose aliases. Local, preview and public build ID `e181d80cf1040793a013c105cc505ef7f5ccf83e6a9ba2ec5673e6cf4084f47b` matches. Actual public index, practice module, depth UI/CSS, example bank and app hashes match the manifest. A fresh production browser opened the four-rusher example and a different-game five-rusher question, with FTN attribution/license visible in Sources, default `game`, the final scroll padding and no overflow or JavaScript errors. The isolated verification browser is closed. Game settings now explicitly say Reset picks and term history, distinguishing that control from clearing historical practice.

**Expanded coaching study**

The [three-caller transfer study](COACHING-TRANSFER-RESULTS-2026-09-06.md) is complete for Payton, Moore and Arthur Smith using the fixed NFL method. It covers 9,977 held-out plays in 158 games across six transfer stints; first seasons at new teams account for 5,593 plays in 87 games. Career, tenure and the fixed blend do not establish a reliable probability-error improvement over team history. All pooled and per-caller career comparison intervals include zero. Passer identities and counts are joined to exact raw records to make personnel changes visible; they are descriptive, not causal controls. The source catalog distinguishes actual caller roles and does not substitute head coaches. Thirty Python tests pass. Live probabilities remain unchanged.

The warranted decision is to keep coaching forecasts out of production pending stronger evidence. The NFL study does not answer the college transfer question or provide a complete current-staff database. Ben Johnson and Mike Denbrock remain research leads, not assigned callers in this catalog.

**Fourth checkpoint: updates between plays**

Clock, score, season and source-clock-health changes now refresh the existing read through the TV-delay queue even if the next down, distance and spot stay identical. A different source play with the same end position still advances to a new snap. Context-only refreshes do not open new questions or increment teaching exposures; an existing question is voided only when its read changes. A new read can enter the cooldown, but repeated clock updates retain the current read without consuming the six-read window. The journal and audit distinguish context refreshes.

The scoreboard now receives its own ordered, delayed snapshots. It can update between plays instead of remaining tied to the last play’s old clock and score. Missing scores stay unknown, final status waits for the delay, and team-logo elements stay attached across updates.

Validation: 201 JavaScript tests pass, including a clock boundary, score correction, missing season becoming available, same-position new play, catch-up, corrected pending reports, final status, and journal refresh accounting. A browser fixture using saved Oregon/Boise reports with a synthetic Q4 clock/score transition held 5:01 and a 3-point lead for the configured delay, then showed 4:59, a 7-point lead and the corresponding clock read together. Its journal reproduced both reads; desktop and mobile dark mode had no overflow or browser errors. This fixture validates behavior, not actual game timing. Production verification: app commit `f629952` is pushed; preview `dpl_Cv22N9dRUt8uNBdHLBsdhEDTHAEM` and production `dpl_BMmQV4bufvwZCHpaSqSVDqYZeqjc` are READY. The production URL `https://football-companion-4gb784a7x-nates-projects-925609f4.vercel.app` has the fluentin.football and rose aliases. Local, preview and public build ID `bae3d6fe66184ed620716324aa8393d526c39ecc8c15f85632042cfe5a7f96e2` matches, and actual public app/index hashes match the manifest. Replay files were removed by the clean build; local server and isolated browser are closed.

**Third checkpoint: previous-season team and opponent comparisons**

The `read-3` selector can now use descriptive 2025 outcomes in 2026 games. A collapsed **Past games** disclosure shows the offense and opposing defense in matching down, distance, field, score and clock bands. Relevant third-down comparisons and early-down short-run counts can supply the main read; current-game patterns and urgent decisions retain priority. The default remains Read the game, with an explicit Beginner choice.

Profiles require 20 plays across 5 games. Individual conversion and yardage measures also have known-outcome thresholds; unclear results do not become failures. NFL conversions join the original nflverse game/play IDs and possession team. College penalties and fumbles with unclear possession remain unknown, and interception return yards do not enter offensive gain counts. These are counts, not fitted probabilities, opponent-adjusted rankings or causal run/pass recommendations. The separate live probability tables remain unchanged.

The game’s reported season and season type travel through the existing delay queue. Profiles are eligible only for the following season’s regular/postseason games; missing, preseason, older or stale season context suppresses them. The module receives approved context and static aggregates, not raw live reports. Exact dataset/team/context references and disclosure text are saved in the journal. Offline replay explicitly reports missing historical datasets as unverifiable.

Validation: 194 JavaScript tests and 27 Python tests pass. Python/browser context keys agree on all 34,032 distinct NFL and 119,354 distinct college archived contexts. See `history-profiles-audit.json` for source hashes, coverage and export sizes. A source-derived Oregon–Boise replay displayed Boise State’s 17/49 third-down conversions alongside 7/32 allowed by Oregon. Its browser journal reproduced the read using the matching dataset, with no missing support. Desktop and 390×844 mobile light/dark checks showed no overflow or JavaScript errors. The transport was mocked from saved reports; this is not evidence of live usefulness or improved predictions.

Third release production verification: app commit `b5f61b8` is pushed. Preview `dpl_7BDKRtWraYd7DMZunU7BBAmRQA5p` and production `dpl_3Au42qYdp3fCnyJhqheeweeC6hJw` are READY. The production URL is `https://football-companion-2xcdx1l5z-nates-projects-925609f4.vercel.app`, aliased to fluentin.football and the old rose URL. Local, preview and public build ID `d47c67cd503ff7b4501912a755fee72f5d4d1f9e240d87d1e67688d25d48f7fc` matches. Public app, read selector, history lookup/render modules, both profile datasets and index response hashes match the local manifest. The clean build excludes replay files; isolated browsers and the local server are closed. Wider play-caller research, more recognition examples, prospective evaluation and the optional paid-source trial remain outstanding. The between-play refresh issue identified here is resolved in the fourth checkpoint.

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

1. The separate NFL/college fit, calibration review, source-alignment audit, client parity and frozen forecast replay are complete. The candidate remains research-only pending a prospective live-data gate; the old live model remains the comparison. Current exports provide zero prospective observations.
2. The first descriptive team/opponent comparison is implemented and verified in the third checkpoint. Extend current-game comparisons only where the same outcome definitions and adequate samples support them; do not imply causal effects or opponent-adjusted weakness.
3. The expanded three-caller NFL study is complete and remains inconclusive for forecasting benefit. Dated descriptive coaching context and college-specific transfer research are possible follow-ups; do not imply that the current catalog covers every team or today’s staff.
4. The expanded twelve-play bank and six different-game practice pairs are implemented in the fifth checkpoint. Collect voluntary practice exports to evaluate whether the explanations help; successful QA answers do not establish learning gains.
5. Both explanation and forecast audits have run on the two available real viewer exports. Those exports predate the new selector/freeze and contain no usefulness ratings. Obtain later voluntary exports, review their actual feedback and compare frozen candidates on untouched games. The local QA journal is not a substitute for those observations.
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
