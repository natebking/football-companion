# Football Companion: Project Context

Pairs with `football-companion-prompt-scaffold.md`. Drop both into a new chat to resume without re-explaining.

---

## What I'm building and why

A second-screen companion for watching college and pro football that helps me understand what is actually happening on the field. I know very little about play design, formations, or scheme. I want the quality of analysis a serious analyst would give, delivered in a way that teaches someone starting from close to zero.

The goal is not stats. I do not want a fantasy dashboard or a win probability tracker. I want to become fluent: to look at the field and read it myself.

Success looks like: after a season of using this, I recognize concepts on my own and need the companion less.

---

## The failure mode to avoid

A previous attempt at this spec produced a page that just streamed play results. "Complete for 14 yards." That is a scoreboard, not a teacher, and dozens of apps already do it. When pushed on why it could not do more, it concluded that real analysis requires Next Gen Stats tracking data, which is not available to consumers, and stopped there.

That conclusion is half right and gave up too early. Tracking data is genuinely locked. But there are two ways to get analysis, and it only considered one:

- **Observation** (seeing the field, reading alignment) requires tracking data. Closed.
- **Inference** (situation plus historical tendency) is what human analysts do most of the time anyway, and it is fully computable from free play-by-play.

The old spec pulled only the result field and never computed the tendency layer.

---

## Where the design landed

**Original framing:** the hard part is vision. Photograph the TV, get analysis. Too clunky to survive week two.

**Actual design:** no continuous vision. The broadcast delay is an asset, and the user's own eyes are the confirmation layer.

### The delay is the core insight

My broadcast runs 20 to 45 seconds behind the live data feed. The system knows the future for half a minute. That unlocks three things a real-time system cannot do:

1. **Zero-latency rendering.** All LLM work happens during the lag window. The card is queued before the snap appears on my screen. No spinner, ever.
2. **Attention priming.** "Watch the two deepest defenders" before the snap is the highest-value teaching act available, and it requires knowing the outcome.
3. **Curation.** Most plays are noise. Score upcoming plays for teaching value, stay silent through boring ones, light up on the ones that demonstrate something I am currently learning.

### The eye-training loop (the pedagogical core)

I pressure-tested the tendency approach: if it says "the defense will likely do X" and X does not happen, does that break the learning? The resolution reframed the whole product.

**The system should never just label the formation for me.** If it reads me "Cover 2," I learn to read a label, not a field. The thing that builds fluency is being told *where to look and what to look for*, then seeing it myself.

The loop:

1. **Prime, hedged:** "They usually show two-high here. Look at the two deepest defenders. If there are two, the middle should be open."
2. **I look.** My eyes do the observation. This is the part that trains fluency.
3. **Reality confirms or contradicts.** If it is actually one deep safety, I just learned the difference by seeing both cases.

A miss is not a failure, it is a contrast case. This is why hedged probabilistic language ("they usually show") is not a weakness of the data, it is the correct pedagogy. The system points; I observe; the discrepancy teaches.

Optional surgical vision: a single-tap screenshot read when I am specifically curious about an alignment. Not continuous. Used sparingly so it does not replace my own looking.

**Rejected:** manual screenshot upload as the primary input (friction), continuous screen capture plus VLM (legal gray, expensive, solves a problem tendency solves better), phone mic plus Whisper (clever, synced by construction, but unnecessary), raw stat surfacing (explicitly not what I want).

---

## Data sourcing: what is real, what it costs

### College (build here first)

- **CollegeFootballData.com** — free API key, live data on a cheap Patreon tier
- **cfbfastR** — R wrapper, loads seasons 2014 onward, roughly 2.3M plays across 362 columns
- Clean, tidy, well documented, deep enough for tendency computation
- **Recommendation: prove the whole product on college.** Free, clean, and everything learned transfers to NFL.

### NFL (free data is good enough)

- **nflfastR / nflverse** — free, play-by-play back to 1999, 300+ columns, updated nightly during the season
- Better than college in one respect: explicit `shotgun` and `no_huddle` binary flags, and play description strings embed formation cues in plain text ("Shotgun", "No Huddle", "Punt formation")
- Fully sufficient for computing tendencies and for a model to enrich
- **Catch:** nightly, not in-game. The live layer still needs ESPN's free undocumented endpoints, or paid.

### Paid, and why not to

- **Sportradar** — realistic entry around $1,250/month, enterprise contracts into the thousands. Not a consumer product. Not worth it.
- **Rolling Insights** — live data from roughly $400/month
- **SportsDataIO** — tiers from roughly $25/month for basic stats, more for live

**Money does not buy better analysis. It buys lower-latency live delivery.** Free data carries the entire tendency engine. Only revisit paid if ESPN endpoint reliability becomes the thing blocking a working product.

### What no source has

None of these have pre-snap alignment. They tell you what happened, not how anyone lined up. So: tendency is fully covered by free data; the "look at the deep safeties" inference comes from the model plus my own eyes. That division is deliberate and stays.

---

## Tendency modeling: the regime problem

**The catch I raised:** teams change coaches, coordinators, and personnel. Blending years of history describes a team that no longer exists. Old data is not merely less relevant, it is actively wrong after a regime change.

Resolution has four parts.

### 1. Key on coordinator, not team

The unit of tendency is the **offensive coordinator** for offensive tendencies and the **defensive coordinator** for defensive ones. When the coordinator changes, the clock resets. Every play gets tagged with who was calling it, and live queries filter to the current regime. This solves most of the problem by itself.

