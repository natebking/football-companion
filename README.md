# Football Companion

A second screen for following a football game and learning what to watch. [Open the companion](https://football-companion-rose.vercel.app/).

The app shows the next down and field position, historical run/pass tendencies, a short watching suggestion, and recent plays. Completed plays include reported players and direction when available, plus the next down, possession change, or scoring outcome. The original ESPN report stays available, and penalties open that report by default.

Choose a game, set a TV delay, and use light, dark, or system appearance. Occasional predictions are optional. Their scores are separate from the history of terms seen; full definitions stay on unless the reader chooses shorter hints. There is no fixed bottom bar.

## Data and limits

The static app polls ESPN directly in the browser. Historical tendencies ship as JSON; they describe past situations, not the next play's formation or strategy. Richer live details vary by game. Missing routes, coverage, or assignments are not inferred. All explanations are deterministic, with no runtime AI calls or backend.

Current shipped tables cover CFB 2023–2025 and NFL 2024. The successful refresh dry-run on September 5 did not publish newer data. See the [product review](docs/PRODUCT-REVIEW-2026-09-05.md) for evidence, decisions, and remaining limits.

## Develop and verify

The live app is in `web/`. The root `index.html` is the frozen broadcast-timing instrument, published at `/stopwatch`.

```sh
python3 -m http.server 8765 --bind 127.0.0.1 --directory web
node --test tests/*.test.js
```

The tests cover curated real ESPN plays, scoring and penalty edge cases, prediction grading, and request races. The interface also needs browser verification against a live game after changes.

- [Build contract](docs/CONTRACT.md): interfaces, statistical validation, and truth boundaries.
- [Context brief](docs/context-brief.md) and [prompt scaffold](docs/prompt-scaffold.md): original design and future ideas, including up to four feeds.
- [Deployment](docs/DEPLOYMENT.md): shared Codex and Claude deployment setup and troubleshooting.

```sh
vercel deploy --prod --yes --scope nates-projects-925609f4
```

Vercel project: `football-companion`. Git pushes alone do not deploy this project.
