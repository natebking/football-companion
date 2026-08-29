# Prior art: has anyone built this?

Research run 2026-08-29 by a 10-agent sweep across commercial companion apps, beginner education products, indie/GitHub attempts, betting and analytics tools, legal and data licensing, market and retention history, and cross-domain teaching precedent. Verdict and citations below are the synthesis agent output, unedited.

# HAS THIS BEEN BUILT? — SYNTHESIS

## 1. VERDICT

**No. Nobody has built this, and — unusually — nobody has tried and failed at it either.** Every component ships in production today, split across two surfaces that cannot be combined by their current owners. The live pre-snap half exists on television: **ESPN's "MNF Playbook with Next Gen Stats"** (debuted Dec 22, 2025, powered by Adrenaline's TruPlay AI) puts dynamic run-pass probabilities on screen before the snap, and **Amazon Prime Vision's Coverage ID / Defensive Alerts** direct the viewer's eye pre-snap with a red circle. Both are aimed at self-described "avid fans" and "diehards," both are on a broadcast feed that is one-to-many and therefore **structurally incapable of holding per-viewer knowledge state**, and both answer the question rather than asking it. The adaptive-beginner half exists on phones: **See the Field** (iOS, free, released Mar 18, 2026, 2 ratings) teaches a beginner to read coverage from safety depth and corner alignment with an adaptive rating engine — and has no live data of any kind. The precise gap: **no product anywhere pairs a situational tendency computed from free play-by-play with a withheld-label attention instruction, on a phone, during a live snap, adapting to what the user has already learned.** The nearest analogue in any sport is empty too — a targeted search for a beginner-facing live tactical companion in soccer returned only coach tools. The single most uncomfortable fact in the research: See the Field's author published your pedagogy for free in March 2026 as a static web guide ("Count the safeties. One high or two high?… Check your read. Was your pre-snap guess right?") and could only illustrate the tendency number with a hypothetical — *"if a team runs 70% of the time from I-Formation"* — because he has no data pipe. He wrote the sentence shape and could not fill it.

---

## 2. THE EIGHT NEAREST THINGS

Axes: **AUD** = true beginner · **GOAL** = teach unaided reading · **TIME** = pre-snap · **METH** = situational tendency from play-by-play · **PED** = adapts to a learner. ✅ match · ⚠️ partial · ❌ diverge · ⛔ opposite.