### 2. Recency weighting within a regime

Teams evolve mid-season as personnel and opponents change. Exponential decay so recent games outweigh early ones. The read should track who they are now, not who they were in week one.

### 3. Sample-size fallback ladder

Filter tightly enough (current coordinator + recent games + exact situation) and you may have 11 plays. That is noise wearing a percentage sign. So widen progressively:

1. Tightest bucket: current coordinator, recent games, exact down/distance/field position
2. Loosen the field-position band
3. Pool similar down-and-distance situations
4. Coordinator's career baseline
5. League average for the situation

Every step down the ladder lowers the confidence flag, and the model hedges harder in the copy.

### 4. Deep history earns its keep elsewhere

The 1999-onward archive is not for "what will they do tonight." It is for:

- **Coordinator fingerprinting** — this caller, across every stop in his career, is pass-heavy on early downs. A stable trait that survives team changes.
- **Cold start** — week one, or a coordinator's first game with a new team, has no current data. Lean on the career fingerprint until the season fills in.

### Required enrichment: the coordinator mapping table

Play-by-play does not include who called the play. It does include team and date. So build a small join table:

```
team | start_date | end_date | head_coach | off_coordinator | def_coordinator
```

A few hundred rows covers years of a league. Coordinator histories are public. Build once, top up each offseason, join on date-into-range. **Probably the single highest-leverage enrichment in the build**, because it is what makes every tendency number trustworthy rather than a blend of eras.

**Caveat:** mid-season firings and quiet play-calling handoffs (head coach takes over the offense without a title change) are messy and the public record lags. Exception cases, and the confidence flag absorbs them: after a regime change the recent sample is thin by definition, so the system already hedges.

---

## Sync mechanics

Need one number: broadcast offset.

- Acquire with a single tap. I tap when I see a snap; system diffs against the feed timestamp.
- Alternative: screenshot the score bug, OCR the game clock, reconcile against the feed clock.
- Release rule: `release_at = feed_event_time + measured_offset + safety_pad`
- Safety pad of 5 to 8 seconds is mandatory. Feed latency is variable. If feed lag ever exceeds broadcast lag, the play gets spoiled. **Failing late is invisible. Failing early ruins the product.**
- Drift accumulates over three hours from commercials and replay reviews. Re-anchor at quarter boundaries, plus a permanent one-tap resync for DVR pauses.

---

## What the API actually returns

```json
{
  "down": 3, "distance": 6, "yardLine": 32,
  "playType": "Pass Reception",
  "playText": "Orji pass complete to Loveland for 14 yards",
  "yardsGained": 14, "ppa": 1.42
}
```

A sentence and some numbers. The teaching content is not in the feed. It comes from two things I build: coordinator-keyed situational history, and an LLM's football knowledge applied to a thin text description. **The API is plumbing. The product is everything on top of it.**

---

## Known accuracy risk

Schematic narration ("that's a seam route") is inference from a text string, not observation. The model will sometimes call a crosser a seam.

Mitigations, all detailed in the scaffold doc:

1. A truth boundary in the system prompt separating verified tendency data from thin play text from model inference, with mandatory hedging on the third
2. A per-card correction tap that decrements concept confidence and eventually stops the system asserting a concept it has been corrected on
3. Leaning on tendency percentages (computed, verifiable) and letting schematic language stay soft

The eye-training loop is itself a mitigation: I am the ground truth, not the model.

---

## Pedagogy model

The differentiator is not the analysis, which is commoditized. It is the scaffolding.

- **Concept ledger:** persistent record of every concept, exposure count, last seen. States: unknown → introduced → learning → familiar → dormant.
- **Depth gradient:** first exposure gets a full explanation. Tenth just says the name. Cards getting shorter is the system working.
- **Spaced re-surfacing:** concepts unseen 21+ days go dormant, return at shallower depth.
- **Two registers:** prime cards (pre-snap, under 25 words, attention-directing, must not spoil) and explain cards (post-play, 40 to 70 words, pattern plus consequence).
- **Consequence over statistics:** never print raw PPA or win probability. Translate to plain stakes. Tendency percentages are allowed and encouraged, because they are concrete and predictive.

---

## Design tension I flagged and still believe

"Pro-grade analysis for a beginner" is a genuine conflict, not a formatting problem. Coach-level analysis assumes 200 shared terms. Translating live costs more words than fit between snaps.

Position: **v1 should be aggressively shallow and fast.** Depth belongs in a post-game review mode with no time pressure. Trying to be deep in real time is how this becomes a thing I stop opening.

---

## Open threads

- Teaching-value scoring function is drafted in the scaffold but untuned. Target one card per four to six plays.
- Multi-feed, up to four games at once: requested as a future feature on 2026-09-05, not implemented. Proposed behavior: independent game state and TV delay for each feed, a shared concept ledger, and a global card/ask density cap. Layout and interaction details remain open.
- Post-game review mode: same scaffold, no spoiler constraint, much deeper. Build second.
- Not yet discussed: delivery surface (phone, tablet, web), buffer storage, whether prime cards need diagrams or stay text-only.
- Mid-season play-calling changes: detection heuristic, or accept the confidence flag as sufficient?

---

## My preferences for this project

- No em dashes
- Push back on my ideas rather than agreeing by default
- Times in PST, with the standardized zone in parentheses if different
- Technical background: I build Pine Script indicators, run a market data pipeline, and have shipped API products. Implementation detail is welcome.
