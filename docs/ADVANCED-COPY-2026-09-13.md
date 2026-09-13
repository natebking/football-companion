# Advanced cue copy — September 13, 2026

The default second-and-long cue said “On a catch, compare the yards from the throw with the yards gained afterward.” That explains an accounting distinction without giving the viewer a useful football question. The same issue appeared in several situational and player-following cues.

## Editorial standard

Default-mode guidance should connect the reported situation or pattern to a tactical tradeoff and a specific observable action. Useful subjects include a defender choosing between receivers, help moving toward a frequent target, pressure disrupting timing, a runner being forced off his path, or defenders exchanging crossing routes. Avoid instructions that only locate the catch, count yards, restate the score, or identify first contact.

Keep the two kinds of statement distinct: the reports establish the situation and counts; an “if” or “watch whether” prompt directs the viewer's attention. The feed does not establish the next routes, formation, defensive assignment or reason a play succeeded. Raising the teaching level does not justify adding unsupported diagnoses or jargon.

## Change

- `read-7` revises second-and-long, third-down, goal-to-go, long-third patterns, named player observations and repeated-sack prompts.
- Second-and-long now asks whether two receiving threats force a defender to choose. The linked **See the idea** lesson uses the existing defender-conflict diagram, explicitly labeled as an example.
- Short third downs link to the handoff-fake explanation; longer third downs examine whether an underneath defender can close on the short route.
- Historical comparisons keep their measured counts and now connect them to defender movement or blocking. No historical thresholds, data or weighting change.
- The advanced catch-and-run lesson examines how routes, blocks, starting position or a missed tackle produce space. The advanced first-down-line lesson focuses on the defender before the throw. Beginner lessons remain unchanged.
- App version: `2026-09-13-advanced-cues`. Bumping the selector version prevents older journal wording from being treated as reproduced by this version.

The conditional two-depth observation agrees with [The Scouting Academy's explanation of paired high-low routes](https://scoutingacademy.com/itp-glossary-smash-concept/). This is background for a teaching example, not a classification of the live offense's concept. The existing lesson explains that another defender may cover the other threat.

## Verification

All 311 Node tests pass. Across 1,298 steps in the existing eight-game replay sample, before/after selectors chose identical IDs, keys, priorities, named players, supporting workload records and evidence IDs. There were no newly empty states, future support IDs or differences between sequential and direct/reset choices. This verifies stable selection and evidence, not that users find the revised copy more useful.

Comparison artifacts are ignored under `data/qa/advanced-copy-2026-09-13/`; the baseline selector is the pre-edit `read-6`. Both runs use the current historical helper, whose only edits are watching instructions. Reproduce with `scripts/audit-recent-games.mjs --selector ... --out ...` for the baseline and `--out ...` for the new selector.

Real Chrome verified Ohio State–Texas replay `at=46` (second-and-ten), its linked defender-conflict lesson, and `at=47` (third-and-two). The supporting Hollywood Smothers workload and roster labels remain present. Phone-width dark mode has no horizontal overflow; light mode and replay stepping work. No application console errors captured. Headless verification rendered the app but could not fetch ESPN; source-backed browser checks used ordinary Chrome.

Production verified: code commit `f6f9d6a`; deployment `dpl_C2xxPnSjDo5ukXW6rqShLErYykyv`; https://fluentin.football/. Preview and production match the 47-asset manifest `40d79780c33409b161f4df12289b493de3ac0fac12fca67f5e85372dc29ca982`; all four changed public script hashes match the local build. Chrome on the production replay at `?replay=cfb:401856682&at=46` confirms `read-7`, the revised second-and-long copy and the `defender_conflict` lesson, with no captured application errors. Private GitHub main is updated.
