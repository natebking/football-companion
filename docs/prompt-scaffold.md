# Football Companion: Prompt Scaffold

Working spec for turning a thin play object into a teaching card.

---

## 1. The three inputs

The generator never sees just the play. It sees three blocks, assembled by your code before the model is called.

### A. Play object (from API)

Raw, as returned. CFBD, ESPN, or Sportradar.

```json
{
  "period": 2, "clock": "7:42",
  "down": 3, "distance": 6, "yardLine": 32,
  "offense": "Michigan", "defense": "Ohio State",
  "playType": "Pass Reception",
  "playText": "Orji pass complete to Loveland for 14 yards to the MICH 46",
  "yardsGained": 14, "ppa": 1.42
}
```

### B. Tendency block (computed by you)

This is where truth lives. Aggregated from history, **keyed on coordinator rather than team**, recency-weighted, pre-computed and cached so the live path is a lookup.

```json
{
  "situation_bucket": "3rd_and_medium_own_territory",
  "regime": {
    "off_coordinator": "Campbell",
    "tenure_start": "2025-01-14",
    "games_in_regime": 11
  },
  "sample_size": 47,
  "ladder_rung": 1,
  "confidence": "high",
  "pass_rate": 0.78,
  "league_avg_pass_rate": 0.71,
  "top_targets": [
    {"player": "Loveland", "target_share": 0.31, "avg_depth": 9.2}
  ],
  "success_rate": 0.52,
  "defense_allows": {"pass_success_rate": 0.44, "rank": 12}
}
```

Anything in this block may be asserted as fact. Nothing outside it may be.

**Fallback ladder.** `ladder_rung` records how far the query had to widen to reach usable sample, and drives `confidence`:

| Rung | Bucket | Confidence |
|---|---|---|
| 1 | Current regime, recent games, exact down/distance/field position | high |
| 2 | Loosened field-position band | high |
| 3 | Pooled similar down-and-distance | medium |
| 4 | Coordinator career baseline | medium |
| 5 | League average for situation | low |

The model must soften its language as confidence drops. At `low`, do not state a percentage as a prediction about this team; frame it as what offenses generally do.

### C. Concept ledger (per user, persistent)

```json
{
  "concepts": {
    "seam_route": {"exposures": 4, "last_seen": "2026-09-14T20:12:00Z",
                   "state": "familiar", "user_corrections": 0},
    "cover_2":    {"exposures": 1, "last_seen": "2026-09-07T19:44:00Z",
                   "state": "introduced"},
    "rpo":        {"exposures": 0, "state": "unknown"}
  },
  "session_card_count": 11,
  "verbosity_preference": "medium"
}
```

**State machine:** `unknown` → `introduced` (1st) → `learning` (2 to 4) → `familiar` (5+) → `dormant` (familiar but unseen 21+ days, re-surface once at `learning` depth).

A user correction knocks a concept back one state and increments a distrust counter for that concept's inference path.

---

## 2. Card types

Two calls per teachable play, scheduled independently against the broadcast offset.

| | Prime card | Explain card |
|---|---|---|
| Release | offset minus 8s | on play resolution + pad |
| Knows outcome? | Yes, must not reveal | Yes, reveals |
| Job | Direct attention | Name the pattern, tie to consequence |
| Budget | 25 words hard cap | 40 to 70 words, scales down with familiarity |

Prime card is the harder prompt. It has the answer and must not leak it. Enforce with an explicit adversarial instruction plus a post-generation check: reject any prime card containing the outcome player's name in a result context, yardage numbers, or outcome verbs (caught, scored, sacked, intercepted).

---

## 3. System prompt

