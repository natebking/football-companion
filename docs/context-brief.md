# Football Companion: Project Context

Pairs with `football-companion-prompt-scaffold.md`. Drop both into a new chat to resume without re-explaining.

---

## What I'm building and why

A second-screen companion for watching college and pro football that helps me understand what is actually happening on the field. I know very little about play design, formations, or scheme. I want the quality of analysis a serious analyst would give, delivered in a way that teaches someone starting from close to zero.

The goal is not stats. I do not want a fantasy dashboard or a win probability tracker. I want to become someone who can look at the field and read it.

Success looks like: after a season of using this, I recognize concepts on my own and need the companion less.

---

## Where I started vs. where the design landed

**My opening framing:** the hard part is vision. I need the system to see what is on my TV, probably via me photographing the screen, which is too clunky to actually use.

**Where we ended up:** vision is mostly the wrong bet, and the delay between the live data feed and my broadcast is an asset rather than a problem.

Key turns in the reasoning:

1. Post-snap data is cheap and solved. Play-by-play APIs give down, distance, result, and an EPA-style value on every play, in near real time.
2. Pre-snap alignment data does not exist for consumers at any price. NFL Next Gen Stats tracking and PFF charting are not available live. So no feed will ever tell me the formation or coverage.
3. That gap initially argued for vision or audio input as the only route to pre-snap understanding.
4. Then the better idea: replace formation labels with **situational tendency**. "This offense throws here 78% of the time and the tight end is the usual target, watch the middle of the field" teaches me more than "trips right, 11 personnel" does at my level, and it is computable from historical play-by-play I already have access to.
5. Which means no vision at all in v1, and no audio scaffolding either.

**Rejected approaches and why:**

- *Manual screenshot upload:* too much friction, would not survive week two
- *Continuous screen capture + VLM:* legal gray area, expensive, and solves a problem tendency data solves better
- *Phone mic listening to the broadcast with Whisper:* clever and perfectly synced by construction, but unnecessary once tendency replaced formation as the pre-snap content
- *Raw stat surfacing:* explicitly not what I want

---

## The core architectural insight

My broadcast runs 20 to 45 seconds behind the live data feed. That means the system knows the future for half a minute.

This unlocks three things a real-time system cannot do:

1. **Zero-latency rendering.** Multi-step LLM work, diagram generation, and revision all happen during the lag window. The card is finished and queued before the snap appears on my screen. No spinner, ever.
2. **Attention priming.** "Watch the slot receiver" before the snap is the highest-value teaching act available, and it requires knowing the outcome. Direct my eyes first, explain after.
3. **Curation.** Most plays are noise. With a lookahead buffer the system can score upcoming plays for teaching value and stay silent through boring ones, lighting up only on plays that demonstrate something I am currently learning.

So the system is not a computer vision problem. It is a scheduler sitting on a delay line, plus a curation policy, plus a pedagogy model. Every hard part is software I control.

---

## Sync mechanics

Need one number: broadcast offset.

- Acquire with a single tap. I tap when I see a snap, system diffs against the feed timestamp for that play.
- More robust alternative: one screenshot of the score bug, OCR the game clock, reconcile against the feed's clock at each play.
- Release rule: `release_at = feed_event_time + measured_offset + safety_pad`
- Safety pad of 5 to 8 seconds is mandatory. Feed latency is variable. If feed lag ever exceeds broadcast lag, the play gets spoiled. **Failing late is invisible. Failing early ruins the product.**
- Drift is real over three hours from commercial breaks and replay reviews. Re-anchor at quarter boundaries automatically, plus a permanent one-tap resync for DVR pauses.

---

## Data sources evaluated

| Source | Notes |
|---|---|
| CollegeFootballData.com | Free API key, live data on paid Patreon tiers, deep historical for tendency computation. Primary for college. |
| cfbfastR | R wrapper over CFBD plus live ESPN play-by-play |
| ESPN undocumented endpoints | Free, fast, well-documented by the community. Primary for NFL in v1. |
| Sportradar NFL API | Push feeds for real-time customers, full PBP on every game including preseason. The contractual option if ESPN scraping gets fragile. |
| SportsDataIO, BallDontLie, MySportsFeeds | Alternatives, not evaluated in depth |
| Next Gen Stats, PFF | The data I actually want. Not available. |

---

## What the API actually returns

Important expectation-setting. A play object is roughly:

```json
{
  "down": 3, "distance": 6, "yardLine": 32,
  "playType": "Pass Reception",
  "playText": "Orji pass complete to Loveland for 14 yards",
  "yardsGained": 14, "ppa": 1.42
}
```

A sentence and some numbers. No formation, no coverage, no route concept. The teaching content is not in the feed. It comes from two things I build: situational history aggregated from past plays, and an LLM's football knowledge applied to a thin text description.

**The API is plumbing. The product is everything on top of it.**

---

## The known accuracy risk

Schematic narration ("that's a seam route") is inference from a text string, not observation. The model will sometimes call a crosser a seam.

Mitigation is threefold and all of it is in the scaffold doc:

1. A truth boundary in the system prompt that separates verified tendency data from thin play text from model inference, with mandatory hedging on the third category
2. A per-card correction tap that decrements concept confidence and eventually stops the system asserting a concept it has been corrected on
3. Leaning hard on tendency percentages, which are computed and verifiable, and letting schematic language stay soft

---

## Pedagogy model

The differentiator is not the analysis, which is commoditized. It is the scaffolding.

- **Concept ledger:** persistent per-user record of every concept, how many times I have seen it, and when. State machine runs unknown → introduced → learning → familiar → dormant.
- **Depth gradient:** first exposure to Cover 3 gets a full explanation. Tenth exposure just says "Cover 3." A card getting shorter is the system working correctly.
- **Spaced re-surfacing:** concepts unseen for 21+ days go dormant and get re-introduced at a shallower depth.
- **Two registers:** prime cards (pre-snap, under 25 words, attention-directing, must not spoil) and explain cards (post-play, 40 to 70 words, name the pattern and the consequence).
- **Consequence over statistics:** never print a raw PPA or win probability. Translate to plain stakes.

---

## Design tension I flagged and still believe

"Pro-grade analysis for a beginner" is a genuine conflict, not a formatting problem. Coach-level analysis assumes 200 shared terms. Translating live costs more words than fit between snaps.

My position: **v1 should be aggressively shallow and fast.** Depth belongs in a post-game review mode with no time pressure, where I can scroll back through drives. Trying to be deep in real time is how this becomes a thing I stop opening.

---

## Open threads

- Scoring function for teaching value is drafted in the scaffold but untuned. Target roughly one card per four to six plays.
- Cold start: week 1 has no current-season tendency data. Fall back to prior season, flag as low confidence so the model hedges the percentages too.
- Watching two games at once: concept ledger is global, tendency cache is per team, card density needs a global cap.
- Post-game review mode: same scaffold, no spoiler constraint, much deeper. Probably where the real learning happens. Build second.
- Not yet discussed: delivery surface (phone app, tablet, web), buffer storage, whether prime cards need diagrams or stay text-only.

---

## My preferences for this project

- No em dashes
- Push back on my ideas rather than agreeing by default
- Times in PST, with the standardized zone in parentheses if different
- I have a technical background: I build Pine Script indicators, run a market data pipeline, and have shipped API products, so implementation detail is welcome rather than intimidating
