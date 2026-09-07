# Checking practice exports

`scripts/audit-practice.mjs` checks one browser export against the example bank that supplied its questions. It verifies the bank version/hash, exact question and source-play facts, answer choices, recorded result and timestamps. An unavailable bank or changed evidence stays unverified. The audit never rewrites a saved answer.

Results are counts by question, selected teaching level and prior exposure. First recorded attempts, repeats, unknown prior history, unanswered questions and “Not sure” remain separate. A question about a previously opened target is a repeat even if it asks something different. Later opening of the full explanation does not retroactively make an earlier question a repeat. The recorded level is not treated as a person's experience level.

```sh
node scripts/audit-practice.mjs --origin viewer \
  --out data/journals/practice-audit.json /absolute/path/to/football-practice.json
```

Use `--bank /path/to/teaching-examples.json` for an archived bank. Use one complete export per browser history; exports contain no participant identity, so multiple files must not be counted as distinct viewers. `--origin viewer` or `--origin qa` records the analyst's declaration, not independently verified identity. Input, bank and audit-code hashes are retained. Private exports and full reports stay in ignored `data/`.

The only available practice export is from the earlier isolated browser QA. Its two answered attempts match the exact bank: one supported answer and one unsupported answer. Both have unknown prior-target history because the QA export predates that field. They are **QA checks**, not viewer responses or learning evidence. The report is `data/qa/recognition/practice-audit.json` and is explicitly marked `qa`.

Five focused tests cover repeat targets, unknown history, unanswered/unsure responses, changed source/question versions, invalid timing and duplicate IDs. There is no new browser collection or live-model change. Opening an example does not prove it was read; interpretation of supplied written facts does not establish video recognition, learning gains or the superiority of one teaching level. Genuine voluntary viewer responses and a suitable comparison are still needed.
