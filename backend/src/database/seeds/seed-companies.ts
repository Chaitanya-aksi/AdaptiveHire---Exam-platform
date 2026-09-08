import { Company } from '../../companies/entities/company.entity';
import { Organisation } from '../../organisations/entities/organisation.entity';
import dataSource from '../data-source';

/**
 * Loads a group's businesses into one workspace.
 *
 * Companies are per-organisation data with no platform-owned equivalent — there
 * is no such thing as a starter brand every customer can use — so this seeds one
 * named workspace rather than the platform. Point it at a different one with:
 *
 *   ORG_SLUG=acme npm run seed:companies
 *
 * Idempotent, and deliberately conservative about what it overwrites: a company
 * that already exists has its logo refreshed but keeps any accent colour or
 * support address somebody has set through the UI. Re-running should top up a
 * workspace, never quietly undo work done in it.
 */

/**
 * Which workspace to load into. Override with ORG_SLUG.
 *
 * `adaptivehire` because that is what the live workspace is actually called —
 * it was created by `seed-users.ts`, which names the first workspace after the
 * platform rather than after the customer. Guessing `aksi-aerospace` here sent
 * the first real run to a workspace that does not exist. The script lists the
 * available slugs on a miss rather than failing blank, which is how that was
 * diagnosed in one run.
 */
const DEFAULT_ORG_SLUG = 'adaptivehire';

interface CompanySeed {
  name: string;
  logoUrl: string;
}

/**
 * The AKSI Aerospace group, as supplied 2026-09-08.
 *
 * Every logo is hot-linked from the company's own site or from a directory
 * listing, which is what the `logoUrl` column is for — but two of these are
 * worth knowing about:
 *
 *  - the two LinkedIn CDN URLs carry `e=1790208000`, which is an expiry —
 *    **24 September 2026**. Verified loading on 8 September 2026 and dead
 *    after that date, at which point the portal falls back to an initial badge
 *    rather than breaking;
 *  - the Google `encrypted-tbn0.gstatic.com` URL is a search thumbnail, not a
 *    hosted asset, and is equally not a stable address.
 *
 * The durable fix is to host these on a domain the group controls and update
 * them here or in Settings. Nothing breaks until then; the logo simply
 * disappears, which is why the portal was built to degrade to the badge.
 */
const COMPANIES: CompanySeed[] = [
  {
    name: 'AKSI Aerospace',
    logoUrl:
      'https://cdn-ilellod.nitrocdn.com/WYFymOBlmtKjlneDpPycBTqltZugyzxB/assets/images/optimized/rev-f7dff4d/aksiaerospace.group/wp-content/themes/dronza/assets/images/logo.png',
  },
  {
    name: 'KhetPilot',
    logoUrl:
      'https://khetpilot.com/wp-content/uploads/2026/04/KhetPilot-Agri-AI-Drones-Logo-PNG-04-1-1.png',
  },
  {
    name: 'Roboclave',
    logoUrl:
      'https://media.licdn.com/dms/image/v2/D560BAQFkJwA33-lgBg/company-logo_400_400/B56Z2GN33rIUAY-/0/1776073277462/roboclave_composites_logo?e=1790208000&v=beta&t=BqNUZ-xmEFuKMV5C5MBoh9858dWKZEBaYhiwEBcVef4',
  },
  {
    name: 'Slatup Cargo Drones',
    logoUrl:
      'https://media.licdn.com/dms/image/v2/D560BAQH9DZncCQ5HgQ/company-logo_400_400/company-logo_400_400/0/1736512044539/slatup_cargo_drones_logo?e=1790208000&v=beta&t=bHsL7bp_xdt9TOkMGUlVLDLpfCJeSLkyqXAr0EKW5PM',
  },
  {
    name: 'Dronevation',
    logoUrl:
      'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRRZHx0quY3lHi8hjvxmcXH1L2Yj98sukWEzqahiXaEhiAE2hezyphZYP4&s=10',
  },
  {
    name: 'LiHi Smart Batteries',
    logoUrl:
      'https://lihibattery.com/wp-content/uploads/elementor/thumbs/LiHi-Smart-Batteries-Logo-JPG-01-r1fu2zq7s1eoeh3almi3jplxx4ml3ydnory7qo01eo.jpg',
  },
];

async function run(): Promise<void> {
  await dataSource.initialize();

  const slug = process.env.ORG_SLUG ?? DEFAULT_ORG_SLUG;
  const organisations = dataSource.getRepository(Organisation);
  const companies = dataSource.getRepository(Company);

  const organisation = await organisations.findOne({ where: { slug } });
  if (!organisation) {
    const all = await organisations.find({ order: { name: 'ASC' } });
    console.error(
      `No organisation with slug "${slug}".\n\n` +
        'Workspaces on this database:\n' +
        (all.length
          ? all.map((o) => `  ${o.slug.padEnd(28)} ${o.name}`).join('\n')
          : '  (none — register a recruiter first)') +
        '\n\nRe-run with ORG_SLUG=<slug>.',
    );
    await dataSource.destroy();
    process.exit(1);
  }

  console.log(`Loading ${COMPANIES.length} companies into ${organisation.name}\n`);

  for (const seed of COMPANIES) {
    // Matched case-insensitively, like the unique index, so a re-run cannot
    // create "KhetPilot" beside an existing "Khetpilot".
    const existing = await companies
      .createQueryBuilder('c')
      .where('c."organisationId" = :organisationId', {
        organisationId: organisation.id,
      })
      .andWhere('lower(c.name) = lower(:name)', { name: seed.name })
      .getOne();

    if (existing) {
      if (existing.logoUrl === seed.logoUrl) {
        console.log(`· ${seed.name} — already loaded`);
        continue;
      }
      existing.logoUrl = seed.logoUrl;
      await companies.save(existing);
      console.log(`↺ ${seed.name} — logo updated`);
      continue;
    }

    await companies.save(
      companies.create({
        organisationId: organisation.id,
        name: seed.name,
        logoUrl: seed.logoUrl,
        // Left unset deliberately. Null means "inherit the group's", and
        // inventing an accent per brand here would put six colours a nobody
        // chose in front of candidates. Set them in Settings → Companies.
        accentColor: null,
        supportEmail: null,
      }),
    );
    console.log(`✓ ${seed.name}`);
  }

  console.log(
    '\nPick one of these on an assessment: Assessments → New assessment → Details.',
  );
  await dataSource.destroy();
}

run().catch((error) => {
  console.error('Seeding companies failed:', error);
  process.exit(1);
});
