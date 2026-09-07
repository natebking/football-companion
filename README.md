# Fluent in Football

A second screen for following a football game and learning what to watch. [Open Fluent in Football](https://fluentin.football/).

The two-F logo follows connected player routes: a rounded first F flows into a taller second F, with one starting dot and one forward arrow. Light and dark assets are `web/brand-mark.svg` and `web/brand-mark-dark.svg`. The header colors and matching favicon follow the selected appearance.

The app puts a concrete watching suggestion first, with the next down, field position, and historical run/pass choices nearby. Completed plays include reported players and direction when available, plus the next down, possession change, or scoring outcome. The original ESPN report stays available, and penalties open that report by default. Corrections update existing plays in order; repeated unreliable clocks are flagged.

Open **Understand this play** for the meaning of a gain and, when verified, the yards through the air versus after the catch. The drive story separates progress on plays from penalties. **So far in this game** shows observed player involvement and direction with coverage counts. These views use the full released history, even though the visible feed keeps only the latest 25 rows.

**Read the game** is the default teaching level. Its main card prioritizes consequential score/clock decisions and supported patterns from released plays, including repeated targets, long third downs, drive penalties and sacks. Relevant previous-season team/opponent counts are available in **Past games**, when enough comparable data exists. **Beginner** is an explicit, remembered choice in Games for learning rules and basic terminology. Both levels use plain language and definitions on tap. The default allows a quiet waiting state instead of filling space with a generic lesson.

**See the idea** opens an illustrative diagram and an optional observation question. Answers are self-reported, never checked against the feed or treated as mastery. **Explore past plays**, near the footer, offers twelve source-checked examples from nflverse, FTN Data, and CollegeFootballData, with source and license links. Six practice pairs ask about a play from a different game. The separate, downloadable practice history preserves first answers and prior exposure; it does not measure mastery or video recognition.

Choose a game, measure or set a TV delay, and use light, dark, or system appearance. Occasional predictions are optional. Their scores are separate from the history of terms seen; full definitions stay on unless the reader chooses shorter hints. There is no fixed bottom bar.

Use **Match TV** below the field to choose whether the current offense is attacking left or right. The ball, first-down line and defended ends follow that view. The app remembers it for the game, reverses the ends for the second and fourth quarters, and asks for a new match after halftime or at the start of each overtime period. **Flip field** reopens the direction choices.

**Game journal** saves source revisions, released play explanations, exact watching prompts and optional observations in this browser. Journals survive reloads and can be downloaded or removed. Storage is bounded and reports failures; it never silently removes old games. The old Vercel address and the new domain have separate browser storage.

Open **post-game review** only when finished watching. Any saved game can request ESPN's final report; published college reviews also join available CFBD passing and rushing detail by exact game/play/offense IDs. The first enriched review is Boise State at Oregon. Reviews highlight different lessons, compare recorded explanations with later facts, and retain unmatched/missing data. Added detail is separated from corrections. Historical sessions from before journaling cannot be reconstructed.

The completed [context evaluations](docs/CONTEXT-RESULTS-2026-09-06.md) found lower held-out historical probability error with score/time context in separate NFL and college studies. The expanded [three-caller transfer study](docs/COACHING-TRANSFER-RESULTS-2026-09-06.md) did not establish a reliable forecasting benefit from coaching history. [Frozen forecast replay](docs/FORECAST-REPLAY-RESULTS-2026-09-06.md) now compares candidates on original saved pre-snap inputs. The existing journals provide development examples, not prospective evidence. Production probabilities are unchanged.

The [practice-export audit](docs/PRACTICE-AUDIT-2026-09-06.md) checks source versions and separates first recorded attempts from repeats, unknown history and unanswered questions. Its available QA export is not evidence of viewer learning.

## Data and limits

The static app polls ESPN directly in the browser. Historical tendencies ship as JSON; they describe past situations, not the next play's formation or strategy. Richer live details vary by game. Missing routes, coverage, or assignments are not inferred. All explanations are deterministic, with no runtime AI calls or backend.

Both shipped tendency tables now cover 2023–2025. The NFL refresh adds 104,878 eligible plays, but its chronological test found no reliable forecasting advantage over a situation-only baseline. Treat the percentages as descriptive history. See the [data refresh and source audit](docs/DATA-REFRESH-2026-09-05.md) for results, reproduction commands, and access limits. CFBD live requires a higher subscription tier; Sportradar is not connected. Public FTN charting supplies historical lessons, not live tactical observations.

## Develop and verify

The live app is in `web/`. The root `index.html` is the frozen broadcast-timing instrument, published at `/stopwatch`.

```sh
node scripts/build-web.mjs
python3 -m http.server 8765 --bind 127.0.0.1 --directory .vercel-build
node --test tests/*.test.js
.venv/bin/python -m unittest discover -s tests -p 'test_*.py'
```

The tests cover curated real ESPN plays, scoring and penalty edge cases, prediction grading, and request races. The interface also needs browser verification against a live game after changes.

To check logo stability, serve the repository root with `python3 -m http.server 8765 --bind 127.0.0.1` and open `/tests/logo-rendering.html`. These browser checks exercise the actual rendering functions through repeated refreshes, score and delay changes, game reordering, and image failures. Logos and focused game buttons must remain in place as their text updates.

- [Live broadcast audit](docs/LIVE-BROADCAST-AUDIT-2026-09-06.md): observed Louisville–Ole Miss misses, better candidate explanations and timing limits; no new app release.
- [Formation-analysis feasibility](docs/FORMATION-ANALYSIS-FEASIBILITY-2026-09-06.md): what a visual prototype could recognize, current source limits and how to test timing and accuracy (planned).
- [Next live-analysis pass](docs/LIVE-ANALYSIS-NEXT-PASS-2026-09-06.md): current product gaps and linked post-play explanations (planned).
- [Review follow-up](docs/REVIEW-FOLLOWUP-2026-09-06.md): resolved findings, current fixes and remaining research.
- [Data and privacy](web/data.html) and [third-party notices](NOTICE.md): data sources, adaptations and what stays in this browser.
- [Build contract](docs/CONTRACT.md): interfaces, statistical validation, and truth boundaries.
- [Context brief](docs/context-brief.md) and [prompt scaffold](docs/prompt-scaffold.md): original design and future ideas, including up to four feeds.
- [Deployment](docs/DEPLOYMENT.md): shared Codex and Claude deployment setup and troubleshooting.

```sh
vercel deploy --prod --yes --scope nates-projects-925609f4
```

Vercel project: `football-companion`. Git pushes alone do not deploy this project.

## Publish an enriched college review

```sh
.venv/bin/python engine/export_game_review.py --game 401858433 --team Oregon --year 2026 --refresh
# Or find a team's finished game today:
.venv/bin/python engine/export_game_review.py --recent --team Oregon --refresh
```

This uses the existing private CFBD key, caches raw source versions under ignored `data/`, and writes public facts to `web/reviews/`. Publish those files with the app. Other games can still be reviewed against ESPN directly; richer CFBD fields arrive only after the export is refreshed. This task does not add a paid feed or background collection service.

Builds produce a SHA-256 manifest for the deployed assets. Each journal entry records its build fingerprint and historical-table period, enabling later analysis of the version actually shown. See [journal implementation and verification](docs/JOURNAL-2026-09-05.md).
