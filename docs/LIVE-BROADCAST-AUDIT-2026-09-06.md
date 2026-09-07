# Live viewing audit: Louisville at Ole Miss

September 6, 2026, roughly 7:49–8:00 p.m. Pacific. Production app `15e5b37`, ESPN event `401856661`, YouTube TV ABC broadcast in Nathan’s Chrome window. **Observations and proposed changes; no app changes or deployment in this checkpoint.**

## Finding

The immediate opportunity is to use the information already arriving. The app hides useful passing distances, drops a named quarterback hurry, and reduces a possession-saving roughing penalty to generic penalty copy. Its prominent waiting state competes with meaningful information about the previous play.

This is evidence of specific product misses, not evidence that a new forecasting model is needed. Fix the visible post-play explanation and its connection to the next situation before buying another feed or expanding the historical model.

## How this was checked

Read the app’s visible DOM alongside captured broadcast frames. Briefly replayed one third-down pass; restored live playback and verified that the forward-to-live control was disabled and the pause control was available. Most plays were not inspected continuously. This was a diagnostic sample across two possessions, **not the planned complete 8–12-play observation study** and not an assessment of every player’s movement.

Independently saved eight public ESPN summary responses, with actual fetch times, between 02:51:37 and 02:55:44 UTC on September 7. These are retained locally in ignored `data/qa/live-broadcast-2026-09-06/source-*.json`. The first and last captures are not necessarily the first arrivals of their plays. Provider `wallclock`, modification times and displayed game clocks are not measurements of when a viewer saw the action.

The table below separates report-backed opportunities from visual claims. Source: [ESPN game summary](https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary?event=401856661). Raw reports, video and screenshots are not added to the repository or the public website.

## Missed explanations

Play IDs in this table are the suffixes of `401856661`. Proposed wording is a candidate for implementation, not text already shipped.

| Play / situation | What the app showed | Available evidence | Proposed explanation or change |
|---|---|---|---|
| `683`, Louisville sack; next 4th & 24 at its own 11 | The main read described the general punt-versus-go decision and suggested watching whether the offense stays out. | The app’s drive summary already recorded 15 yards lost to penalties, only one net yard gained on plays, and a net retreat of 14 yards. The latest sack lost 11. | “Penalties and that sack left Louisville needing 24 yards from its own 11.” Follow with the field-position consequence of a punt. The priority should reflect this drive, rather than frame all fourth downs as equally close decisions. |
| `693`, Lindsey completion for four | “Pass complete for 4 yards.” Main card: “Waiting for a new pattern or decision.” The catch breakdown required opening “Understand this play.” | Start: MISS 46. Reported catch: MISS 41. End: midfield. The existing parser correctly calculated minus-five through the air and nine after the catch. | “Lindsey caught it five yards behind the line and gained nine after the catch—a four-yard gain overall.” Make this visible. A replay question can ask where his running room came from; do not assert a screen or a particular block. |
| `693`, related lesson | “Read the routes around the marker.” | `learning.js` chooses the first-down-line lesson for completed passes with a known distance requirement. | Prefer the catch-and-run lesson when reconciled passing distances explain the gain. The marker is not the most useful teaching focus for this first-down catch behind the line. |
| `703` then `709`, facemask followed by a 14-yard completion | The completion and “Next: 2nd & 11” appeared as separate facts. | An offensive facemask backed Ole Miss from LOU 39 to MISS 46, setting up 1st & 25. Fields then gained 14 yards. | “A 14-yard gain still leaves 11 to go because of the facemask penalty.” Attach the relationship only when the released sequence confirms both plays belong to this possession. |
| `714`, second-down incompletion | Incomplete pass, deep right, quarterback name. | The first captured version said short right. The next captured version changed it to deep right and explicitly credited #4 T. Banks with a quarterback hurry. | “The report credits Banks with hurrying Chambliss on the incompletion.” A replay question can ask whether the quarterback had room to step into the throw. Do not claim the hurry caused the miss, identify a blitz, or assign blocking blame. |
| `717`, third-down incompletion | Before: watch the receiver relative to the first-down line. After: incomplete pass; next 4th & 11. No explicit link back to the prompt. | Third & 11 at LOU 40; report names Hasz and a throw to LOU 35. Brief replay frames were consistent with a short incomplete throw but did not establish coverage or responsibility. | With validated intended-pass position: “The report places the throw five yards downfield, six short of the first-down line.” This is an intended location, not a catch or a measured route length. Link to the actual displayed prompt only if the journal confirms the same snap. |
| Before `720`, fourth & 11 at LOU 40 | “The kick-versus-conversion decision starts here”; says the actual kick is longer than the distance to the end zone. | Current field position supports an estimated kick distance, subject to holder alignment. The subsequent report specifies an actual 57-yard attempt. | Before the play, “A field-goal attempt from here would be about 57 yards.” Label it an estimate and avoid claiming kicker-specific odds without evidence. Afterward use the reported actual distance. |
| `720`, missed kick plus roughing | “Play called back by a penalty.” “The penalty moved the ball 15 yards forward. Next: 1st & 10 at LOU 25.” | Report identifies a missed 57-yard field goal, roughing the kicker on Louisville, 15 yards, first down and no play. Start and end blocks agree. This action was checked against the report; the kick/contact were not continuously watched. | “The missed 57-yard kick doesn’t end the drive: roughing the kicker gives Ole Miss a first down at the 25.” Explain the possession consequence, not just the movement of the ball. |

