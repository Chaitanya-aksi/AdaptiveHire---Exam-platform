/**
 * Starter sheet handed to recruiters via
 * GET /api/invitations/template.
 *
 * Column names are matched case-insensitively with spaces normalised to
 * underscores, so "Full Name" also works. `email` is required; `name` is
 * optional and only used to personalise the invite email.
 */
export const CANDIDATE_TEMPLATE_CSV = `name,email
Ada Lovelace,ada@example.com
Alan Turing,alan@example.com
`;
