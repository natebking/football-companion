# Team and season roster identities — September 13, 2026

The live page and replay now expand player names and fill missing jerseys from ESPN's roster for the selected league, team and season. The main cue, supporting workload note, recent-play player line, player-specific takeaway and Game context summaries share the same display layer. No extra panel is added.

## Identity rules

- Cache only athlete ID, full/display/short/first/last names and jersey, with team, league, season, source URL and retrieval time. Discard roster groups, status, injuries, statistics and biography.
- Match an exact official full, display or short name after case, spacing, punctuation and accent normalization. No guessed initials, suffix removal, jersey-only match or current-season substitution.
- An explicit report number must agree with any roster number. It can disambiguate shared shorthand names; when the roster has no number, preserve the report number. Ambiguous, absent or conflicting matches remain as reported.
- Fetch asynchronously without delaying game updates. Cache validated identities for up to 24 hours, bounded to 24 team-season records. Failed requests retry after five minutes, with a ten-second timeout. Storage failure does not prevent in-memory use. Late responses can populate the cache but cannot repaint an unrelated game.
- A roster is the provider's snapshot when fetched, not a game-day lineup or proof of who was on the field. A replay can display a later roster number when its original report omitted one. Empty historical rosters remain unavailable.

Raw play reports, parsed people, aggregate keys/counts, evidence aging, selector inputs, selector version (`read-6`), forecasts and TV delay stay unchanged. Journal entries save the rendered copy and compact identity/provenance records alongside raw evidence. The offline audit reproduces these saved labels; it does not independently verify roster identity or game-day participation.

## Source check

Public endpoint: `https://site.api.espn.com/apis/site/v2/sports/football/{nfl|college-football}/teams/{id}/roster?season={year}`. Response team ID and season year must match the request. All 16 team requests for the eight-game sample returned valid 2026 identities. Requests for 2025 New England and Florida State returned empty groups; these are treated as unavailable.

| Sample | Player spellings resolved | Missing numbers filled |
|---|---:|---:|
| Six college games | 115 / 131 | 17 / 17 |
| Two NFL games | 39 / 42 | 39 / 42 |
| Total | 154 / 173 | 56 / 59 |

These are unique league/team/season/reported-name spellings, not unique athletes, exhaustive rosters, or an independent accuracy estimate. Explicit jersey variants are checked separately within a spelling; one spelling counts as resolved only when all its variants resolve. The parser's team-only `Missouri` record is excluded from these denominators and retained as a known parser artifact. Its runtime parsing is outside this identity-only change.

Examples: `D.Maye` becomes `#10 Drake Maye`; the SMU–Florida State numberless reports gain jerseys. Oregon's `#5 D.Moore` resolves to Dante Moore, while `#1 D.Moore` resolves to Dakorien Moore. Unresolved NFL spellings include `A.Brown`, `D.Samuel` and `S.Bennett`; no alternative name or number is guessed.

Games: college `401858212`, `401856678`, `401856682`, `401856679`, `401856782`, `401858213`; NFL `401872656`, `401872657`. Ignored source responses and an audit containing retrieval times, URLs, SHA-256 fingerprints, resolutions and misses are under `data/qa/roster-2026-09-13/coverage.json`. Original report caches are under `data/qa/recent-games-2026-09-13/`. No bulk roster or source-report payloads are committed.

## Verification

All 311 Node tests pass. Added tests cover source-field whitelisting, official aliases, ambiguity, number conflicts, unavailable seasons, cache corruption/expiry, request deduplication, failure/backoff, timeout, stale game switches, label replacement boundaries, journal reproduction and released-play isolation. Tests use synthetic fixtures and work without ignored QA files.

Real Chrome checks: NFL replay at `?replay=nfl:401872656&at=46`, stepping to 47; college replay at `?replay=cfb:401858212&at=70`. Confirmed full names and numbers in cues, supporting workload, recent plays and context summaries; original ESPN report text remains intact. Reloading uses cached identities without additional roster requests. Phone width 390px has no horizontal overflow; light and dark layouts remain readable. No captured console errors. The headless dev check loaded the page and controls without JavaScript errors; live-source verification used ordinary Chrome.

Release application version: `2026-09-13-rosters`. Production verification is recorded below after deployment.

Production verified: code commit `cb8ff4f`; deployment `dpl_2tvuhWBejwV69MH5C47PkwF9mADE`; https://fluentin.football/. Preview and production match the 47-asset manifest `ce9ebb2407bec006d92c00be3ba15a26015ed8d2bfef828be372016e08d1398e`. Public HTML, app, all three identity modules and data-page hashes match the local build; `/stopwatch` is unchanged. Production Chrome at `?replay=nfl:401872656&at=47` shows #9 Corey Kiner in the main cue and #10 Drake Maye in recent plays, using the 2026 Seattle and New England roster cache. No application console errors were captured. Private GitHub main contains the implementation.
