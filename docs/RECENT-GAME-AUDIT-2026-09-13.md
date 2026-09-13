# Recent final-report audit — September 13, 2026

The repeated player suggestions are reproducible with current `read-5`. In six recent college games, 545 of 856 selected reads (63.7%) highlighted a player; 431 of those 545 (79.1%) highlighted runners. On 251 of 545 player steps (46.1%), the immediately preceding replay step highlighted the same player and that player's reported involvement had not increased. This includes changes in the run/throw denominator when somebody else received the ball. On 161 player steps (29.5%), all three displayed read strings were identical to the preceding step.

These are **reconstructed final-report prefixes**, not saved live viewing experiences, measurements of attention, predictions, or evidence of improved learning.

## Selection and denominators

The sample was selected before inspecting selector output: six college finals covering September 7, Thursday, Friday and Saturday, close/high-scoring/low-scoring/blowout games, plus both NFL finals returned by the September 7–12 scoreboard. It is purposive and not representative. Dates below are kickoff dates in Eastern Time. Saturday games finishing Sunday remain Saturday games; no September 13 NFL finals were sampled.

| Game | ESPN event | Date | Unique reports | Replay steps | Offensive action steps | Selected reads | Player reads | Same player, no new involvement |
|---|---|---|---:|---:|---:|---:|---:|---:|
| SMU at Florida State | 401858212 | Sep 7 | 173 | 164 | 131 | 143 | 99 | 44 |
| Missouri at Kansas | 401856678 | Sep 11 | 191 | 179 | 135 | 157 | 110 | 46 |
| Ohio State at Texas | 401856682 | Sep 12 | 189 | 169 | 140 | 153 | 106 | 47 |
| Oklahoma at Michigan | 401856679 | Sep 12 | 168 | 156 | 117 | 138 | 71 | 31 |
| Oregon at Oklahoma State | 401856782 | Sep 12 | 195 | 184 | 141 | 152 | 98 | 49 |
| Florida A&M at Miami | 401858213 | Sep 10 | 171 | 152 | 117 | 113 | 61 | 34 |
| New England at Seattle | 401872656 | Sep 9 | 179 | 150 | 112 | 95 | 0 | 0 |
| San Francisco at Los Angeles Rams | 401872657 | Sep 10 | 169 | 144 | 119 | 72 | 0 | 0 |

The 1,435 final reports contain 145 markers and no duplicate play IDs. The 1,298 replay steps exclude markers except the terminal game step; they include kicks, penalties and other reports and must not be called 1,298 snaps. “Offensive action” uses current Insights' eligible run/pass/sack play IDs; clock plays and uncertain/no-play penalties are excluded. The 781 college and 231 NFL eligible actions are a parser-defined denominator, not an independent official snap total.

Each prefix uses `FootballReplay.prepare/snapshot`, the exact current `app.js` `preSnap` whitelist functions executed in an isolated VM, current `FootballInsights.summarize/forRead`, `FootballHistory.lookup` and `FootballRead.select`. Only prefix reports and prefix score/status enter the selection. Original drive/report order is preserved; IDs are not sorted numerically. Supporting play IDs must all be inside the prefix; selected priority must equal the top eligible candidate. The script also compares sequential recent keys with empty history because the replay page resets state at every seek. **All 1,298 cold/reset selections matched sequential selections** in this sample. This checks selector outputs, not the full browser/queue pipeline.

## Why the repetition feels stale

The selector intentionally retains the best supported read despite recent display. Game-player priority is 90 and drive-player priority is 93, above `long_thirds` (75), goal-to-go (65), ordinary third-down distance (60) and second-and-long (55). On 232 of 545 college player steps (42.6%), at least one of those current situational reads was eligible and ranked below the player read. This is a priority-policy finding, not proof that every alternative would be more useful.

Ohio State–Texas, Q2: ESPN reports `401856682211` through `401856682266` produce **13 consecutive player steps for #2 H.Smothers**, spanning the source's 13:17 through 7:02 clocks. At `211`, the read is “4 of 5 reported runs in this game have gone to #2 H.Smothers.” The next three reports (`215`, `221`, `226`) are passes and display the same count and instruction. At `254`, an incompletion leaves second-and-ten; the card remains the drive runner with “4 of 6 reported runs on this drive.” At `257`, a reception leaves third-and-one and the same runner read remains. Some subsequent carries add evidence, so the entire streak is not an unchanged card. No runner focus appeared on third-and-seven or longer anywhere in the college sample.

