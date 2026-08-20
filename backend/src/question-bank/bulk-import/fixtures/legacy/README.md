# Legacy fixtures

Files here are **not seeded**. `seed-questions.ts` reads the fixtures directory
with a non-recursive `readdirSync`, so anything in this subdirectory is out of
the seed set without needing a rule in the code to skip it.

They are kept rather than deleted because the question text is authored work
that somebody may want to rewrite into the current format.

## `personality.csv`

Twenty-five Likert items — *Strongly agree / Agree / Disagree / Strongly
disagree*, each weighting a single trait on a ±2 scale.

The trait keys are still current (`adaptability`, `teamwork` and so on); what is
obsolete is the **shape** of the question. Behavioural questions have taken one
of four patterns since 2026-08-11 — `situational`, `forced_choice`, `trade_off`,
`ranking` — and Likert is not among them. The bulk importer therefore requires a
`pattern` column and rejects every row of this file:

```
personality.csv    0 imported, 25 failed
row 2: Choose a question pattern: situational, forced_choice, trade_off, ranking
```

That is the importer doing its job, not a bug in it. But `seed-questions.ts`
sets a non-zero exit code when any row fails, so while this file sat in the
seed set it turned every CI run red — and it could never have imported.

Stored answers from the old model are still handled: `ModuleSummary.legacyTraitModel`
marks results scored against a previous trait vocabulary so their numbers are
shown under their original names rather than mapped onto today's traits.
Tolerating old *data* and accepting new *imports* are different questions, and
only the first one is still true.

**To bring these back**, each item needs re-authoring rather than a column
adding: a Likert agree/disagree scale does not convert mechanically into a
situational question with distinct options and per-option behaviour labels.
`personality-behavioral.csv` is the model to follow.
