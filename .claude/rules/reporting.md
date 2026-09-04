---
description: How reports are built — two layers, behavioural composites, the overall-score blend, per-item trait scales and repeat consistency probes.
paths:
  - "backend/src/reports/**"
  - "backend/src/queues/report-generation/**"
  - "backend/src/adaptive-engine/**"
  - "backend/src/database/seeds/check-report-pdf.ts"
  - "backend/src/database/seeds/regenerate-reports.ts"
  - "backend/src/database/seeds/check-random-baseline.ts"
  - "frontend/src/routes/recruiter-admin/AllReports.tsx"
  - "frontend/src/routes/recruiter-admin/QuestionAnalysis.tsx"
  - "frontend/src/routes/candidate/AttemptDetail.tsx"
---

# Reporting

Moved out of the root `CLAUDE.md` so it loads when you touch report building,
the adaptive engine's scoring, or the report pages, rather than in every
session. The rules themselves are unchanged.


Two-layer report per completed session:
1. **Summary** (from `reports` table) — ability scores, trait profile, strengths/weaknesses, rule-based hiring recommendation, violation counts
2. **Detail view** (queried live, not stored) — full question-by-question answer list (right/wrong, question text) and the full timestamped proctoring event list

Report generation runs asynchronously via a BullMQ job triggered on submission — the candidate should never wait for report computation.

**Every objective module states what its questions were worth to a guesser (added 2026-08-27).** `ModuleSummary.expectedByChance` sits beside `questionsCorrect` on the report page and in the PDF, so a section reads "3 of 12 correct · 3 expected by guessing alone" rather than a bare score. A candidate answering at random scores about 36/100 on a 12-question module — `STARTING_ABILITY` sits exactly on the reporting scale's midpoint and nothing corrects for guessing — and 36 with no context reads like a weak result rather than no result at all.

- Summed per question as `1 / options` by `expectedCorrectByChance` in `report-builder.ts`, never assumed from `MIN_OPTIONS`. Four-option items put chance at a quarter but the bank allows six, and quoting a quarter to a recruiter whose candidate faced six-option items understates what they did.
- **Stated on every objective section, never only the weak ones.** Shown selectively it becomes an accusation, which is a different feature (a response-validity flag) and a different decision. Shown always it is simply the scale the score sits on.
- It is a count, not a verdict: nothing here corrects a score, caps a recommendation or flags an attempt, and the narrative does not mention it. Same division of labour as the proctoring signals — surface the evidence, leave the judgement with a person.
- Null rather than zero when no question could be read. Zero would claim every correct answer was earned.
- Computed live in `buildModuleSummaries` from `responses`, which are kept permanently, so **completed sessions from before this change show it with no backfill.**

### Behavioural composites and the overall score (decided 2026-08-12)

A trait module on its own used to produce ten trait scores, a null `overallScore` and a permanent `borderline` — which read as "no result" for a candidate who had answered everything. So the report now derives five **role-relevant composites** from the workplace traits (Leadership Readiness, Team Collaboration, Reliability & Follow-Through, Adaptability Under Pressure, Integrity & Judgment). Each is a fixed authored weighting over the traits, defined in `reports/behavioral-profiles.ts` — rule-based, no learned weights, and a recruiter can reproduce any composite by hand.

`overallScore` is now **ability 70% / behavioural index 30%**, and whichever half the assessment did not measure drops out so the other takes full weight. This is a deliberate change from the earlier "traits never touch the recommendation" rule: what reaches the recommendation is fit for a kind of work, never a rating of the personality, and no single trait can move the outcome. Consistency, repeat-probe results and proctoring signals still reach it nowhere.

### Trait scores are measured per item, not against the authoring range (changed 2026-08-27)

A trait score is `sum` placed on the scale the **served questions** actually made possible, not the fixed `TRAIT_WEIGHT_MIN..MAX`. **50 is what answering at random earns**, 100 is picking the most indicative option every time and 0 the least.

The old fixed rescaling gave a random responder **57.6/100**, and on a personality-only assessment that is the whole `overallScore` — so a monkey came out as **"Recommended"** (`RECOMMENDED_AT` is 55). It was not an arithmetic bug: option sets are authored positive-skewed, because a good scenario question offers several defensible behaviours and one poor one. Across the starter bank the mean option weight is **+0.6, not 0** (`ownership` +0.79, `resilience` +0.83). A scale anchored on the authoring range therefore starts every candidate above its own midpoint. Re-authoring the 64 fixtures would have fixed those 64 fixtures; it would not touch a customer's own bank uploaded through bulk import, which nothing can police.