Miami–Florida A&M, reports `401858213351` through `401858213378`: six consecutive steps highlight #4 M.Fletcher Jr., while his involvement stays at seven reported carries and Miami's denominator grows from 13 to 16 runs. This is a supported historical workload statement, but its observation does not become more specific as the drive develops. The literal abbreviated names/numbers also make the instruction harder to recognize than a full roster name; the audit does not establish who was on the field.

Recommended product evaluation: treat a stable player cue as context and make the primary observation respond when the current down/drive introduces a more concrete question. Test evidence age in eligible offensive actions, current-drive involvement and materially changed situations; compare against the existing selector on untouched later games. Avoid merely rotating names, blanking supported context or assuming a player participated in a snap. Link any retrospective explanation to the actual prior prompt, including a clear statement when that player was not named in the next report. These are proposals, not production algorithm changes in this audit.

## Latest-play detail and source gaps

College: a `gameSummary` exists for every eligible action; a `gameConsequence` exists for 777/781 (99.5%). A separate, richer `takeaway` exists for 173/781 (22.2%). Those fields must not be conflated: an empty takeaway can still have a useful next-down explanation. OSU–Texas `40185668239` explains a catch at the line followed by six yards after the catch. `40185668284` explains seven air yards plus sixteen after the catch, totaling 23. In SMU–FSU, 0/131 eligible actions have a takeaway despite 131/131 having a consequence; the report style does not provide the same reconciled catch-spot components. Missing takeaway alone is not a failed explanation.

**Baseline NFL parser defect (high confidence):** both games have zero named targets/carries in Insights, even though reports contain literal names. Across four offenses this is 0/117 eligible throws and 0/109 eligible runs. Verb-less NFL run reports and NFL passes omitting “complete” are not handled by `reportedPlayers`; parenthesized `(Shotgun)` also prevents anchored name matching. The naming-coverage gates then correctly suppress every player read, leaving 114/281 valid-situation NFL steps quiet (40.6%). College's corresponding quiet count is 73/929 (7.9%). This comparison is descriptive and confounded by game and report-style differences.

Exact reproductions in NE–SEA: `40187265664`, type Rush, “J.Price right tackle to SEA 37 for 13 yards (K.Byard; E.Ponder).”; `40187265686`, Pass Reception, “S.Darnold pass short middle to J.Smith-Njigba to 50 for 13 yards (R.Spillane).”; `401872656157`, Pass Incompletion, “(Shotgun) S.Darnold pass incomplete short right to R.Shaheed.” Baseline `FootballPlay.describe` returns an empty `players` string for each. A bounded factual parser repair should recognize the leading actor and explicit pass recipient, retain unknown recipients, and keep tacklers, sacks, scrambles and no-play penalties out of receiver-target counts. It should not relax naming thresholds.

## Saved journal evidence

The newly downloaded OSU–Texas final journal contains 189 source revisions/releases and **zero saved guidance moments or usefulness ratings**. It supplies no recorded live suggestions to audit. This does not prove zero app usage or a broken journal.

The downloaded Louisville–Ole Miss journal has 318 source revisions, 499 releases, 32 distinct guidance moments (including quiet guidance), 17 recorded reads and zero usefulness ratings. All 17 recorded reads use older `read-3`, so current `read-5` wording cannot be evaluated as a reproduction of what was shown. The raw export has 19 read-bearing render rows; the audit coalesces disclosure/visibility re-renders into teaching moments. These journals do not provide current-version live evidence for the recent-game repetition rate.

## Reproduce and inspect

Run `node scripts/audit-recent-games.mjs`; optional `--refresh` refetches finals, `--out path` chooses the audit JSON, and repeatable `--journal path` inputs audit saved journals separately. For the observed exports:

```sh
node scripts/audit-recent-games.mjs --journal /Users/nking/Downloads/football-journal-cfb-401856682.json --journal /Users/nking/Downloads/football-journal-cfb-401856661.json
```

Ignored `data/qa/recent-games-2026-09-13/` contains cached ESPN scoreboard/summary receipts, exact source URLs/retrieval times, private journal copies, full per-prefix rows and source/module SHA-256 hashes. `audit-baseline.json` freezes the above pre-repair measurements. This report and the script are tracked; raw reports and journals remain ignored. Validation: Node syntax check and cached full audit with prefix-support and top-priority assertions passed.

