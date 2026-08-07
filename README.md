# football-companion

Second-screen companion for learning to read football from zero. Design docs, canonical as of Aug 6 2026:

- [docs/context-brief.md](docs/context-brief.md): what this is, the eye-training loop, coordinator-keyed tendency modeling, data sourcing
- [docs/prompt-scaffold.md](docs/prompt-scaffold.md): the card generator spec (truth boundary, card types, curation, correction loop)

## v0: feed-vs-broadcast instrument

Live: https://football-companion-rose.vercel.app

One static page that measures the margin between ESPN's live play-by-play feed and the TV broadcast. Open it on a phone during a game, tap the button when the TV shows the play at the top of the list, and it logs the feed's lead time. Samples stay in localStorage; there is no backend.

Notes:

- The page polls `site.api.espn.com` directly from the browser. ESPN 403s datacenter IPs but serves `access-control-allow-origin: *`, so a serverless proxy is unnecessary and would only add latency to the number being measured.
- It also flags batched arrivals (multiple plays landing in one poll), post-hoc play text revisions, and plays that arrived while the page was asleep (excluded from timing).
- One-line play text is the full extent of what live feeds provide: no formations, no routes, no coverage. The teaching layers described in the brief get built on top of this.

## Deploy

```
vercel deploy --prod
```

Vercel project: `football-companion`.
