import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { Company } from './entities/company.entity';

/** Postgres' unique-violation code, for turning a duplicate name into a 409. */
const UNIQUE_VIOLATION = '23505';

/** One company as its own workspace sees it. */
export interface CompanyView {
  id: string;
  name: string;
  logoUrl: string | null;
  accentColor: string | null;
  supportEmail: string | null;
  isActive: boolean;
}

export interface CompanyChanges {
  name?: string;
  logoUrl?: string | null;
  accentColor?: string | null;
  supportEmail?: string | null;
  isActive?: boolean;
}

@Injectable()
export class CompaniesService {
  constructor(
    @InjectRepository(Company)
    private readonly companies: Repository<Company>,
  ) {}

  /**
   * Every company in one workspace, retired ones included.
   *
   * The management screen needs to see a retired company to bring it back, so
   * the filtering is the caller's job — `activeFor` is what the assessment
   * picker uses.
   */
  async listFor(organisationId: string): Promise<CompanyView[]> {
    const rows = await this.companies.find({
      where: { organisationId },
      // Active first, then alphabetical: a picker and a settings list both read
      // as a list of businesses, and neither has a meaningful creation order.
      order: { isActive: 'DESC', name: 'ASC' },
    });

    return rows.map(toView);
  }

  /** What the assessment form offers: the businesses still hiring. */
  async activeFor(organisationId: string): Promise<CompanyView[]> {
    const rows = await this.companies.find({
      where: { organisationId, isActive: true },
      order: { name: 'ASC' },
    });

    return rows.map(toView);
  }

  async create(
    organisationId: string,
    changes: CompanyChanges & { name: string },
  ): Promise<CompanyView> {
    const company = this.companies.create({
      organisationId,
      name: changes.name.trim(),
      logoUrl: changes.logoUrl ?? null,
      accentColor: changes.accentColor ?? null,
      supportEmail: changes.supportEmail ?? null,
      isActive: changes.isActive ?? true,
    });

    return toView(await this.save(company));
  }

  /**
   * Partial, with the same omitted-versus-null distinction the organisation's
   * branding uses: leaving a field out keeps it, sending `null` clears it back
   * to the organisation's own value.
   */
  async update(
    id: string,
    organisationId: string,
    changes: CompanyChanges,
  ): Promise<CompanyView> {
    const company = await this.findOneOrThrow(id, organisationId);

    if (changes.name !== undefined) company.name = changes.name.trim();
    if (changes.logoUrl !== undefined) company.logoUrl = changes.logoUrl;
    if (changes.accentColor !== undefined) {
      company.accentColor = changes.accentColor;
    }
    if (changes.supportEmail !== undefined) {
      company.supportEmail = changes.supportEmail;
    }
    if (changes.isActive !== undefined) company.isActive = changes.isActive;

    return toView(await this.save(company));
  }

  /**
   * Removes a company outright.
   *
   * The assessments that named it fall back to the organisation's own branding,
   * via `ON DELETE SET NULL` — see the migration for why that is the right
   * cascade. Retiring (`isActive: false`) is the better route for a business
   * that has simply stopped hiring, because it leaves finished attempts still
   * naming the company the candidate applied to.
   */
  async remove(id: string, organisationId: string): Promise<void> {
    const company = await this.findOneOrThrow(id, organisationId);
    await this.companies.remove(company);
  }

  /**
   * One company, and only if the asking workspace owns it.
   *
   * 404 rather than 403 for somebody else's row, as everywhere else here: a 403
   * confirms the id exists, which turns this into a way to enumerate other
   * customers' group structures.
   */
  async findOneOrThrow(id: string, organisationId: string): Promise<Company> {
    const company = await this.companies.findOne({
      where: { id, organisationId },
    });
    if (!company) throw new NotFoundException('Company not found');
    return company;
  }

  /**
   * Confirms a company id may be attached to this organisation's work.
   *
   * Called by the assessments service on every write that carries one. The id
   * arrives from the client, so without this check a recruiter could name
   * another customer's company on their own assessment and put a stranger's
   * logo and support address in front of their candidates.
   */
  async assertUsable(id: string, organisationId: string): Promise<Company> {
    const company = await this.findOneOrThrow(id, organisationId);

    // Retired companies stay on the assessments that already name them, but
    // must not be attached to new work — that is the whole meaning of retiring
    // one, and the picker does not offer them.
    if (!company.isActive) {
      throw new NotFoundException('Company not found');
    }

    return company;
  }

  /** Saves, turning the duplicate-name index into a message worth reading. */
  private async save(company: Company): Promise<Company> {
    try {
      return await this.companies.save(company);
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error.driverError as { code?: string })?.code === UNIQUE_VIOLATION
      ) {
        throw new ConflictException(
          `You already have a company called "${company.name}".`,
        );
      }
      throw error;
    }
  }
}

function toView(company: Company): CompanyView {
  return {
    id: company.id,
    name: company.name,
    logoUrl: company.logoUrl,
    accentColor: company.accentColor,
    supportEmail: company.supportEmail,
    isActive: company.isActive,
  };
}