Sources: [college final reports, OSU–Texas](https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary?event=401856682), [NFL final reports, NE–SEA](https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=401872656), plus the eight exact game URLs in the cached audit. Final reports can contain later corrections; source clocks are prefix state, not reconstructed report-arrival times. The snapshot never establishes TV synchronization, current lineup, formation, intent, pressure causation, forecasting skill or viewer learning.

## Bounded NFL parser repair and after-repair check

A factual parsing repair now accepts parenthesized `(Shotgun)`, `(No Huddle)` and `(No Huddle, Shotgun)`, NFL runs that put a leading carrier directly before a reported run location, and passes that omit the word “complete.” It reads only explicit names and does not fetch rosters, relax naming gates or change selector priorities. Run-location extraction requires a run report type. Tacklers, unnamed incomplete-pass recipients, sacks and no-play penalties do not become targets; scramble actors remain runners. Explicit “intended for” on an interception remains outside this bounded recipient parser and is not guessed from the interceptor or tackler.

| NFL coverage across the same two games | Frozen baseline | After factual repair |
|---|---:|---:|
| Named eligible runs | 0/109 | 109/109 |
| Named eligible throws | 0/117 | 109/117 |
| Player-read steps | 0/294 | 189/294 |
| Quiet valid-situation steps | 114/281 | 20/281 |

These changes are coverage improvements on the inspected sample, not calibrated attention recommendations. The repaired NFL output also repeats: 84/189 player steps have the same preceding player without new involvement, and 59/189 repeat all three strings. The broader repetition-policy concern remains.

All **1,004 college per-prefix rows** (selected read, wording, context, support IDs and latest-play explanations) match the frozen baseline exactly. Existing college suffix punctuation is preserved. Full post-repair outputs and module hashes are under ignored `audit-after-parser.json`; the baseline remains unchanged. Focused report-name and downstream aggregate/revision tests were added; **103 tests passed** across play facts, insights, reads and journal audits. The new tests include literal run/pass/incomplete/sack/scramble/interception report text, missing receiver names, tacklers, no-play penalties and a correction that removes a previously named target without increasing the throw denominator.

This follow-up changes `web/play-facts.js` and its focused tests only; no production selector, historical dataset, paid source or forecast model was modified by the audit worker.

## Replay access and release verification

The homepage no longer promotes Louisville–Ole Miss. **Games → Finished games** now has a date picker, College/NFL selection and the existing team search. Live and upcoming games stay in their own view. Final results stay hidden in the replay list. Selecting a finished game fetches its final summary once and opens `?replay=cfb:EVENT_ID` or `?replay=nfl:EVENT_ID`, starting before the first report, with quarter/OT jump points. Games without final play reports show an explicit unavailable message; no demo game is silently substituted.

The adapter sanitizes report fields and rebuilds scores, player counts, drives and status at each selected prefix. It handles a final drive still under `current` and a missing terminal marker without borrowing final scores from the header. Replay remains separate from saved live guidance, predictions, term exposure and TV delay. The original Louisville dataset was moved to `tests/fixtures/`; it is no longer shipped as the sole replay option. The exporter now reproduces that test fixture.

ESPN's `limit=1000` silently returned 25 September 12 college events during checking; `limit=200` returned 80. The picker now uses the verified 200 limit with explicit FBS group 80 for college. Both responses and exact URLs are recorded under ignored `data/replay-validation/`. College here means ESPN's FBS schedule, not every college division. Availability still depends on the source.

All **281 Node tests** pass, including archive request races, invalid dates, final-summary validation, future-score isolation, backward seeks and the factual parser fixes. The browser logo/picker harness passes **13 checks**, including team search and hidden final results. Real Chrome verification loaded Ohio State–Texas, Louisiana Tech–LSU and 49ers–Rams from ESPN, tested searching LSU and California, changed date/league to find the NFL game, and checked final-to-quarter backward seeks. The NFL replay displayed the repaired carrier and recipient names. Phone layouts were reviewed in both themes. A headless browser could not reach ESPN in this environment, so successful live-source UI checks use ordinary Chrome; the unavailable state was also verified.

The release audit was rerun against all eight cached sources with the two downloaded journals, preserving the baseline separately. These checks validate data extraction and replay behavior; they do not establish live usefulness or solve the repetition-policy issue.
