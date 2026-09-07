# Fluent in Football: make the default worth watching with

September 6, 2026. Planning document; no application changes or deployment in this pass. Based on the repository at `161d364`, its completed research and current provider documentation.

> **Latest product feedback:** useful live analysis is still too occasional, waiting states are too prominent, and post-play explanations do not close the loop with the preceding cue. The [next-pass assessment](LIVE-ANALYSIS-NEXT-PASS-2026-09-06.md) prioritizes a bounded broadcast/feed comparison, retaining relevant reads, and visible linked post-play explanations. It is a plan, not a shipped change.

**Product decision:** “Read the game” is the default. It assumes someone understands the rules and wants help noticing decisions, patterns and consequences. “Beginner” is an explicit alternative for learning the rules and basic terminology. Both use natural English and offer clickable definitions. Opening a definition never changes someone’s mode.

The product should earn attention by answering: **What matters here? What has this team actually been doing? What should I watch next?** Its success is not how many statistics or football terms it displays.

**What is going wrong today**

The friend’s example has a specific explanation. `web/learning.js` rejects fourth down in `choose()`. `web/app.js` then falls back to the older card copy. The field-goal card in `web/cards.json` says, “A field goal is a kick between the posts. Watch the holder kneel.” This can appear even though the stored setting defaults to the deeper level. Changing the default setting alone would not fix it.

On other downs, the lesson selector mostly uses down, distance and field position, then chooses among lessons with an arithmetic hash. It does not choose the main observation based on the targets, drives or patterns this game has produced. The question, tendency and observation are also selected through separate paths, so they can concern different things.

Meanwhile, `web/game-insights.js` already computes useful summaries from released reports: early-down actions, named targets and carries, reported direction, and drive progress. This is a presentation and selection problem as well as a data problem. We should use those existing facts before buying a larger feed.

**1. Make the default consistently deeper**

- Keep “Read the game” as the new-device default and remember explicit choices. Rename the other choice “Beginner,” with a short explanation: “Learn the rules and what to watch.” Do not silently move existing users who selected Beginner.
- Apply the choice to every state: first through fourth down, goal line, kicks, punts, late-game decisions, explanations and empty-data fallbacks. Audit the whole content inventory, not just the offending sentence.
- In the default mode, explain the decision or a supported pattern. Basic definitions live behind underlined terms. Beginner can explain the rule and connect it to the same situation.
- Stop treating every learning opportunity as “run or pass?” Make questions optional and tied to the observation the card actually asks someone to make.
- Allow a quiet state. When the feed has not supplied anything useful, keep the last meaningful observation or a brief waiting status instead of filling space with another generic lesson.

**2. Put one relevant insight in the main card**

Replace the independent lesson/card/question selection with one small, testable selection module. Start with a finite set of authored insight types, each with explicit required facts. Rank eligible insights by consequence, strength of evidence and novelty. An important fourth-down decision can override a repetition cooldown; a routine repeated statistic should not.

The card should have a short headline, one sentence of evidence, and an optional observation. “Why this matters” opens the comparison or explanation. Source and sample details stay available without dominating the screen. Keep the recent-play list at five by default and historical exploration near the footer.

The following copy is illustrative, not a report of a current game:

| Situation | What the default should show | Evidence required |
|---|---|---|
| Fourth down, trailing by four with 2:10 left | “A field goal still leaves them needing another possession. Converting would keep their chance to take the lead on this drive alive.” Offer the kick/go/punt tradeoff, not the definition of a field goal. | Reliable released score, time, down and field position. Add numerical recommendations only after separate decision-model validation. |
| The same player repeatedly gets third-down throws | “Three of their four reported third-down targets have gone to Jones. Find him before the snap and watch where his defender lines up.” | Exact qualifying plays and named-target coverage. Show the count, not a prediction that he gets the next throw. |
| A drive looks productive but flags supplied much of the progress | “Penalties have moved this drive farther than the offense’s plays.” Expand to the verified yardage breakdown. | Complete released drive sequence, reconciled field movement and penalty yardage; no double-counted no-plays. |
| Repeated early-down losses lead to long third downs | “They’ve faced third-and-seven or longer on four of five possessions.” Show the preceding losses or incompletions so the viewer can follow how it happened. | Released possession boundaries and down/distance sequences. No invented explanation about blocking or coverage. |
| Play calling differs from the team’s usual pattern | “They’re throwing more often on early downs than they usually do in similar score-and-clock situations.” Show actual counts and the relevant historical range. | Adequate comparable sample, matched action definitions and baseline. Suppress the claim when uncertainty or missingness is too high. |
| A long completion mostly came after the catch | “The throw traveled 3 yards beyond the starting line. The receiver added 33.” A small distance graphic makes the difference visible. | Verified catch location and total gain. This exact split exists in the app’s historical Jackson-to-Flowers example; it is not available for every live play. |

