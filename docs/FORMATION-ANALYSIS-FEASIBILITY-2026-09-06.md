# Formation analysis: what is feasible next

September 6, 2026. Follow-up to Nathan’s point that the [broadcast audit](LIVE-BROADCAST-AUDIT-2026-09-06.md) improves explanations but does not yet deliver formation-level analysis. **Observation and proposed experiment only; no formation-recognition feature is implemented or deployed.**

## Product judgment

Formation-aware guidance is a reasonable prototype target. It needs a way to observe the actual alignment. Improving the current text feed or adding more seasons cannot establish where players are standing on the next snap.

The desired experience is a specific observation followed by something meaningful to watch. For example, **if a clear view establishes the alignment**: “Three receivers are grouped tightly on the right. Watch how the defenders sort them out when their paths separate.” This is a candidate experience, not an alignment verified in the small viewing sample below. It also does not claim a route combination or coverage call before those actions are visible.

Useful post-play facts from the earlier audit still deserve implementation. They should not be presented as satisfying this higher bar. The next architectural experiment should test visual recognition and timely delivery directly.

## What the additional viewing established

Inspected the same Louisville–Ole Miss broadcast for several more minutes, including a kickoff, an analyst replay, Louisville’s first-down play from its own 25, a short replay of the following second-and-four sequence, and a subsequent commercial break. This was sparse frame inspection, not a continuous video analysis benchmark.

- At approximately 03:04 UTC, the broadcaster showed a replay with a **Cover 3** label and highlighted deep defenders. This was the broadcaster’s analysis of a replay. It was not an independent coverage classification by the app, nor a verified match to the current source play ID.
- The first-down and second-down views exposed the quarterback standing back from the line with a back beside him. These are visible starting-position observations; the source’s shotgun label becomes available in the completed-play report.
- In the second-down replay, a wider view at about 6:22 showed players still arranging themselves, including movement by Louisville #80. The camera then showed a quarterback close-up around 6:18, followed by a sideline angle near the snap around 6:15. Do not turn that partial sequence into a claim of a particular motion at the snap, a settled receiver grouping, or a full personnel package.
- The app displayed a quiet read for 1st & 10 and then 2nd & 4. Its lack of formation analysis was an input limitation as well as a presentation limitation. The app does not currently ingest broadcast images.

Brief playback changes were made only to inspect the second-down sequence. The stream was returned to live and verified playing. TV delay remains zero from the earlier diagnostic. That is not a measured universal synchronization setting.

## Recognition needs to be split into different claims

| Claim | Evidence required | First prototype decision |
|---|---|---|
| Quarterback under center or back from the line; an adjacent or deeper back | Clear view of the ball, quarterback and backfield, close to the snap | Include. Do not carry a prior play’s position forward. |
| Receiving options split two-and-two, three-and-one, bunched or stacked | Both edges of the formation visible after the offense has settled | Include when fully visible; otherwise report partial visibility. Alignment does not by itself establish players’ roster positions. |
| A player moves across the formation or shifts position | Ordered frames with the same player visible, plus snap timing to distinguish setting up from motion at the snap | Test separately. One still cannot establish movement. |
| Number of defenders close to the line or deep | Sufficient field coverage and a consistent definition of the counted area | Optional until counting is validated. Do not interpret a cropped safety as an absent safety. |
| Personnel package, such as one back and two tight ends | Reliable player identification and roster positions, not just where bodies stand | Exclude initially. A tight end can align as a receiving option away from the line. |
| Actual coverage, route combination or blocking scheme | Suitable pre- and post-snap sequence; often a wider view than the TV director supplies | Exclude from the first automatic claim set. A starting defensive look does not establish how coverage unfolds. |
| Why the defense failed or what a player was assigned to do | Additional reliable evidence beyond a result and a few frames | Do not claim assignments or causation from this input. |

## Data source check

The current **CFBD v2** live implementation exposes play text, situation, outcomes and derived metrics. Its `LiveGamePlay` interface has no formation, personnel, alignment or motion fields. The [current live types](https://github.com/CFBD/cfb-api-v2/blob/main/src/app/live/types.ts) and [mapping service](https://github.com/CFBD/cfb-api-v2/blob/main/src/app/live/service.ts) support this conclusion. The old `cfb-api` Swagger specification is deprecated and should not be used to assert current capabilities. This does not rule out occasional formation words in free text; it does rule out treating the documented live API as a verified source of the next formation.

For historical **NFL** work, nflverse participation documents formation, personnel, box counts, primary-receiver route and coverage fields. Field coverage still needs checking by season and play. Its 2023-and-later participation release comes after the postseason, so those fields cannot explain tonight’s play as it happens. See the [participation dictionary](https://nflreadr.nflverse.com/articles/dictionary_participation.html) and [release timing](https://nflreadr.nflverse.com/reference/load_participation.html).

The separate public **FTN charting subset** contains quarterback location, backfield and box counts, motion, play-action and other flags. It does **not** contain the route and coverage fields from participation. It is manually charted within 48 hours after each game, useful for later checking and examples rather than live formation recognition. See the [FTN dictionary](https://nflreadr.nflverse.com/articles/dictionary_ftn_charting.html) and [availability](https://nflreadr.nflverse.com/reference/load_ftn_charting.html).

No connected source has been verified to supply the needed live NCAA alignments. A commercial vendor would need to demonstrate the exact fields, actual game coverage and arrival times. A “realtime” play-by-play product is not sufficient evidence that it includes pre-snap formations. No new subscription or vendor contact was initiated.

## Proposed experiment

Build and evaluate a narrow formation-reading prototype before redesigning the live product around it:

1. Use a small, deliberately varied set of timestamped pre-snap sequences with known play IDs. Include wide views, cropped receivers, camera cuts, late movement, replay footage and incomplete views. Set aside unseen sequences for evaluation; do not score only selected clear examples.
2. Establish an authorized, usable image input and measure when frames become available. This session’s ability to inspect Nathan’s Chrome window does not establish a deployable video input for every website visitor.
3. First extract only visible alignment facts, with an explicit unknown state. Have a knowledgeable reviewer label the same sequences. Treat a model’s confidence score as a hypothesis to calibrate, not as proof.
4. Generate one short observation and watching cue from supported facts. Keep observed geometry separate from the explanation of what that geometry can make possible. Do not manufacture a current play’s formation from historical tendencies.
5. Measure correctness, unsupported claims, how often the camera permits an answer, and end-to-end time from the last needed frame to visible guidance. Count how many outputs actually arrive before the snap. Report failures and abstentions as well as correct answers.
6. Start with paused or replay use. Promote to live pre-snap help only if the timing measurements justify it. If correct guidance arrives after the snap, present it honestly as replay analysis instead.

Use a smaller vision-capable model for the narrow extraction benchmark and compare a stronger model on the same held-out examples. Review failures with the stronger model; do not repeatedly analyze unchanged frames. Measure latency, image/token use and cost per useful play before claiming that either model is economical or reliable enough. No benchmark has been run yet.

Historical coaching tendencies can add context **after** the current visible look is known, provided the historical sample matches the formation definition and coaching period. They cannot supply the missing live observation. The earlier coaching-transfer study also did not establish a general forecasting benefit, so this experiment should not silently change production probabilities.

The present confidence is narrow: some useful starting positions were visible, and the current structured sources do not fill the formation gap. Reliable automatic formation recognition across games, useful pre-snap latency, and scheme-level accuracy remain unmeasured.