| # | Thing | AUD | GOAL | TIME | METH | PED | Score | Precise divergence | Status |
|---|---|---|---|---|---|---|---|---|---|
| 1 | **See the Field** (iOS, Scott Brereton, free, v1.0.6 Jun 14 2026) | ✅ | ✅ | ❌ | ❌ | ✅ | **3.0** | Identical thesis, identical vocabulary, zero live game. A flight simulator, not the cockpit. Its 524 concept cards and 20-coverage taxonomy are ~70% reusable content, ~0% reusable engineering. | Alive, **2 ratings**, one of the author's seven side projects |
| 2 | **Gamr: Football IQ Training** (iOS/Android, Dormhub LLC, free + $9.99/mo) | ⚠️ | ⚠️ | ❌ | ❌ | ✅ | **2.5** | "Duolingo for football," but the review corpus reveals player trivia (*"should accept multiple colleges for players who attended several"*) and position tracks for QB/CB/OT. Teaching IQ to play, not to watch. | Alive, monetizing, **69 ratings, 4.5★** |
| 3 | **Pizzaratops/FirstDown** (GitHub Pages, German, 220KB single file) | ✅ | ✅ | ❌ | ❌ | ⚠️ | **2.5** | The **only working concept-mastery mechanic found in football**: a real Leitner scheduler (`bucket/lastSeen/nextDue/streak`, mastered cards drop out, persisted to localStorage). But `fetch(` appears zero times, `"Prozent"` zero times, and it teaches by naming things. | Alive, **abandoned May 19 2026**; author pushed 5 other repos on Aug 29 2026 |
| 4 | **ESPN MNF Playbook / Adrenaline TruPlay AI** | ⛔ | ❌ | ✅ | ⚠️ | ❌ | **1.5** | **Owns your card.** "Dynamic run-pass probabilities… adjusting to personnel, formations and pre-snap movement," trained on 370,000+ plays, over a 22-man all-field camera. Explicitly "tailored for its **most avid fans**." Needs two staff analysts on air weekly as "resident data translators" — a concession that the numbers are illegible without a human. | Shipped 5 games Dec 2025–Jan 2026; **absent from ESPN's Aug 19 2026 NFL rollout** |
| 5 | **Amazon Prime Vision with Next Gen Stats** | ⚠️ | ⛔ | ✅ | ⛔ | ❌ | **1.0** | The anti-thesis, and the strongest one. Coverage ID prints "Zone" before the snap; Defensive Alerts circles the likely blitzer. Producer Alex Strand, on the beginner: *"Someone who might not know the game as well might see the red circle and say, 'Look here, something might happen.'"* It points **and** answers in the same frame, so nothing is retained. Requires RFID tracking you cannot buy. | Alive, expanding; features **promoted onto the main TNF feed**, which averaged 15.33M viewers in 2025 |
| 6 | **CBS Sports PrePlay Football** (2013) | ⚠️ | ❌ | ✅ | ⚠️ | ❌ | **1.5** | The only mainstream product that ever ran a **pre-snap interactive loop on a phone during a live football game** — predict every down of every drive. Prediction as a game, not as instruction. Raised $4.7M Series B Apr 2013. | **DEAD** — acquired by FanVision Sept 2014, consumer apps gone |
| 7 | **marktrovinger/RunPassBot** (2016–17) | ❌ | ❌ | ✅ | ✅ | ❌ | **2.0** | The only open-source attempt at your exact data mechanic: `GradientBoostingClassifier` on `['ScoreDiff','down','qtr','ydstogo','yrdline100']` over 2009–2015 nflscrapR. Delivers a prediction, teaches nothing. **The live half is 229 bytes and raises `NameError` on import.** | **DEAD** — 13 of 16 commits in 9 weeks, then a meetup talk Jan 19 2017, both issues bulk-closed Jan 21, never touched again |
| 8 | **Simplebet → DraftKings "Next Play"** | ⛔ | ⛔ | ✅ | ✅ | ❌ | **1.5** | *"first-of-their-kind, allowing users to bet, rush or pass"* — Sept 8, 2021. Your core inference has run in production for five years, monetized as a wager, never shown to anyone as a number to learn from. | Succeeded and absorbed: DK agreement Aug 28 2024, closed Dec 3 2024; **simplebet.io no longer resolves** |

**Honorable mention, wrong sport, right mechanism:** **uHIT Baseball** (deCervo) and gameSense Fastpitch-IQ — video temporal occlusion, forced call, then reveal. Pointed at players in a training room, not spectators during a broadcast. This is the only embodiment anywhere of the pedagogy with the best evidence behind it (see §4).

---

## 3. WHY IT DOES NOT EXIST

Ranked by strength of evidence. **The dominant reason is (c).**

### (c) DOMINANT — Nobody with the skill has the motive. This is unglamorous work in a field whose gravity pulls the other way.

The evidence here is not inferential, it is a pattern of four independent post-mortems all landing in the same place.

