# Product review: understand the play

2026-09-05. Implementation and validation notes for the play-explanation and glossary pass.

## Direction

The next improvement should help a new viewer understand **what happened and what changed**. The companion already offers historical run/pass tendencies and things to watch before the snap. Its explanation of the completed play is thinner: it often reduces ESPN's description to “Run” or “Pass complete,” then lists the gain.

A useful explanation connects that gain to the situation: “They gained 5 but needed 8. Fourth and 3.” Names, formation, direction, and pass depth can make the play more concrete when the source actually reports them. More odds would add less value at this stage.

## Implemented decisions

1. **Use more of the released play record.** Add a concise factual summary and consequence from the reported play type, yardage, before/after situation, possession, and scoring. Include player or formation/direction information only when explicitly reported. Keep the original description available. Distinguish a completed play from the next pre-snap prompt, and preserve the user's TV delay for all outcome information.
2. **Keep feedback tied to the actual play.** Remove the generic explanation selected with the pre-snap card from the prediction result. That explanation can discuss play action after a run, or zone coverage without evidence of zone coverage. A prediction result should report what happened, and say when the feed cannot support a grade. Also guard against a late response from a previously selected game reaching the current game.
3. **Separate predictions from familiarity.** A correct run/pass guess does not demonstrate recognition of a blitz, a slot receiver, or play action. Keep prediction scores separate from the history of terms encountered. Show full definitions by default, with an explicit preference for shorter hints instead of automatically inferring understanding from two exposures or quick guesses.

These decisions replace the previous `plainPlay` summaries, pre-snap `explain_hint` attached to grades, and `recordCall` crediting all concepts on a card for one outcome guess.

## What the feed supports

An inspection of six final and two live CFB game snapshots found 1,157 unique rows:

| Reported detail | Observed coverage |
|---|---:|
| Pass direction/depth | 350 of 403 pass rows |
| Run direction | 350 of 420 run rows |
| Structured participants | 2 of 1,157 rows |

Coverage varied sharply by game, including a game with none of the richer direction/depth details. Player names are more available in the description than in structured participant records. Optional details must therefore disappear cleanly when absent.

The inspected descriptions supplied no route, blitz, coverage, or play-action identification. This is evidence about these eight CFB snapshots, not a guarantee about every ESPN feed or the NFL. Missing detail must not become a guessed explanation.

## Boundaries and tradeoffs

Keep the static app and deterministic explanations. Adding an AI narrator would not give the app evidence about assignments, routes, or why a defender reacted. Source-backed details and state changes can be explained without runtime generation. Watching suggestions can still introduce those concepts, provided they invite the viewer to look rather than claim the app observed them.

Historical tendencies remain useful background. They are not a live account of personnel or scheme. At this review’s original checkpoint, the NFL table contained 2024 only. **Update, September 6:** the shipped NFL history now covers 2023–2025. The [refresh audit](DATA-REFRESH-2026-09-05.md) records the data checks and the statistical tie against the league baseline. The earlier refresh dry-run alone was not evidence of deployment.

The code and feed audits establish what information is available and expose mismatches in feedback. They do not prove a learning effect. The meaningful test is whether the viewer can explain a play and recognize a concept with less help over time, not simply whether they guess run or pass correctly.

Defer additional odds and the requested future four-feed mode until play explanations and feedback are dependable. Four feeds remain a future feature, not part of this pass.

## Definitions and help

Underlined terms in hints and play explanations open a small definition beside the word. They work by click or tap, with an explicit close button and Escape dismissal. The same definitions are available from the history of terms seen. Ordinary language stays in the sentence; the reader can ask for the football meaning without leaving the game. The header's How it works link explains the feed, historical tendencies, TV delay, and prediction limits.

## Validation

47 automated tests cover real recorded plays and scoring/penalty cases, inconsistent yardage, grading, game/league request races, the TV-delay boundary, and safe glossary annotations. The post-play module processed all 1,157 audited rows without errors and preserved all 63 scoring rows. A new live Georgia–Tennessee State record exposed contradictory yardage and a declined penalty mislabeled as a penalty play; both are now represented in regression fixtures.

Browser checks cover the live feed, inline definitions, help dialog, light/dark mode, and phone widths of 390 and 320 pixels. These checks validate the implementation and known edge cases. They do not guarantee that future ESPN records will be correct or demonstrate that the app improves learning.
