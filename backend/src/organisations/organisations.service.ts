import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { EntityManager, Repository } from 'typeorm';
import { Organisation } from './entities/organisation.entity';

/** Longest slug we will build, matching the column width. */
const MAX_SLUG_LENGTH = 220;

/** Where the counter starts when a slug is already taken: "acme-2". */
const FIRST_SUFFIX = 2;

/**
 * How many times to try appending a counter before giving up and falling back to
 * a random suffix. Reaching this means hundreds of companies share a name, which
 * is possible but not worth an unbounded loop.
 */
const MAX_SLUG_ATTEMPTS = 50;

/**
 * A workspace as its own members see it.
 *
 * `Branding` below is the subset candidates are shown, and is deliberately
 * narrower — a candidate has no business knowing an organisation's id or slug.
 */
export interface OrganisationProfile extends Branding {
  id: string;
  slug: string;
}

/**
 * What a candidate is shown about the company assessing them: who they are,
 * and how to reach them when something goes wrong.
 */
export interface Branding {
  name: string;
  logoUrl: string | null;
  accentColor: string | null;
  /**
   * Already resolved — the organisation's own address, or the platform's
   * fallback, or null when neither is configured. The UI shows a contact route
   * only when this is non-null, so it can never render a dead link.
   */
  supportEmail: string | null;
}

@Injectable()
export class OrganisationsService {
  constructor(
    @InjectRepository(Organisation)
    private readonly organisations: Repository<Organisation>,
  ) {}

  /**
   * Creates a company workspace for a self-registering recruiter.
   *
   * Takes an `EntityManager` because registration must create the organisation
   * and its first recruiter together or not at all. A recruiter with no
   * organisation cannot use the platform (`@CurrentOrg()` refuses them), and an
   * organisation with no members is an orphan row nobody can reach — so a
   * half-finished signup has to roll back rather than leave either behind.
   */
  async createForSignup(
    name: string,
    manager: EntityManager,
  ): Promise<Organisation> {
    const trimmed = name.trim();
    const slug = await this.availableSlug(trimmed, manager);

    return manager.save(manager.create(Organisation, { name: trimmed, slug }));
  }

  /** The caller's own workspace, including how it presents to candidates. */
  async profile(organisationId: string): Promise<OrganisationProfile> {
    const organisation = await this.organisations.findOneOrFail({
      where: { id: organisationId },
    });

    return {
      id: organisation.id,
      name: organisation.name,
      slug: organisation.slug,
      logoUrl: organisation.logoUrl,
      accentColor: organisation.accentColor,
      // Unresolved here: a recruiter editing this needs to see their own value
      // and whether it is set, not the platform fallback standing in for it.
      supportEmail: organisation.supportEmail,
    };
  }

  /**
   * Sets the logo and accent candidates see.
   *
   * Partial: an omitted field is left alone and an explicit `null` clears it
   * back to AdaptiveHire's own. Without the distinction there would be no way
   * to remove a logo without also resetting the colour.
   */
  async updateBranding(
    organisationId: string,
    changes: {
      logoUrl?: string | null;
      accentColor?: string | null;
      supportEmail?: string | null;
    },
  ): Promise<OrganisationProfile> {
    const organisation = await this.organisations.findOneOrFail({
      where: { id: organisationId },
    });

    if (changes.logoUrl !== undefined) organisation.logoUrl = changes.logoUrl;
    if (changes.accentColor !== undefined) {
      organisation.accentColor = changes.accentColor;
    }
    if (changes.supportEmail !== undefined) {
      organisation.supportEmail = changes.supportEmail;
    }

    await this.organisations.save(organisation);
    return this.profile(organisationId);
  }

  /**
   * A free slug derived from the company name.
   *
   * Two real companies can share a name, so a collision appends a counter rather
   * than rejecting the signup — "Acme" and "Acme" become `acme` and `acme-2`.
   * Turning away a legitimate customer because someone else registered the same
   * word first would be the wrong trade.
   */
  private async availableSlug(
    name: string,
    manager: EntityManager,
  ): Promise<string> {
    const base = slugify(name);

    for (let attempt = 0; attempt <= MAX_SLUG_ATTEMPTS; attempt += 1) {
      const candidate =
        attempt === 0 ? base : truncate(base, `-${attempt + FIRST_SUFFIX - 1}`);

      const taken = await manager.exists(Organisation, {
        where: { slug: candidate },
      });
      if (!taken) return candidate;
    }

    // Astronomically unlikely. A random tail is still a usable slug, and beats
    // either looping forever or failing a signup.
    return truncate(base, `-${Date.now().toString(36)}`);
  }
}

/**
 * "Acme Corp. (UK)" -> "acme-corp-uk".
 *
 * Falls back to "org" for a name with nothing slug-able in it at all — a name
 * written entirely in a script this naive transliteration drops would otherwise
 * produce an empty slug, and an empty slug collides with every other one.
 */
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    // Strip combining accents so "Café" becomes "cafe" rather than "caf".
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH);

  return slug || 'org';
}

/** Appends a suffix, trimming the base so the result still fits the column. */
function truncate(base: string, suffix: string): string {
  return (
    base.slice(0, MAX_SLUG_LENGTH - suffix.length).replace(/-+$/, '') + suffix
  );
}