1. **Every hobbyist who successfully got a live football feed working pointed it at betting.** Verbatim, r/CFBAnalysis 2021-09-02: *"I was able to successfully grab data off the ESPN api last night… I use the current score, time remaining, possession, yards to goal, down, and distance figures to plug into my real time win probability, final margin expectation and final total expectation models **for live betting purposes**."* That is the gravity well.
2. **The NFL Big Data Bowl is a hiring pipeline** — 75+ participants hired into sports analytics, 60+ into the NFL. The reward for being good at this is a team job or a bettor-facing product. Neither is a consumer teaching app.
3. **Every attempt found was one person who stopped inside 12 weeks, and none of them hit a wall.** RunPassBot: 9 weeks of work, gave the meetup talk, closed both issues in the same second and left; the "no affordable real-time data source" line was added to the README ten months *after* work had stopped, and he never wrote enough live code to be blocked by data pricing. 4th & Inches: shipped a free app with a broken login, promoted it for three weeks, founder's last post of any kind is 2022-09-13. FirstDown: three weeks, 18 commits, all through the GitHub web UI, then back to fantasy basketball. See the Field: one of seven side projects, no company, no roadmap, release note "Bug fixes."
4. **The builder profile required is vanishingly rare**: fluent enough to model tendencies, still remembers being illiterate, and uninterested in both team-job money and betting money.

### (b) STRONG SECOND — The market has priced beginner football education at zero for 29 years.

- The NFL's own **Football 101 / Women's clinics** have run since ~1997, free or ≤$25, funded as team marketing. The league has served this exact audience for three decades and has never once charged for it.
- **Two independent apps shipped this genre within five weeks of each other in early 2026 — both free.** See the Field: 2 ratings. Gamr: 69. That is the market saying the idea is obvious, the build is cheap, and nobody has found the money.
- **The GIST**, built explicitly for people who "felt left out of the sports community," raised $1M seed in 2021, grew to ~1M subscribers, and only began testing a paid tier in April 2025 — **eight years to attempt subscription**.
- Where football-software money actually is: PFF ELITE $34.99/mo, GTO Wizard $49–279/mo, SumerPass $100/yr, SIS DataHub $749.99/yr. Every one of those prices is paid by someone who is already fluent.
- Altcast interest is **declining**, not growing: Nickelodeon 2.1M (2021) → 900k (Christmas 2023); ManningCast failed to crack 1M in any episode of its most recent season; **NBC ran no altcast at all for Super Bowl LX (Feb 2026)**.
- The NFL's own bet on converting new fans is culture, not comprehension — partnerships with Betches and The GIST (Nov 2025), a strategy their VP calls "helmets off."

### (d) REAL, BUT IT KILLED A DIFFERENT PRODUCT — the second-screen category died, and none of the dead were teaching apps.

GetGlue ($25M+ raised, ~3M users, dead Jan 1 2015), Zeebox/Beamly (10.5M MAU, app shut Oct 2015), IntoNow (Yahoo, ~$20M, dead Mar 31 2014), Viggle (757k MAU peak), PrePlay (acquired and killed 2014), Buzzer ($44M, Jordan and Durant on the cap table, **ceased operations May 2024**).

Named causes, and they transfer: *"people don't like to tend their apps while watching TV"* (MediaPost, Jul 3 2014); Beamly CEO Jason Forbes — *"These are awesome experiences, but they only work for a tiny subset of all viewership,"* with Beamly's own data showing **engagement happens before and after broadcast, not during**; of multiscreen users, only 12% check in and 15% ID content, versus 32% browsing and 21% chatting.

But **every one of these was a social/check-in layer with no standalone value**. The specific thing this product does — teach a skill during the event — has never been shipped and therefore has never failed. Treat this as evidence about the *form factor*, not the *idea*.

### (a) WEAKEST as an explanation, real as a routing constraint — legal and data barriers suppressed the NFL hobbyist stack but do not forbid this product.

