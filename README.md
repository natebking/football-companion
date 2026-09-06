# Fluent in Football

A second screen for following a football game and learning what to watch. [Open Fluent in Football](https://fluentin.football/).

The two-F logo follows connected player routes: a rounded first F flows into a taller second F, with one starting dot and one forward arrow. Light and dark assets are `web/brand-mark.svg` and `web/brand-mark-dark.svg`. The header colors and matching favicon follow the selected appearance.

The app puts a concrete watching suggestion first, with the next down, field position, and historical run/pass choices nearby. Completed plays include reported players and direction when available, plus the next down, possession change, or scoring outcome. The original ESPN report stays available, and penalties open that report by default. Corrections update existing plays in order; repeated unreliable clocks are flagged.

Open **Understand this play** for the meaning of a gain and, when verified, the yards through the air versus after the catch. The drive story separates progress on plays from penalties. **So far in this game** shows observed player involvement and direction with coverage counts. These views use the full released history, even though the visible feed keeps only the latest 25 rows.

**Read the game** is the default teaching level: 11 lessons on defensive reactions, space, leverage, protection, and where yards come from. **Start with basics** keeps the original eight introductory lessons available in Games. Both levels use plain language and definitions on tap.

**See the idea** opens an illustrative diagram and an optional observation question. Answers are self-reported, never checked against the feed or treated as mastery. **Explore plays** offers six real examples from nflverse, FTN Data, and CollegeFootballData, with source and license links.

Choose a game, measure or set a TV delay, and use light, dark, or system appearance. Occasional predictions are optional. Their scores are separate from the history of terms seen; full definitions stay on unless the reader chooses shorter hints. There is no fixed bottom bar.

**Game journal** saves source revisions, released play explanations, exact watching prompts and optional observations in this browser. Journals survive reloads and can be downloaded or removed. Storage is bounded and reports failures; it never silently removes old games. The old Vercel address and the new domain have separate browser storage.

Open **post-game review** only when finished watching. Any saved game can request ESPN's final report; published college reviews also join available CFBD passing and rushing detail by exact game/play/offense IDs. The first enriched review is Boise State at Oregon. Reviews highlight different lessons, compare recorded explanations with later facts, and retain unmatched/missing data. Added detail is separated from corrections. Historical sessions from before journaling cannot be reconstructed.

The completed [coaching/history pilot](docs/COACHING-PILOT-2026-09-05.md) tested eight NFL seasons and verified actual play-calling roles. Score/time context helped offline; extra years alone did not, and one caller's career transfer remains inconclusive. Production probabilities are unchanged.

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
