# Current situation before repeated workload — September 13, 2026

`read-6` reduces unchanged player headlines while keeping their workload visible. This is a presentation and selection policy, not a new forecast model or evidence of improved learning.

## Released behavior

The existing player thresholds remain: sufficient named carries/targets, coverage, share and a clear leader. A broad game/drive player cue gives way when both conditions hold:

1. Two eligible offensive actions for that team have passed without another reported carry/target for the highlighted role.
2. A relevant goal-to-go, third-down, second-and-long or long-third-down observation is available.

The count stays in a smaller **Player workload** note. A new carry/target restores the player's original priority. An ordinary first down with no stronger context can retain the player. The specific third-down receiver pattern and urgent clock, fourth-down, sack and penalty observations retain their existing rules. Players are never rotated at random. Missing player identification is not treated as proof that the player was absent from the field.

Evidence age uses same-team released offensive action IDs. Clock updates, repeated renders, timeouts, penalties/no-play and the other team's actions do not age it. Corrections and backward replay seeks recompute the choice. The long-third-down pattern remains a fallback on other downs rather than creating an empty card; on second/third-and-seven-plus it retains its stronger priority. Existing historical comparisons can still outrank an ordinary down cue, with the same supporting player note and an explicit historical source.

Example: Ohio State–Texas, report `401856682226`, replay `at=46`. The older headline repeatedly highlighted #2 H.Smothers after three passing reports. The new headline addresses second-and-ten; the smaller note retains his four of five reported runs. At `at=47`, third-and-two becomes the observation. After his next reported carry at `at=48`, the drive's player cue returns. This describes source reports, not who was on the field or the intended call.

## Evaluation

The baseline is the frozen `read-5` selector from commit `e3eaa06`. Both sides use the same final reports, historical tables and corrected player parser, isolating the selection change. All 1,917 replay steps were checked through the current final-summary adapter, pre-snap whitelist, Insights and selector. Source support must exist inside the prefix, the selection must have the top eligible priority, and sequential versus direct/reset selections must match.

| Sample | Replay steps | Player headlines, before → after | Repeated player with no new involvement, before → after | Quiet valid situations, before → after |
|---|---:|---:|---:|---:|
| Original six college games | 1,004 | 545 → 479 | 251 → 182 | 73 → 73 |
| Original two NFL games | 294 | 189 → 174 | 84 → 70 | 20 → 20 |
| Four additional college games | 619 | 342 → 306 | 154 → 110 | 38 → 38 |

The additional games are Alabama–Kentucky (`401856674`), Penn State–Temple (`401858442`), Rice–Notre Dame (`401859184`) and Tennessee–Georgia Tech (`401856681`), all September 12. They were selected before viewing initial candidate results. Guardrail fixes were then checked against the same games: preserve the long-third fallback to avoid five new empty states in the development set, and retain the supporting note when a historical comparison wins. Thus these are regression checks, not a pristine final-model holdout or representative sample.

There were no new empty states, no unsupported future IDs, no differences between sequential and reset choices, and no changed selections for existing fourth-down, late-clock, verified sack/penalty or third-down-specific target cues. The 117 displaced player headlines retain supporting notes (66 college development, 15 NFL, 36 additional college). Repetition still exists, including when a workload remains useful and there is no stronger contextual cue. The 29% reduction in the additional games is a count reduction (154 to 110), not an accuracy or usefulness score.

Final reports can contain later corrections and cannot recreate feed-arrival or broadcast timing. No current-version viewer ratings establish whether these replacements improve attention or learning. Live review is still needed.

## Jersey numbers

We do **not** have a jersey number for every player. The app preserves `#NN` when ESPN includes it in written play reports; it does not have a roster identity layer.

Across the original eight-game sample, after excluding obvious team/prose labels, the parser sees 131 plausible college team/name spellings: 114 numbered and 17 unnumbered. All 42 NFL team/name spellings lack a jersey prefix. These include passer, runner and receiver fields; they are not exhaustive rosters or verified unique athletes. The numberless college game is SMU–Florida State. A same-team `D.Moore` appearing with two different numbers further shows why initials alone are not a reliable identity join.

The final summaries' boxscores contain athlete IDs, full names and many jersey numbers, but no roster and no participant IDs on the sampled play rows. For example, the NFL metadata includes Drake Maye's number 10. Using final boxscore participation or statistics in earlier live decisions would introduce hindsight. A future identity layer should use team/game/season roster metadata, preserve explicit report numbers and leave ambiguous or conflicting names unresolved. No roster lookup was added in this release.

The audit also exposed three NFL actor-boundary errors caused by “reported in as eligible” preambles. The bounded parser repair now reads the actual passer/runner after that sentence, preserves the raw report and does not treat the eligible player as the actor. None of those malformed names met a main-cue threshold in the inspected games. One college report names the team itself as the runner; that unresolved source identity remains a limitation, not an inferred individual.

## Reproduction and verification

Ignored `data/qa/cue-selection-2026-09-13/` contains frozen baseline/initial/final selector files and `development-before.json`, `development-after.json`, `check-before.json`, `check-after.json`. Cached final reports and exact source URLs/retrieval times remain under `data/qa/recent-games-2026-09-13/`. The tracked audit supports explicit game and selector inputs:

```sh
node scripts/audit-recent-games.mjs --selector data/qa/cue-selection-2026-09-13/game-read-baseline.js --out data/qa/cue-selection-2026-09-13/development-before.json
node scripts/audit-recent-games.mjs --out data/qa/cue-selection-2026-09-13/development-after.json
node scripts/audit-recent-games.mjs --game cfb:401856674 --game cfb:401858442 --game cfb:401859184 --game cfb:401856681 --out data/qa/cue-selection-2026-09-13/check-after.json
```

Jersey evidence and the read-only counting script are under ignored `data/qa/jersey-2026-09-13/`. Source examples: [ESPN Ohio State–Texas final reports](https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary?event=401856682) and [ESPN New England–Seattle final reports](https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=401872656).

All **287 Node tests** pass. Tests cover evidence aging, correction, refresh, possession changes, historical support, replay determinism, existing delay isolation and journal reproduction of the main and supporting copy. Real Chrome verified the `46 → 47 → 48` transition and the smaller note at desktop and phone widths in light and dark themes. Headless verification loaded the app but could not reach ESPN in this environment; successful live-source checks use ordinary Chrome.

Production: code commit `ff8461d`; deployment `dpl_9N2FsYboGHg6yP3gPf8DULTkwt4i`; https://fluentin.football/. Preview and production match the 44-asset local manifest `9547828b5079de7875701882f62fe063c7ef6c3ffa73b14f197126c1d4b848b4`. Public HTML, selector, app, stylesheet, parser and data-page hashes match. Chrome verified the deployed second-down observation plus Smothers workload at `?replay=cfb:401856682&at=46`, with no captured console errors. Local checks also confirmed the supporting note clears in Beginner mode and at replay start.