The strongest examples above can be implemented from released ESPN reports and the existing validated movement/catch calculations. They do not require computer vision. Some of the proposed connections need new parsing or selection rules; they are not simply a CSS change.

## Timing findings and limits

At 02:50:04 UTC the app still showed Louisville’s 4th & 24 while the TV showed Ole Miss starting its next possession at 10:34. At 02:53:12 the app was still showing Ole Miss’s four-yard completion and 2nd & 6, while the TV was showing 2nd & 11 later in that drive.

This browser had the new **unmeasured 45-second default delay**. At 02:53:52 it was set to **zero through the app’s UI** as a diagnostic intervention. The app immediately advanced to 3rd & 11 at LOU 40, the same situation visible on TV. This establishes that the added delay was contributing to the lag at that moment. It does not establish that zero is the correct lasting delay.

Later, with zero delay, the app had reported a touchdown while the TV still showed the preceding third-down situation. The TV player also needed its live-edge control checked after replaying. Consequently this sample does **not** support a reliable number for ESPN-to-TV latency. A fixed guess can put the app behind the broadcast at one moment and ahead at another. Nathan’s browser was left at `TV +0s`; playback was verified running at the player’s live edge at the end of the comparison.

The captured source also repeatedly used 10:34 as new plays arrived. The shipped clock-health warning correctly identified that problem. Neither a stale game clock nor a commercial should be used to calculate wall-clock delay.

One report changed materially between captures: `714` was short-right at 02:53:26 and deep-right with a named hurry at 02:53:37. Those are observation times, not exact provider publication times. This illustrates why newly useful detail can arrive as a correction to an existing play.

Code inspection shows that a queued correction resets that play’s release timestamp, with subsequent updates waiting behind it. That is a hypothesis to investigate for unnecessary waiting, **not a proven explanation for this session’s entire delay**. Preserve first receipt, revision receipt, release and user observation as separate events before changing the scheduling behavior.

## Implementation order

1. **Visible latest-play explanation.** In normal document flow, show the most useful supported fact and its consequence. Prefer catch breakdowns, reported pressure and accepted-penalty consequences over definitions of a sack or touchdown in Read the game. Preserve Beginner and definitions on tap. Keep the latest explanation available while the next-snap card is quiet. Do not bring back the obstructing bottom bar.
2. **Connect the last play to the situation and displayed cue.** Use exact game/play IDs and released predecessor records. A fresh report is not proof that a pre-play prompt was visible. Handle revisions and initial backlog explicitly. Use the validated drive story in a fourth-and-very-long situation and fix catch-and-run lesson selection.
3. **Measure synchronization with actual play observations.** Treat the default as unmeasured, not as a synchronization result. Investigate correction-driven queue postponement with diagnostics. Test backlog, commercials, replay controls and a feed that alternately leads and trails TV before deciding on a new release rule.

For the first implementation, compare output against these cases plus controls: incomplete passes without a named hurry, contradictory catch spots, declined/offsetting/multiple penalties, kicks without a reported ruling, a source revision removing an earlier fact, and a change of possession. A parser must decline unsupported details; an empty optional detail should not erase the visible result.

The live journal should record the additional wording actually shown. Passing deterministic tests will establish parsing and display behavior. A second short viewing check and Nathan’s judgment are still needed to assess whether the result is more useful.

## Confidence

**High** that useful existing data is being hidden or discarded in these named examples: visible app output, parser/renderer code and captured reports agree. **Limited** confidence about general live timing: this was sparse observation with playback interactions and one deliberate delay change. No evidence here establishes live coverage identification, blocking assignments, a forecast improvement or a learning gain.

A short broadcast comparison was worthwhile. Continuous full-game AI viewing is not necessary to fix the misses found here. More historical or paid data should be pursued for a specified missing field and measured availability, after the app uses these already available facts well.