- **The facts are unownable.** *NBA v. Motorola* (2d Cir. 1997) — real-time game facts are not the league's property. *C.B.C. v. MLBAM* (8th Cir. 2007, cert. denied) — names plus public playing statistics, commercially, without a license. *Feist* — facts are uncopyrightable. "3rd and 6, they throw 78%" is legally safe to display.
- **Zero enforcement events found.** Four query formulations for cease-and-desists, DMCA notices, or litigation against sports-data scrapers returned nothing. `nflscrapR` died of maintainer attrition and a backend change, not legal pressure.
- **But the 2020 shutdown did real damage.** The NFL's public GameCenter JSON feed went dark **2020-05-14**, killing `nflgame` (1,302 stars) and `nfldb` (1,083 stars) — the entire hobbyist live-NFL stack for a decade. Derek Adair's stated reason was legal, not technical: *"Due to the legal muck I've decided not to invest in this project anymore."* That is why every live hobby project since 2020 routes through ESPN's undocumented endpoints instead.
- **The contracts do say no.** Disney ToU §2.B.viii bans "build a business utilizing the Disney Products"; NFL.com §1.3 bans systematic retrieval and limits use to "individual non-commercial." *hiQ v. LinkedIn* settles the shape of this: no CFAA exposure (9th Cir., twice), but ToU anti-scraping clauses are enforceable as contract — **$500,000 judgment, Dec 6 2022**. And enforcement, when it comes, is not gradual: X's C&D took Nitter and XCancel offline in 48 hours after seven unenforced years.
- **The clean path exists and only for college.** CollegeFootballData, verbatim: *"Commercial use is permitted."* Tier 3 = **$10/mo, 75,000 calls, GraphQL with realtime data subscriptions.** Explicitly permits "free or paid websites, applications, dashboards."

**Bottom line on why:** this is a motivation-and-money vacuum, not a barrier. The one thing that genuinely cannot be bought — Next Gen Stats tracking, which has no consumer tier at any price and routes exclusively through Genius Sports — is a thing the design already doesn't need.

---

## 4. WHAT THIS MEANS FOR THE BUILD

### Validated by prior art

1. **Card shortening as the user learns is the single best-supported decision in the brief.** Kalyuga's expertise reversal effect: worked examples that help novices **actively hamper** learners with prior knowledge. Not polish. Without it the product degrades its own user. (*Instructional Science* 2009, 10.1007/s11251-009-9102-0)
2. **"No tracking data" is the only honest design, and it is a moat.** NGS has no published tier, no marketplace SKU, no AWS resale; Genius holds exclusive distribution; Big Data Bowl is non-commercial and stale (2018 passing plays). Nobody can undercut a PBP-only design by buying better data, because that data is not for sale. Amazon can only do Defensive Alerts because it owns the stream.
3. **Free play-by-play is genuinely sufficient.** `nflfastR` ships a trained expected-pass-probability model (`xpass`, `pass_oe`) **per play back to 2006**, with `down`, `ydstogo`, `yardline_100`, `score_differential`, clock, timeouts. RunPassBot got usable run/pass inference from five columns in 2016. There is no data moat and no modeling moat.
4. **Withholding the label is genuinely unoccupied and structurally defensible.** Every attention-direction feature verified — the red circle, the green orb, printed "Zone" — points and answers in the same frame. No funded incumbent will stop doing that, because every incumbent's business is delivering the answer faster.
5. **The beginner is genuinely unserved.** Every product surveyed across six research angles self-describes for avid fans, diehards, bettors, analysts, coaches, or players. Not one accommodates a viewer who does not know "slot."
6. **Sub-2-second glanceable card then eyes back up** is the correct answer to the exact failure mode that killed the second-screen category.

### Contradicted by prior art

1. **"Concepts seen" is the weakest possible learner model.** Kellman's ARTS engine (UCLA, *Medical Teacher* 2018) sequences on **accuracy and response time**, and roughly halves time-to-mastery. Exposure count carries almost no signal. Sequence on speed-of-correct-call.
2. **There is no single right place to look.** Kelly et al., *Radiology* 2016;280(1): expert search patterns emerge **before** expert diagnostic accuracy does. And prescribed search patterns fail to improve resident accuracy, because experts use non-systematic free search. Write every instruction as a hypothesis to test, never as the answer.
3. **Never ship a standalone attention-training mini-game.** Fransen, *Sports Medicine* 2024: *"no consistent supporting evidence in favour of far transfer."* NeuroTracker's only three far-transfer studies: two null. Every rep must be a real situation from a real game.
4. **Do not price this as a subscription to beginners.** See §3(b).
5. **The during-play window may not be where the value is.** Beamly's own data said engagement is before and after. Deloitte (n=3,004 sports fans, Mar 2023): 77% multitask during games, but the feature wish list is real-time stats (35%) and camera angles (34%) — **education does not appear at all**.

