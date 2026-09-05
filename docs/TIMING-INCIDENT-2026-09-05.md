# Oregon–Boise State timing incident

On September 5, the companion displayed Q4 14:49 across multiple new plays. The user also reported that the feed did not match TV. These were investigated separately; the TV-to-feed offset cannot be recovered from a screenshot of a game clock.

## Evidence

- At 22:26:05–22:26:42 UTC, ESPN's summary advanced from 139 to 140 rows, including a new play ending in 623, while its header and new play clocks remained 14:49. The scoreboard and core status endpoint also returned 14:49. Cache-busted responses agreed, with current response dates and short cache lifetimes. No reliable alternate clock appeared in the latest written reports.
- The user's still-open browser showed play `401858433615` as an incomplete pass, next third and three. Its stored visible source report read `Shotgun #4 M.Madsen pass incomplete short to #19 R.Jones`. ESPN's current record for that same ID included pass interference, 15 yards, NO PLAY, and a first down at BOIS 47.
- The old app skipped every previously seen play ID, but rebuilt the next-snap card from the newest source record. That explains how an old play description could remain beside a corrected next-down card.
- During verification, ESPN's header later advanced to 8:15 while earlier play records still contained 14:49. Source recovery must clear a current warning without restoring known unreliable historical timestamps.

The committed `tests/fixtures/feed-health.json` contains selected actual source records. The regression tests also use explicitly constructed mutations to exercise before/after corrections; those mutations are not presented as captured ESPN responses.

## Changes

Play records now have content versions. Revisions update existing rows in source order through the same TV-delay queue. Superseded queued reports and their next-snap cards cannot flash or settle a pick. Older corrections and backfilled plays do not become the latest play, move the scoreboard backward, grade a new prediction, or become timing samples. Changes to grading evidence invalidate the original prediction record instead of grading the play twice.

The large down-and-distance heading now uses the same normalized numbers as its tendency and field diagram, rather than an independently supplied text label.

`web/feed-health.js` detects a repeated clock across at least three distinct eligible scrimmage plays. It does not declare a clock broken just because wall time passed. Pauses, kicks, penalties and untimed overtime do not establish a stall. Affected play timestamps are omitted; a stalled current header says ESPN's clock is not updating. No ticking clock is invented. Known-stalled clock values are withheld from clock-dependent card selection.

“Feed responding” describes request success. TV delay shows the age of the last successful response separately from the last new or revised play. Diagnostics record source/displayed play IDs and versions, next-card source, label mismatches, revision counts, observation/release times, and configured delay.

The TV-delay panel can measure a newly received play: tap when it finishes on TV, then explicitly apply the measured delay. Initial history and late backfills cannot be sampled. The selected play stays fixed while being compared; a corrected report invalidates its sample. “My TV is ahead” explains that added delay cannot speed up ESPN and offers 0 seconds.

## Limits and validation

This handles app reconciliation and makes source uncertainty visible. It cannot make ESPN publish sooner or reconstruct a missing official clock. Timing samples depend on the viewer matching the correct play and tapping near its end; several samples are preferable to treating one as exact.

Regression checks cover repeated clocks and recovery, delayed revisions, superseded next cards, older backfills, grade invalidation, normalized headings, and timing-control edge cases. Browser verification uses the live college feed and the TV-delay dialog.
