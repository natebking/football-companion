# Claude review follow-up — September 6, 2026

The [September 5 review](REVIEW-2026-09-05.md) describes commit `c849c7d`. This reconciliation starts from `6a6c355` and checks the current implementation. Its suggestions are review evidence, not standing instructions. Nathan’s later choices take precedence: **Read the game remains the default**, Beginner is optional, and team logos and the TV-oriented field stay.

## Implemented in this pass

- **Choose before watching.** Boot, league changes and scoreboard refreshes no longer choose the first live game. Only a saved, unfinished game is restored. If that game is missing or finished, choose another explicitly. The unselected header says “Choose a game.”
- **A stated starting delay.** A new browser starts at 45 seconds with “Sync TV” and an explicit unmeasured-estimate explanation. It is not a promise of synchronization. Existing explicit settings, including zero, remain intact. Selecting the same 45 seconds explicitly saves that choice. Manual adjustment confirms a setting; it is not labelled a measurement. Scores in Games remain hidden whenever delay is nonzero.
- **Short help and separate Settings.** How it works opens with three steps. Reference material stays in a disclosure. Games contains the schedule, search and a link to Settings; the footer also opens Settings. Troubleshooting hides the diagnostics and build details until requested. Dialogs become focusable immediately on opening; only opacity animates, preventing focus from remaining behind a panel during its visibility transition. Reduced-motion handling is preserved. Teaching level and prediction questions retain their existing behavior.
- **Less diagnostic storage work.** Consecutive unchanged polls are compacted into one record retaining first/last timestamps, poll count, and latest/maximum response gap. State, clock, source, correction, queue and resumption changes still produce distinct events. Writes happen every 30 seconds when dirty, and on page hide or backgrounding, instead of every two seconds. A sudden browser crash can lose the unflushed interval. Export still uses the in-memory records.
- **Visible source information.** Tendency chips name nflverse or CollegeFootballData and link to the new Data and privacy page. FTN-derived examples and practice show an adaptation notice outside the collapsed source disclosure. [NOTICE.md](../NOTICE.md) records source-specific licences and modifications. No bank records or model tables were changed.
- **Handoff corrections.** Removed the instruction to copy a competitor’s prose merely because it is public. Marked prior-art claims as historical and unverified; marked the original context brief as superseded by the contract. Corrected the older product review’s NFL season statement to 2023–2025.

## Findings already resolved before this pass

| Review concern | Current evidence / limit |
|---|---|
| Undelayed scores in Games | Existing `renderPicker` hides non-upcoming scores whenever TV delay is on. Header and play outcomes use the delayed queue. |
| Corrected play moves to the back of the queue | Existing correction replaces the queued record in place. A regression checks order and the correction’s full delay. |
| Unrelated hashed teaching prompt overrides the read | The situation/evidence selector now owns the main read; matched lesson details are secondary. Prediction questions default off. |
| Entire recent-play list pushes other content away | Recent plays is shortened with expansion; past-play entry is in the footer. |
| Need actual historical practice | The bank now has 12 examples / 6 pairs and a source-versioned practice history. The audit separates first recorded exposure, repeat and unknown history. This is smaller than the review’s proposed 20–40 examples. |
| Need action-conditioned consequences | Past games already separates run/pass gain counts and conversions with sample/coverage gates. This is descriptive context, not a recommendation of which action would cause a better result. |
| Need richer context research | Score/clock candidates are evaluated offline and frozen for prospective replay. They have not replaced live probabilities. See the [forecast replay protocol](FORECAST-REPLAY-PROTOCOL-2026-09-06.md). |
| Tie tendencies to coaching staff | Expanded coaching analysis exists. It has not established a reliable transferable advantage, so no unsupported coaching adjustment is shipped. |

## Still worth doing, in order