### THE BIGGEST RISK YOU HAVE NOT CONSIDERED

You have accounted for tracking data, broadcast sync, and thin play text. Here is the one that attacks the reason the product exists:

> **Directing attention is a delivery mechanism, not a learning mechanism. Three separate literatures say pointing produces looking without producing understanding — and the product's entire differentiation rests on the claim that it produces understanding.**

The specific evidence:

- **"Eye Movement Modeling Examples guide viewer eye movements but do not improve learning"** — *Learning and Instruction*, 2022 (S0959475222000226). Cues moved saccades to the target locations; **learning performance was unaffected.** Replicating a 2017 null in *Computers in Human Behavior* (S0747563216306069). A counter-meta-analysis exists (Xie et al., *JCAL* 2021) but Wiley blocked retrieval, so I do not have its effect sizes.
- **Van Cauwenberge, Schaap & van Roy (2014), *Computers in Human Behavior*** (10.1016/j.chb.2014.05.021, 136 citations) — the experiment that tests your hypothesis directly. Second-screen viewing raised cognitive load and **lowered** factual recall and comprehension, and **task-relevant second-screen content did not significantly outperform task-irrelevant content.** Both were worse than single-screen.
- **Kelly et al. 2016** — you can install the gaze habit without installing the judgment, producing a user who *looks* like they can read the field and cannot.

This is worse than an unvalidated assumption. It is a mechanism that has been tested twice and come back null, in a product whose pitch is "labels teach nothing, so we point instead." The research says pointing alone also teaches nothing.

**And there is a specific, evidence-backed fix.** The one intervention in this whole literature with a large, field-transferring effect is **temporal occlusion**: Müller et al., *Sports Medicine* 2024;54(10):2597–2606 — 12 studies, 25 effect sizes, **d̄ = 1.21 [0.83, 1.59]**, with **field-based transfer d̄ = 0.85 [0.40, 1.30]** and no significant difference between video-test and real-field transfer. The operative ingredient is not the cue. It is **the forced commitment before the reveal** — cut the footage before the outcome, make the learner call it, then show what happened.

Which means the card as specified is one interaction short. It should not be:

> *3rd and 6 near midfield. They throw 78% here. Watch the deepest defenders.*

It should be:

> *3rd and 6 near midfield. They throw 78% here. Watch the deepest defenders — **are they inside or outside the marker?*** → **one tap** → resolve after the snap.

Corroborating evidence from three unrelated domains: pointing-and-calling (*shisa kanko*) cut Japanese rail inspection errors from **2.38 to 0.38 per 100 actions**, ~85%, and its distinguishing feature over passive looking is the multi-modal commitment (eye + hand + voice). Solitaire chess — the century-old "guess the move" method — is described as making it *"literally impossible to zone out: you have to pay attention in order to guess the next move,"* with the known cost being that it is *"time consuming and mentally taxing."* And uHIT Baseball is a shipping product built entirely on occlusion-plus-call.

The design consequence, and it is not free: **ration the commitment.** Do not ask on all ~130 plays; a casual viewer will quit. Ask on the plays where the tendency is sharpest and the eye-target is cleanest, and let the rest be silent.

**Runner-up new risks, both actionable:**