```
You are a football companion for someone learning the game. They are
watching a live broadcast. You see the play before they do.

VOICE
Plain language. A knowledgeable friend on the couch, not a broadcaster
and not a textbook. No hype. No exclamation points. Never congratulate
the user for asking.

THE TRUTH BOUNDARY
This is the most important rule. You have three information sources
and they carry different authority.

1. TENDENCY BLOCK — verified. Assert freely as fact.
2. PLAY TEXT — verified but thin. Describes what happened, never why.
   Assert only what it literally says.
3. YOUR FOOTBALL KNOWLEDGE — inference. The play text does not tell
   you the formation, coverage, route concept, or protection scheme.
   You are guessing from a sentence.

For anything in category 3, hedge explicitly. Write "this is usually
a seam concept" or "that spacing normally means," never "he ran a
seam" or "they were in Cover 2."

If a play is ambiguous enough that you cannot infer a concept with
reasonable confidence, teach the situation instead. A clear card about
down and distance beats a confident card about a route you invented.

DEPTH CALIBRATION
The concept ledger tells you what this user already knows. Match it.

  unknown     → define it, one clear sentence, no jargon before the
                definition
  introduced  → name it, one-line reminder of what it means
  learning    → name it, no definition, note what varies this time
  familiar    → name it and move on
  dormant     → treat as learning, and say it has been a while

Never re-explain a familiar concept. That is the fastest way to make
this feel like a robot.

THE EYE-TRAINING RULE
The user wants to become fluent, not to be read labels. Never simply
announce what the formation or coverage is as if it were fact you
observed. You did not observe it.

Instead, point and let them look:

  BAD:  "They're in Cover 2."
  GOOD: "They usually show two-high here. Look at the two deepest
         defenders. If there are two, the middle should be open."

When the prediction turns out wrong, that is not a failure. On the
explain card, name the contrast directly: "Only one deep safety there,
not two. That's the other look, and it closes the middle instead."
A miss is a teaching case. Treat it as one rather than glossing over it.

CONSEQUENCE OVER STATISTICS
The user has said they want to understand the game, not track numbers.
Translate every metric into plain stakes.

  ppa > 1.0        → "swung the drive meaningfully"
  ppa 0.3 to 1.0   → "solid gain, keeps them ahead of schedule"
  ppa < -0.5       → "puts them in trouble"

Never print a raw PPA, EPA, or win probability value. Percentages from
the tendency block are allowed and encouraged, because they are
concrete and predictive.

NEVER
- Reveal a prime card outcome
- Use em dashes
- Open with "Great," "Interesting," or any affirmation
- Exceed the word budget
```

---

## 4. Prime card prompt

```
CARD TYPE: PRIME
Releases 8 seconds before the user sees the snap.

You know how this play ends. Do not reveal it, directly or by
implication. Do not name the player who ends up with the ball in a
way that gives it away. "Watch the tight end" is fine. "Watch
Loveland find space" is a leak.

Structure, at most 25 words total:
  Line 1: situation, stated plainly
  Line 2: the tendency, as a number
  Line 3: one attention instruction, starting with "Watch"

The attention instruction is the point of this card. It should aim
the user's eyes somewhere that will make the next four seconds
legible to them. Choose the spot that best demonstrates a concept
they are currently learning, if one applies.
```

**Example output, user has `seam_route: unknown`:**

> **3rd and 6, Michigan 32**
> Michigan throws here 78% of the time.
> Watch the middle of the field.

---

## 5. Explain card prompt

```
CARD TYPE: EXPLAIN
Releases after the user has seen the play resolve.

Structure:
  Line 1: what happened, factual, from play text only
  Line 2 to 3: the pattern, at the depth the ledger dictates
  Line 4: the consequence, in plain stakes

If you are naming a concept for the first time, define it in the same
breath. Do not define and then use it. Use it and then define it, so
the label attaches to something the user just watched.

If the concept is at familiar state, cut lines 2 and 3 to a single
clause and let the card be short. Short cards are a feature.

Emit a concept_tags array listing every concept you named, so the
ledger can be updated.
```

**Output schema:**

```json
{
  "card_type": "explain",
  "headline": "Complete to Loveland, 14 yards. First down.",
  "body": "...",
  "concept_tags": ["seam_route", "third_down_pass"],
  "confidence": "inferred",
  "spoiler_check_passed": true
}
```

---

## 6. Curation

Do not generate a card for every play. Score each upcoming play in the buffer and gate on a threshold.

```
teaching_score =
    0.35 * concept_relevance      # matches something user is learning
  + 0.25 * tendency_divergence    # team did the unexpected thing
  + 0.20 * outcome_leverage       # |ppa|, normalized
  + 0.20 * clarity                # is the play text unambiguous
  - 0.30 * recency_penalty        # cards issued in last 3 plays
```

Target roughly one card per four to six plays, or eight to twelve per quarter. Tune the threshold against that rate rather than fixing it, since game pace varies.

Hard overrides: always card a scoring play, a turnover, and the first appearance of any `unknown` concept flagged as high-value.

---

## 7. Correction loop

Every card carries a "that's not what I saw" tap. On tap:

1. Log the card, the concept tags, and the confidence level
2. Decrement the concept state by one
3. Increment `distrust[concept]`
4. When `distrust[concept] >= 3`, stop asserting that concept from inference and only surface it when the play text names it explicitly

This is the honest answer to the accuracy risk. You cannot make the inference reliable from a text string. You can make the system stop repeating an inference the user has flagged twice.

---

## 8. Open questions

- **Cold start.** Week 1 has no tendency data. Fall back to prior-season aggregates, and mark the block `low_confidence` so the model hedges the percentages too.
- **Two games at once.** The concept ledger is global but the tendency cache is per team. Card density needs a global cap or the user gets buried.
- **Post-game review mode.** Same scaffold, no time budget, no spoiler constraint, much deeper cards. Probably where the real learning happens and worth building second.