1. **Test the actual displayed probabilities.** Run the frozen prospective evaluation, separately by league. Measure calibration overall and where the app names a team, using only the pre-arrival context actually available. The old review’s attribution slopes and rolling-week results lack retained reproducible scripts; do not report them as established findings. Weekly refits and static preseason fits are different protocols.
2. **Test effective sample size as a separate candidate.** The current rate uses recency weights but shrinkage uses raw counts. The shrinkage parameter was fitted under that convention; swapping counts alone is not a valid repair. Specify a weighted effective sample definition, refit on a training/validation split and compare against the frozen baseline on a new holdout. Internal confidence flags describe sample contribution, not certainty of the next play.
3. **Collect voluntary usefulness and practice exports.** Existing tooling can audit saved guidance and first answers. Current QA samples establish the workflow only. No real viewer learning improvement or prospective forecasting gain has been demonstrated. Avoid grading recorded action as coaching intent; historical sacks are pass plays, while an observational throw/run quiz can legitimately void a sack if it did not ask about dropbacks.
4. **Improve discovery with useful static pages.** Pre-render selected glossary, lesson and historical-example pages, then add sitemap/robots and social metadata. Source-specific statistics must come from the actual tables with matching definitions and timestamps; the tables do not contain punt frequencies. Do not promise search rankings or citation lift. Domain aliases and `www` need a separate configuration check.
5. **Resolve ongoing provider access.** The undocumented ESPN live feed remains a reliability and access dependency. Attribution is not permission or an SLA. Keep the requested logos while investigating supported access and any necessary rights; the notice does not settle those questions. A licensed college live source requires account access and freshness/coverage tests before integration. No subscription was started.
6. **Close the refresh-to-deployment gap.** The existing GitHub workflow commits refreshed tables but this Vercel project has no Git deployment integration. A push alone is not a public refresh. Automation should validate candidate tables before intentionally deploying them; the current frozen research candidate must remain unchanged.

Central analytics, opt-in uploads, public repository visibility and outbound promotion are separate product decisions. This pass adds none of them. The app still does not automatically upload journals, practice logs or diagnostics.

## Source and prose checks

Primary documentation checked September 6: [nflverse licence](https://github.com/nflverse/nflverse-data/blob/main/LICENSE.md), [FTN charting documentation](https://nflreadr.nflverse.com/reference/load_ftn_charting.html), [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), [CollegeFootballData terms](https://collegefootballdata.com/terms). The notices distinguish transformed analysis from raw data and team marks. No conclusion about all upstream rights is claimed.

A targeted phrase check of `cards.json`, `learning.js`, `game-read.js` and `teaching-examples.json` found none of the competitor-script fragments quoted in prior-art (including “wrong a lot,” “count the safeties,” “check your read,” “corner depth,” and the hypothetical 70% formation wording). This is a limited check against the quoted material, not a complete originality or copyright audit. No competitor guide was copied during this pass.

## Validation

All 235 JavaScript tests pass. Six new tests cover first-visit defaults, explicit zero preservation, confirming the starting value, boot/league restoration, no automatic scoreboard selection, diagnostic compaction, and timer/background persistence. Existing tests continue to cover delay isolation and in-place corrections. No estimator or Python behavior changed.

Browser verification uses isolated sessions and controlled ESPN fixtures, not the user’s browser history or a live broadcast. New visitor: no selected game or summary requests; Read the game default; Sync TV; picker scores hidden. Explicit selection holds the score behind the delay; choosing zero saves and releases it. Desktop light / mobile dark checks cover the separate Settings panel, concise help, source page and responsive layout. These checks establish application behavior, not TV synchronization accuracy or learning outcomes.

## Deployment

App commit `15e5b37` is pushed to main. Final preview `dpl_2QfGw4M45KhG2QTAXz51avzzqudU` and production `dpl_Erp1vcr2QUyTJo4nDhgebCXJ6c2m` are READY. The production URL is `https://football-companion-e629vsu8c-nates-projects-925609f4.vercel.app`, with fluentin.football and the rose alias attached.

Local, final preview and public manifest match build `466bec1f0c4fc6f5bde130ed5a5f32868642063eb91afb71961387f95478ea53`. The actual public index, app, stylesheet, theme, depth UI and data page separately match their SHA-256 manifest entries. No QA assets appear in the clean build. The earlier preview was superseded before promotion to include the keyboard-focus fix.

An isolated production browser with controlled source fixtures confirmed no initial game-summary requests, Choose a game, Sync TV, Read the game, hidden picker scores, and Settings opening with focus on its Close button. No JavaScript errors or horizontal overflow were detected. The local mobile checks also confirmed explicit zero-delay persistence across reload, source-chip wrapping, the visible FTN adaptation notice, and the data page in dark mode. These remain behavior checks with mocked source reports, not evidence of live feed accuracy.
