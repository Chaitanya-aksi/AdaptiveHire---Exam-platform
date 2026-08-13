/**
 * Which questions an organisation may see — written once, used by the question
 * bank and by the adaptive engine's selector.
 *
 * Three kinds of row exist:
 *
 *   - **Platform questions** (`organisationId IS NULL`) — the starter bank that
 *     ships with AdaptiveHire. Every organisation may use them in an assessment.
 *   - **An organisation's own questions** — private to it, editable by it.
 *   - **Forks** — an organisation's private copy of a platform question, made the
 *     moment it edits or hides one. A fork carries `forkedFromId`, and it
 *     *replaces* the original in that organisation's view: it must see its own
 *     wording rather than both versions, while every other organisation keeps the
 *     pristine platform question.
 *
 * This lives in one file because a tenant filter present in three query paths
 * out of four is the same as no tenant filter. The selector in particular had no
 * organisation clause at all for a while, which meant one customer's private
 * questions could be served to another customer's candidates.
 *
 * The alias must be `q`, matching every query that uses it.
 */
export const QUESTION_VISIBLE_TO_ORG = `(
  q."organisationId" = :organisationId
  OR (
    q."organisationId" IS NULL
    AND NOT EXISTS (
      SELECT 1
        FROM questions fork
       WHERE fork."forkedFromId" = q.id
         AND fork."organisationId" = :organisationId
    )
  )
)`;

/**
 * The same rule for a raw query, where named parameters are not available.
 * `$1` is the organisation id.
 */
export const QUESTION_VISIBLE_TO_ORG_POSITIONAL = `(
  q."organisationId" = $1
  OR (
    q."organisationId" IS NULL
    AND NOT EXISTS (
      SELECT 1
        FROM questions fork
       WHERE fork."forkedFromId" = q.id
         AND fork."organisationId" = $1
    )
  )
)`;