- **Ship college football first, not the NFL.** CollegeFootballData grants commercial use *in writing* for $10/mo with realtime GraphQL. The NFL path runs through ESPN or nflverse endpoints whose terms forbid building a business on them, and nflverse republishes NFL-sourced data under CC-BY-4.0 — a license it arguably lacks the right to grant. No privity with the NFL is a real defense, but "the upstream is unclean" is a diligence red flag any investor or acquirer finds in an hour. Same pedagogy, same cards, clean title.
- **The "78%" framing was publicly claimed eight months ago and may be dormant.** ESPN shipped it Dec 22 2025 and a broadcast trade publication described the intent as *"encouraging fans to watch the game the way players and coaches do — reading leverage, identifying matchups, and anticipating tendencies before the play unfolds."* MNF Playbook does **not** appear in ESPN's Aug 19 2026 NFL coverage announcement. Absence of evidence, not proof of cancellation — but the framing is claimed even if the audience isn't, and Adrenaline owns the engine and sells B2B to media companies.

---

## 5. COPY THESE OUTRIGHT

1. **See the Field's pre-snap scripts, verbatim as card templates.** They are public, free, unprotected, and independently converged on the same sequence — which is the best available evidence that the sequence is right. The four-step coverage read (count safeties → check corner depth → watch the snap → check your read) and the five-step formation read. Also steal its expectation-setter: *"You'll be wrong a lot at first. Defenses are designed to disguise their coverage."* That single sentence is what makes a wrong guess feel like progress instead of failure.
2. **FirstDown's Leitner scheduler.** ~20 lines: cards carry `{bucket, lastSeen, nextDue, streak}`, queue is `SR_CARDS.filter(c => c.bucket < 2 && c.nextDue <= now)`, new-first-then-due mixing, persisted to localStorage in a try/catch, mastered cards drop out. It is the only working concept-mastery mechanic in football, and it already implements "shortens cards as they learn."
3. **But sequence it on Kellman's rule, not See the Field's.** ARTS schedules on **accuracy AND response latency** to mastery. A concept is learned when the user calls it *fast* and right, not when they have seen it five times.
4. **undercut-f1's user-adjustable delay slider** (901 stars, actively maintained, "variable delay to sync to your TV"). It is the only project in any sport treating broadcast delay as a first-class user-facing control. Its existence proves users will configure the offset themselves rather than expect ACR magic. Then make it **re-checkable mid-game**, because YouTube TV ships a "Broadcast Delay: Decreased" toggle and Sky's Live Sync cuts ~22s to ~8s, and a user can flip either at halftime.
5. **The Peterson Identification System (1934), as the design template — better than any software found.** Three moves, all of which this product half-rediscovered: arrows point at the diagnostic feature; use only marks visible **at a distance in the field**, explicitly rejecting "bird-in-hand characters" (= what a viewer sees on a TV, not what a chip sees); and group **confusable** cases side by side rather than by taxonomy (= group similar-looking situations, not textbook categories). His stated principle — *"simplification, not amplification"* — is the whole brief in three words.
6. **Prime Vision's visual economy.** Producer Alex Strand: *"all we're doing is putting a single red circle on a player."* One mark, one place, no clutter. Copy the restraint; reject the label it carries.
7. **Gamr's proof that money exists — read correctly.** $9.99/mo with 69 ratings and a build shipping raw Supabase errors to users (`"infinite recursion detected in policy for relation profiles"`). Someone will pay ~$10/mo to be taught football on a phone. But its reviews say those payers are player- and coach-adjacent, not beginners. Do not read this as beginner willingness-to-pay.
8. **The one anti-pattern, from 4th & Inches: never put a login in front of a free companion app.** It shipped a free CFB scoreboard with a broken login wall in opening week and was gone within a season.

---

**Confidence caveats worth carrying forward:** MNF Playbook's 2026 status is unresolved (no announcement either way). Gamr's annual price is contradictory in its own App Store listing ($39.99 vs $79.99). The Xie 2021 EMME meta-analysis is the strongest counter-evidence to §4's central risk and I could not retrieve its effect sizes (Wiley 403). Sharp Football Stats — the best free consumer situational run:pass tool — went to a GoDaddy parking page between 2026-05-18 and today, so anyone who was scraping it needs a new source. Amazon, SVG, Deadline, X, and LinkedIn all blocked automated fetch; those details come from search-index snippets and secondary reporting.