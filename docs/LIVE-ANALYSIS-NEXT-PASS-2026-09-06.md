# Next pass: make the last play worth understanding

September 6, 2026. Assessment of shipped app commit `15e5b37` and repository `6f7cb6c`. **Plan and code assessment only; the changes proposed here are not implemented or deployed.** This incorporates Nathan’s report that useful live analysis is still occasional, the repeated waiting messages, and the suggestion to compare a YouTube TV broadcast with the feed.

**Viewing follow-up:** the [Louisville–Ole Miss broadcast audit](LIVE-BROADCAST-AUDIT-2026-09-06.md) now records specific misses, proposed wording and synchronization observations. It was a bounded diagnostic sample, not a completed continuous-play study. The implementation below remains planned.

**Formation follow-up:** Nathan clarified that better post-play summaries still fall short of formation-level understanding. The [visual-analysis feasibility note](FORMATION-ANALYSIS-FEASIBILITY-2026-09-06.md) defines a separate, narrow recognition experiment. The presentation work below should not be described as delivering that capability.

## The missing payoff

The app needs to connect what it suggested watching before a play with what the released report and visible broadcast can actually establish afterward. More features, successful unit tests and more historical rows do not by themselves establish that it is useful to watch with.

Current code confirms:

- `game-read.js` suppresses eligible nonurgent reads whose keys occur in the six-entry recent history. Ordinary early downs can have no candidate at all. The main panel then says “Waiting for a new pattern or decision.” This is a selection outcome, not a feed-health diagnosis.
- `app.js` renders the result and next situation in Recent plays. Additional explanation, passing-distance breakdowns and related lessons are inside “Understand this play.”
- `play-facts.js` frequently explains only the yards gained/needed or a penalty’s effect. More detailed catch-distance and after-catch numbers are used only when supported and reconciled. The advanced setting does not make these basic post-play explanations substantially deeper.
- The immediate prediction-result handler grades a pending call. It does not generally reconnect the previous watching prompt with an explanation of the specific play.
- The app has useful current-game aggregates, but only a narrow set supplies prominent reads. Much of the supporting information stays in disclosures.

The next iteration should improve this watch → result → implication sequence before expanding the statistical or lesson inventory again.

## First, inspect one short stretch of actual viewing

Compare 8–12 consecutive plays, rather than picking only highlights. Start with two plays to establish that the browser tools can see the video and that exact plays can be matched. A recorded or rewindable drive is easier to inspect than an uninterrupted live game. If testing arrival timing, capture it during live viewing; a final play-by-play file cannot reconstruct what was available at the time.

For each play, record:

| Item | What to retain |
|---|---|
| Identity | League, game and source play ID; period, clock, possession and down/distance as cross-checks. |
| What the app showed | Exact pre-play prompt, visible post-play explanation and whether either was hidden, repeated or absent. Prefer the existing journal with visibility and revision records. |
| What arrived | Source receipt/release times and revisions where actually recorded. Do not infer those times from the game clock. |
| What was visible | Only the action that can be observed from the available broadcast frames/replay. Mark off-screen players and ambiguous actions unknown. |
| Missed opportunity | One concrete observation or explanation that would have helped a regular viewer. |
| Cause | Already in the feed but unused; present but badly placed; arrived too late; needs video/charting; or cannot be established. |
| Viewer judgment | Useful, obvious, unsupported, badly timed or missed. This small sample is diagnostic, not proof of learning or forecasting improvement. |

Use browser-readable paused frames or replay controls selectively. These tools do not supply a continuous video/audio stream, and isolated frames cannot establish every movement or assignment. Verify capture works before spending time on a full drive; do not bypass protected playback. Keep any QA captures and raw observations in ignored local data, not the public web bundle or repository. No automatic full-game watching or ongoing token-intensive loop is planned.

The output of this test is a ranked list of missed insights with examples and evidence requirements. It should guide what gets implemented, rather than generate another broad feature list.

## Then implement two connected pieces

### A current read that remains useful

Keep a previously shown observation while it is still relevant and supported; refresh its counts when new released evidence changes them. Revalidate the offense, drive, down, score and clock before retaining it. Never carry an old team/drive-specific observation into a new possession just to fill the panel. Consequential new information takes priority. A cooldown should govern repeated announcements, not automatically erase applicable context.

When there is no meaningful supported read, keep the situation and the latest-play explanation usable. A small status can acknowledge the absence of a new observation; a large waiting message should not be the primary experience.

### A visible explanation of the latest play

Give the newest released play a compact, visible takeaway without requiring “Understand this play.” It should remain available until the next result arrives, rather than flash away when the same response also supplies the next down. Use normal page flow; do not reintroduce a fixed bottom bar.

Each takeaway should connect up to three things, only where supported:

1. **What happened:** a specific reported action or a change in the pattern the app had highlighted.
2. **Why it matters now:** its effect on the current drive, likely next decision, clock situation, or an already observed tendency. A descriptive outcome is not evidence that a different choice would have worked better.
3. **What to look for in a replay:** an appropriate viewing question. Distinguish that question from something the app actually observed.

An illustrative example, not a claim about a real game:

- Before: “They’ve targeted #11 on three of their four third-down throws. Find where he lines up.”
- After: “They went back to #11 for 12 yards and a first down. That is four of five third-down throws his way.”
- Replay question: “How close was his defender when the pass arrived?”

The final line invites observation; the report alone cannot establish the defender’s coverage or whether an assignment was missed. Do not add a speculative tactical story merely to sound advanced.

Link the explanation to the exact released play and, when available, the specific pre-play guidance actually displayed. If that prompt was never shown, do not say “as we pointed out.” Initial backlog or final records must not masquerade as an observation made during the play. An unmatched or corrected report must not attach an explanation to the wrong snap. Keep source corrections, UI level, local feedback and journal export behavior explicit.

## What data can and cannot unlock

Use existing released facts and aggregates first: named targets/carries, down and distance, score/time, verified drive movement, accepted penalties, repeated short gains, conversions and reconciled passing distances. Missing optional fields remain unknown. Keep confidence tied to the specific claim, rather than attaching a single confidence score to the whole card.

Live tactical identification—route combinations, coverage rotations, blocking movements—requires suitable visual evidence or timely charting. Even a broadcast may leave relevant players out of frame; it cannot automatically establish a coach’s intended assignments. More old seasons or a stronger run/pass model cannot supply those missing facts about this play.

The public [FTN charting documentation](https://nflreadr.nflverse.com/reference/load_ftn_charting.html) describes charting within 48 hours after a game. It supports historical lessons and later audits, not an immediate live visual account. [CollegeFootballData passing](https://api.collegefootballdata.com/api/passing) documents enriched pass records, but documented fields alone do not demonstrate useful live coverage or freshness. Existing provider-access limitations remain; this plan starts no subscription.

## Release evidence

Before shipping the two pieces, compare the old and proposed output on the captured sequence. Have Nathan judge whether the proposed observations provide a reason to look back at the play or notice something on the next one. Separately test exact prompt/play matching, delay isolation, corrections, possession changes, missing data and persistent latest-play visibility. Retain source facts, old output and revised output so the comparison is reviewable.

Tests can establish correct behavior. The short broadcast comparison can expose obvious product misses. Neither alone proves that the app improves football understanding across viewers. Keep the existing prospective forecast and practice evaluations separate.
