import type { Company } from '../companies/entities/company.entity';
import type { Organisation } from '../organisations/entities/organisation.entity';
import type { Branding } from '../organisations/organisations.service';

/** The fields of an organisation this rule reads. */
type BrandingSource = Pick<
  Organisation,
  'name' | 'logoUrl' | 'accentColor' | 'supportEmail'
>;

/** The same fields on a company. Structurally identical, by design. */
type CompanySource = Pick<
  Company,
  'name' | 'logoUrl' | 'accentColor' | 'supportEmail'
>;

/**
 * Who a candidate thinks is assessing them, resolved once.
 *
 * This is the whole rule, in one file, for the same reason
 * `question-visibility.ts` and `assessment-window.ts` are: it is consulted from
 * three places that must never disagree — the candidate's invitation list, the
 * record of one attempt, and the emails sent about it. A candidate told they
 * are testing for KhetPilot on screen and then rejected by "AKSI Aerospace
 * Group" has been handed two different answers to the same question.
 *
 * **The assessment's company wins over the workspace that owns it.** A group
 * hires under several businesses from one account, and the candidate applied to
 * one of them, not to the holding company. Null `company` is the ordinary case
 * and means the round belongs to the workspace itself, which is what every
 * assessment created before group companies existed has.
 *
 * Resolved field by field rather than by picking one row wholesale. A company
 * that sets only a name and a logo inherits the group's accent and its shared
 * recruiting inbox, instead of losing both — which matches how these are
 * actually filled in, since a group of six brands commonly runs one address.
 *
 * Null on both is normal rather than exceptional: the relations are only loaded
 * on candidate-facing queries, so this degrades to AdaptiveHire's own
 * presentation rather than throwing.
 */
export function resolveBranding(
  organisation: BrandingSource | null | undefined,
  company: CompanySource | null | undefined,
  platformSupportEmail: string | null,
): Branding {
  return {
    name: company?.name ?? organisation?.name ?? 'AdaptiveHire',
    logoUrl: company?.logoUrl ?? organisation?.logoUrl ?? null,
    accentColor: company?.accentColor ?? organisation?.accentColor ?? null,
    /*
     * Resolved here rather than in the UI: the client should be handed an
     * address or nothing, never the job of choosing between three.
     *
     * The business that invited them comes first, then the group, then the
     * platform. Null at the end is a real answer — the portal shows no contact
     * route at all rather than a dead link, because somebody who has just lost
     * an attempt is worse served by an address nobody reads.
     */
    supportEmail:
      company?.supportEmail ??
      organisation?.supportEmail ??
      platformSupportEmail ??
      null,
  };
}
