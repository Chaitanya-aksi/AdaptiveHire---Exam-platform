/**
 * Who appears in one organisation's People directory.
 *
 * Two different rules, because "belongs to this company" means two different
 * things:
 *
 *   - A **recruiter** is a member of the organisation, so `organisationId`
 *     answers it directly.
 *   - A **candidate** belongs to no organisation at all — the same person sits
 *     assessments for whoever invites them. So they appear here only if this
 *     organisation has actually invited them to one of its assessments.
 *
 * The candidate match allows either `candidateId` or the email, because
 * invitations are keyed on email and `candidateId` is only backfilled once the
 * person registers — matching on one alone would drop real invitees.
 *
 * This lives in one file, and every query that reaches into the directory uses
 * it, for the same reason `question-visibility.ts` does: the listing and the
 * remove endpoint have to agree on exactly who is in scope. If removal used a
 * looser rule than the listing, an id that this organisation can never see would
 * still be removable by guessing it.
 *
 * Expects the `users` table aliased as `u` and a bound `:organisationId`.
 */
export const PERSON_VISIBLE_TO_ORG = `(
  (u.role = 'recruiter_admin' AND u."organisationId" = :organisationId)
  OR (u.role = 'candidate' AND EXISTS (
        SELECT 1
          FROM invitations i
          JOIN assessments a ON a.id = i."assessmentId"
         WHERE a."organisationId" = :organisationId
           AND (i."candidateId" = u.id OR lower(i.email) = lower(u.email))
      ))
)`;
