# Proposal: public assessment links

**Status:** approved and built, 2026-09-10. Migration
`1786740000000-PublicAssessmentLinks` is applied.
**Date:** 2026-09-10
**Decides:** whether candidates can reach an assessment without an emailed invitation.

All four decisions at the bottom were answered **yes**, including the fourth —
this is an agreed amendment to the rule in `CLAUDE.md` that candidate access is
"via login + assessment list, NOT a token-based email link", not a quiet
departure from it. Login and the assessment list both survive; what the token
reaches is the sign-up step.

---

## Why this is on the table

Invitation email has not been delivered from production since the platform was
deployed. The cause is settled and is not in our code: Render blocks outbound
SMTP on ports 25, 465 and 587 for free web services, and Zoho refuses Render's
shared outbound ranges for OAuth token requests.

Both were proved rather than guessed, by two credential-free probes run from a
neutral cloud IP: SMTP answered `535 Authentication Failed` (the connection was
accepted, so Zoho does not IP-block SMTP) and OAuth answered `invalid_client`
(likewise accepted, so there is **no organisation allowlist** — Render's ranges
are refused specifically, most likely on reputation). The probe workflows have
been deleted now that the question is settled; they are in the history at
`5f66500` if the reasoning ever needs re-reading.

Every route around it needs something we do not control: DNS records in a
Hostinger account nobody can reach, a phone number, a card, or an admin console
we are not authorised for. Meanwhile candidates hold accounts they were never
told about.

So the question this answers is not "how do we fix email". It is **"why is
email on the critical path to sitting an assessment at all?"**

## What this proposes

A recruiter enables a **link on an assessment**. They share it however they
like — WhatsApp, a job post, a careers page. A candidate opens it, enters their
name and email, and goes straight into the assessment.

One link serves a whole cohort. There is no per-candidate URL, which is the
reason the alternative — a link per invitation — was rejected: it does not
scale to a campus drive where a hundred people are pointed at the same thing.

Email becomes a convenience for delivery, not a dependency for access.

---

## What we give up, stated plainly

This is the section to disagree with, if anyone is going to.

**We stop knowing who took the test.** Today a report is evidence about a named
person, because a recruiter invited that address. With an open link the email is
self-asserted. Somebody can type a colleague's address, or a plausible stranger's.

**We cannot stop a determined re-attempt.** One attempt per email still holds,
but a second email is free. This was investigated properly:

| Mechanism | Why it does not work |
|---|---|
| Block repeat IP addresses | A college, an office or a household shares one address, and Indian mobile carriers put thousands of users behind carrier-grade NAT. It would reject legitimate candidates in bulk while a VPN or mobile data defeats it in seconds. |
| Device fingerprinting | A lab of identically-built machines fingerprints identically, so the second genuine candidate at that bench is refused. |
| Face matching | The only signal that identifies a *person*. It is also biometric data, which our proctoring scope was deliberately drawn to exclude ("client-side only, NO video recording or storage"), and which carries consent obligations under the DPDP Act. Out of scope unless we decide, deliberately, that this is a biometric product. |

**We cannot stop the link spreading.** Whoever holds it can start an attempt,
which exposes questions from a bank we curate.

These are accepted costs, not problems to be solved later. If any of them is
unacceptable for a given round, that round should use invitations, which still
work exactly as they do today.

## What we keep

Everything in the runtime is untouched: the readiness check, the camera gate at
the top of each module, practice questions, tab-switch and face detection, the
adaptive engine, auto-submit, reports. This changes how a candidate arrives at
the front door and nothing after it.

One attempt per invitation still holds, enforced by the existing unique
constraint. Recruiter-created invitations are unaffected.

---

## The flow

A candidate opens `/a/<token>` and sees the assessment intro. **The email is
asked for first, on its own**, and only then a password — because three things
can only be said once the address is known, and every one of them is better said
before somebody has chosen a password: that this link accepts one email domain
only, that the round has closed, and whether this person already has an account
and should be entering a password rather than inventing one.

The cost, stated because it is real: step one tells anyone who asks whether an
address has an account here. A single combined form leaks the same fact anyway —
a new address succeeds where an existing one with a wrong password fails — while
being unable to say any of the three things above until afterwards. The rate
limit on the endpoint is what bounds it; the shape of the form never could.

What happens after the address is known depends on it:

**No account exists.** Provision one, sign them in, create an invitation marked
self-registered, continue into the normal flow. Nothing is at risk — the account
is being claimed for the first time.

**An account exists.** Require the password. This is not negotiable: without it,
typing a colleague's address is account takeover, and candidate accounts are
shared across organisations, so it would also expose that person's assessments
for other companies. Someone who has an account but has lost the password cannot
proceed through the link, which is correct — that is what password reset is for.

**The address has already completed this assessment.** Show a plain page saying
so, with the organisation's support address. No error, no retry loop.

## Schema

On `assessments`, all nullable, all inert when unset:

| Column | Purpose |
|---|---|
| `publicLinkToken` | unique, ≥128 bits of randomness, stored hashed |
| `publicLinkEnabled` | an off switch that does not destroy the token |
| `publicLinkExpiresAt` | defaults to the assessment's own `closesAt` |
| `publicLinkMaxAttempts` | caps what a leaked link can harvest |
| `publicLinkEmailDomain` | optional restriction, e.g. one college's domain |

On `invitations`:

| Column | Purpose |
|---|---|
| `source` | `recruiter` or `self` |
| `registeredIp`, `registeredUserAgent` | recorded at entry |

The two signal columns are **recorded and shown, never enforced**. That is the
same rule the whole proctoring stack runs on: detect and log for recruiter
judgment, never auto-disqualify. A recruiter seeing "three attempts from
49.37.x.x" can investigate; the system refusing the third would be wrong for all
the reasons in the table above.

## Reports must carry provenance

An invited attempt and a self-registered attempt are not equally strong evidence,
and the report is where that has to be visible. A self-registered attempt should
be marked as such wherever a result appears — the results list, the report page
and the PDF.

This is the same principle as `expectedByChance` and the proctoring signals:
state what is behind a number rather than letting it be read as more than it is.
A recruiter comparing two candidates deserves to know that one was invited by
name and the other typed their own address.

## Controls worth shipping in v1

Rate limiting per IP on the entry form, since an open form invites junk. The
attempt cap and expiry above. The domain restriction where a round has one. And
if bot signups become real, Cloudflare Turnstile — not reCAPTCHA, which is
Google and blocked on this network.

## Rollout

Additive throughout. Nothing changes for an assessment that never enables a
link, so existing rounds and existing invitations behave exactly as today. The
feature can ship dark and be switched on per assessment.

---

## Decisions needed before implementation

1. **Password required for an existing account?** Recommended: yes, and I would
   not build it otherwise.
2. **Mark self-registered attempts in reports?** Recommended: yes, everywhere a
   result is shown.
3. **Domain restriction in v1?** Recommended: yes; it is small and it is the
   single most effective narrowing available without a list.
4. **Does this reverse a locked decision?** `CLAUDE.md` records that candidate
   access is "via login + assessment list, NOT a token-based email link". This
   proposal keeps login and the assessment list, and adds a token that reaches
   the sign-up step rather than replacing authentication. It is close enough to
   that line to deserve an explicit yes rather than being absorbed quietly.

## Explicitly out of scope

Face matching or any biometric identity. Device fingerprinting. IP-based
rejection. Verifying an email address by sending mail to it, which is circular
given the problem this exists to solve.