Start with the first four insight types, which can largely use the existing live feed. Historical comparisons and catch/run decomposition follow where the necessary fields are actually available.

Do not upgrade an observation into a causal claim. “Two sacks this drive” is supported by a report; “the left tackle cannot handle the blitz” needs much more evidence. Conditional prompts can guide the viewer’s eyes without pretending the app has seen the formation.

**3. Use the right data at the right time**

| Source | Practical use | Timing and limits |
|---|---|---|
| Existing ESPN reports | Drive stories, third-down situations, target distribution, reported run/pass direction, penalties, field position and game context. | Already integrated. Written reports can be delayed, incomplete, batched or corrected. No dependable complete route or coverage map. Use only facts released through TV sync. |
| Historical nflverse and CollegeFootballData play-by-play | Team and opponent profiles, comparable situations, conversion rates, distributions of gain, scoring opportunities and clock decisions. | Build before kickoff from earlier games. NFL and college need separate definitions and validation. More seasons are useful for studying richer questions; they do not automatically improve the current estimator. |
| CollegeFootballData passing details | Enrich college review with passer/target, pass direction and nullable air-yard/after-catch splits. | Validate game/play joins and parsed yardage. Treat as review enrichment until actual in-game availability has been measured. [Passing API](https://api.collegefootballdata.com/api/passing). |
| CollegeFootballData live plays | Trial a more structured college feed, including success/EPA and play metadata. | The live schema does not promise structured routes or defensive coverage. Live play-by-play is currently included at $5/month with 30,000 monthly calls. This is a trial option, not an unlimited production feed. [Live documentation](https://api.collegefootballdata.com/api/plays), [access tiers](https://collegefootballdata.com/api-tiers). |
| FTN charting through nflverse | Historical NFL motion, play action, screens, RPO, box counts and pressure-related context; stronger real-play lessons and preparation. | Available from 2022; documentation says charting is completed within 48 hours after a game. Not live formation detection. Attribute FTN via nflverse and honor CC BY-SA terms. [Availability and license](https://nflreadr.nflverse.com/reference/load_ftn_charting.html), [field dictionary](https://nflreadr.nflverse.com/articles/dictionary_ftn_charting.html). |
| A licensed feed such as Sportradar | Investigate whether NFL fields such as blitz, screen, RPO, quarterback alignment and air yards can support richer live explanations. | These fields appear in NFL documentation; access, coverage, real latency, price and display rights need a trial/contract check. Do not assume college has the same coverage. [NFL play-by-play documentation](https://developer.sportradar.com/football/reference/nfl-play-by-play). |

The nflverse refresh schedule reinforces the live/history distinction: cleaned play-by-play is updated after game days, and recent participation data is not an in-season live source. Historical charting can help prepare context without telling us what players are doing on the field right now. [Source schedule](https://nflreadr.nflverse.com/articles/nflverse_data_schedule.html).

For college, start by extracting more value from ESPN and existing CFBD history. A bounded CFBD live comparison is the first paid-source experiment worth considering. Measure completeness, correction rates and arrival times against the existing feed before switching. No subscription is authorized or purchased by this plan.

If we add a protected live API, use a small server-side adapter with a shared per-game cache and keep its key off the client. Four three-hour games polled every five seconds would use 8,640 calls even with one shared poll per game. That has to fit the monthly allowance and also supports the future four-game view without multiplying provider calls by every viewer. A provider cache interval is not a guarantee of stadium-to-app latency.

**4. Make historical analysis explain this game**

Prioritize score and clock. The completed NFL pilot covered 2018–2025 and tested 104,878 plays in held-out 2023–2025 seasons. Adding score/time to a matched situation model improved run/pass classification from 62.03% to 66.96%, with a substantial improvement in probability error. Simply using more old seasons did not help. Calibration still needs work, and these are retrospective NFL results, not measured live accuracy or college results. See [the completed pilot](/Users/nking/Documents/football-companion/docs/COACHING-PILOT-2026-09-05.md).

Use that research to propose a score/time-aware baseline, align its historical and live outcome definitions, review calibration, and test on archived live inputs before release. Keep the probability secondary to the useful observation.

Build compact team/opponent context around specific questions: do early-down runs leave manageable third downs; are passing gains usually through the air or after the catch; where have drives stalled; how often do comparable fourth downs convert? Show counts and relevant comparisons. Adjust for opponent quality before labeling a defense unusually vulnerable, and account for small samples early in the season. Run/pass outcome comparisons are descriptive, not proof that choosing the other action would have caused a better result.

Retain the coaching idea, but use dated **actual play-caller** assignments rather than treating the head coach as the caller. Track staff and quarterback changes so old seasons do not silently describe a different offense. The existing one-caller transfer pilot was inconclusive: its uncertainty includes no forecasting benefit. Expand to several verified transitions before changing probabilities based on coaching history. Sourced career tendencies can still be useful context, with an explicit time period.

Fourth-down recommendations need their own work. Begin with the score, possession and field-position tradeoff. Later compare go, kick and punt with a validated league-specific model and visible uncertainty. The public NFL model is a possible reference, but its field-goal component uses distance and roof type rather than kicker skill or weather; it is not a ready-made college model. [nfl4th methodology](https://www.nfl4th.com/).

**5. Turn post-game review into an improvement loop**

The journal already preserves displayed prompts, source revisions and timing, and the review can match final records by game/play ID. The missing piece is a repeatable cross-game evaluation, not another retrospective summary.

1. Collect voluntary journal exports from complete sessions, preserving exactly what the app knew and displayed at each moment. Start with the export workflow already present; a central collection service is a separate product decision.
2. Compare those snapshots with final records. Separate incorrect parsing, late/corrected source facts, new enrichment, repeated or obvious prompts, and TV-sync failures. A final report is a reference that can still be corrected, not video proof of every tactical detail.
3. Replay candidate selection and probability changes on the original time-ordered inputs. Preserve what was unknown at the time. Do not let post-game charting or the next play’s result influence an earlier prompt.
4. Tune on earlier games and evaluate on untouched later games. Keep a baseline so we can establish whether the change helped. Use the same definitions for sacks, scrambles, penalties and the outcome being forecast; existing journal links are correctly not yet scored as prediction accuracy.
5. Evaluate usefulness as well as prediction: have regular football viewers mark prompts useful, obvious or unsupported. Test learning with a different verified example of the same concept, not whether someone guessed run/pass or clicked a button. Treat early user testing as directional evidence, not proof of learning gains.

This creates reviewed model and content updates. It does not silently retrain the live product after each game or reward explanations for agreeing with incomplete data.

**6. Delivery order and checks**

| Release | Scope | What should visibly improve | Release check |
|---|---|---|---|
| First: level consistency and relevant cards | Fix all beginner fallbacks; add contextual fourth-down/late-game copy; use existing drive and player facts; align optional questions with their cue; suppress repetition. | The default assumes familiarity with football and says something specific about this situation. | Replay NFL and college examples across all downs, special teams, missing data and corrections. Default never silently uses Beginner-only teaching. |
| Second: historical comparison | Add score/time baselines after evaluation; connect team/opponent history to live patterns; improve evidence disclosures. | “What they usually do in this situation” becomes meaningful, with a visible comparison to this game. | Chronological evaluation and calibration review by league/context; matched live/historical definitions; sample and missing-data checks. |
| Third: deeper review and learning | Expand verified historical examples and run exported-journal audits; use post-game charting for supported explanations. | Review tells us what the live app missed and lets viewers practice recognizing an idea on another play. | Exact play joins, as-of replay, source labels, no inferred routes or causal explanations; viewer usefulness feedback. |
| Later, if justified: richer live feed | Bounded CFBD trial first; evaluate licensed NFL detail if demand warrants it. | Additional live insights only where the trial demonstrates useful, timely fields. | Coverage, latency, corrections, quota/cost and access rights checked before adoption. |

These are release slices, not calendar estimates. The first release does not depend on a new data subscription. The evaluation work can begin with the journals and reviewed games we already have.

Preserve the existing data boundary throughout: raw reports belong to LIVE; PRIME receives only approved pre-snap context. A new selection module may combine safe current context with structured aggregates from **already released** plays. Do not pass raw reports or unreleased outcomes into PRIME. Every added insight, score and aggregate must follow the viewer’s TV delay, including scores in the Games picker. Add a delay regression for that existing picker leak as part of the trust checks.

Start with deterministic calculations and authored language. A runtime language model is not necessary to make these improvements. If one is later used for phrasing, it must render an evidence-backed fact object and cannot supply missing football facts.

**How confident we should be**

- **High confidence in feasibility:** fixing the fourth-down fallback and using existing released drive/player facts can make the default substantially more specific. Source correctness and timing still limit individual claims.
- **Promising, with measured evidence:** score/time context improves the retrospective NFL forecast. Live performance, college transfer and the quality of the final printed probabilities still need validation.
- **Unproven:** coaching-history adjustments improve forecasts broadly, or richer prompts measurably improve a viewer’s learning. Both can be tested.
- **Not supported by the current feed:** exact route combinations, coverage assignments, blocking responsibility or why a defender reacted. We can teach someone what to watch; identifying those details on the actual play requires charting or suitable video evidence.

The goal for the next version is a small number of well-timed observations that make a regular football viewer notice something they otherwise might miss, while Beginner remains welcoming to someone learning the sport.