- The scale comes from `EvaluationService.achievableTraitRange`, which **runs every answer a candidate could have given through the real evaluators** and looks at what came out. A ranking's contribution depends on the position of every option, so a second formula for "the best possible ordering" would be a second scoring model free to drift from the real one. Enumeration cannot drift: it *is* the real one. `MAX_OPTIONS` (6) bounds the cost at 720 orderings per submitted answer.
- `TraitRange.chance` is the **mean** of those outcomes, never the midpoint of `worst..best`. A question offering +3/+2/0/−3 has a midpoint of 0 and a chance value of +0.5, and only the mean is what a random answer earns.
- An option that says nothing about a trait contributes **zero, and counts** — staying silent is one of the answers on offer. Leave it out and only the options that mention a trait ever reach its score, which is the skew again.
- **One straight line, scaled by whichever side of chance has more room.** Scaling each half to its own extreme is the obvious alternative and is wrong: it makes the mapping non-linear, and a non-linear map does not carry the mean through it — random came out at 55.7 in exactly that shape. A single slope keeps `E[random] = 50` exact whatever the bank looks like. The price is that the narrower side stops short of its extreme (85.7, not 100, on the example above), which is the honest reading: that question does not offer as far up as it does down.
- `count` and `sumSquares` deliberately **do not** move with the range — only `weights`. They measure how often the candidate expressed a trait and how steadily, which is what confidence, trait coverage in the selector, the trait module's stop condition and consistency each ask. None of those questions changed; only the score's scale did.
- A question the clock took away passes **no range**. The candidate never had the choice, and charging them the chance value for it would read as having answered it badly.
- Tallies carry `chanceSum`/`bestSum`/`worstSum` as **optional**, and a tally without them falls back to the old fixed rescaling. Stored results and in-flight Redis sessions have no values for them, and rescoring a number a recruiter has already read, on a scale its questions were never measured against, would be worse than leaving it.
- `npm run check:random-baseline` runs simulated attempts through the real services against the real fixtures and prints the before/after. Random **57.9 → 50.1**; best-possible 81.0 → 75.7; worst-possible 30.8 → 21.0, so the usable spread widened rather than compressed.

**This fixes the scale, not the detection.** 50 is the honest score for an attempt that said nothing — a random responder has not demonstrated *low* integrity, they have demonstrated nothing, and no trait scale can say otherwise. Telling a random attempt apart from a considered one is a separate, unbuilt job: the signals already exist and are already computed (a random attempt's mean trait consistency measures **0.32**, below `VARIED_AT`, and its probe pairs flip), but nothing consumes them. The objective side is also still unfixed and has its own floor — a random 12-question module scores ~36/100, because `STARTING_ABILITY` sits exactly on the reporting scale's midpoint and there is no correction for guessing anywhere.

### Repeat consistency probes (added 2026-08-12)

Questions can be twinned via `questions.probeGroup`: same underlying construct, reworded stem, reworded and **reordered** options. The engine serves one, holds the group back for `PROBE_GAP_QUESTIONS` (8), then serves the twin and compares the two answers. Objective twins compare on the outcome (right then wrong means the right answer was a guess); trait twins compare per-trait weight distance. Capped at `PROBE_MAX_PAIRS` per module, and a pair is only opened if the module has room left to close it.

The window for opening a pair is only `maxQuestions - PROBE_GAP_QUESTIONS` wide — three slots on a 12-question module — so the selector **asks** for a probe question while that window is open (`ConsistencyProbeService.wantsNewPair`) rather than waiting for one to turn up. It does so through the module's normal rules restricted to probe-carrying questions, so difficulty matching and trait targeting are unaffected, and falls through to ordinary selection when no probe question fits. Left to chance the landing rate was ~61%; asking takes it to ~90% (measured over 20 personality runs). The remaining misses are modules that legitimately stop on `confidence_reached` before the twin's turn comes round — a real interaction, since probe questions weighting four traits each accelerate trait coverage and so bring the confidence stop forward.

**Report-only, with one exception.** A probe *answer* never moves an ability estimate, a trait score or a confidence — a disagreement is surfaced with both answers side by side in the detail view and nothing else. Stored on `session_module_results.probeResults`. Reordering the options is not optional: a twin whose options sit in the same order is answered by position, and measures nothing.

The exception is `StoppingEngineService`, which defers a `confidence_reached` stop while a pair is open and its twin has not yet had its turn (`ConsistencyProbeService.awaitingTwin`) — stopping one question short of the twin spends a question and reports nothing for it. Only the *fact* that a check is outstanding is consulted, never how it was answered. It is bounded three ways: the clock and `maxQuestions` are both checked first and neither can be deferred, and the deferral lapses the moment the twin's turn passes, so a twin archived mid-run holds the module open for exactly one extra selection. This took the landing rate from ~90% to 100% (measured, 20 personality runs) at a cost of ~2 extra questions on runs that would have stopped early. Note the side effect: on a 12-question module the adaptive-length spread narrows (9-12 became 11-12), so raise `maxQuestions` if that variation matters more than the check.

Relatedly, a module whose pool runs dry *after* meeting its confidence threshold reports `confidence_reached`, not `pool_exhausted` — it ended settled, and the latter would wrongly tell a recruiter the score rests on fewer answers than intended.

