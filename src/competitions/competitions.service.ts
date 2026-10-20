import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import { OrganizationsService } from 'src/organizations/organizations.service';
import { ResponseUtil } from 'src/utils/api-response';
import { CreateCompetitionDto } from './dto/create-competition.dto';
import { UpdateCompetitionDto } from './dto/update-competition.dto';

@Injectable()
export class CompetitionsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly organizationsService: OrganizationsService,
  ) {}

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  private async generateUniqueSlug(baseText: string): Promise<string> {
    const baseSlug = this.slugify(baseText);
    let slug = baseSlug;
    let count = 1;

    while (true) {
      const existing = await this.db.competition.findUnique({
        where: { slug },
      });
      if (!existing) {
        return slug;
      }
      slug = `${baseSlug}-${count++}`;
    }
  }

  async create(userId: string, dto: CreateCompetitionDto) {
    // Validate that the user is OWNER or ADMIN of the organization
    await this.organizationsService.validateMemberRole(
      dto.organization_id,
      userId,
      ['OWNER', 'ADMIN'],
    );

    let slug = dto.slug ? this.slugify(dto.slug) : await this.generateUniqueSlug(dto.name);

    if (dto.slug) {
      const existing = await this.db.competition.findUnique({
        where: { slug },
      });
      if (existing) {
        throw new BadRequestException(`Slug '${slug}' is already taken.`);
      }
    }

    const competition = await this.db.competition.create({
      data: {
        name: dto.name,
        slug,
        description: dto.description,
        sport: dto.sport,
        organization_id: dto.organization_id,
        logoUrl: dto.logoUrl,
        bannerUrl: dto.bannerUrl,
      },
      include: {
        organization: {
          select: {
            id: true,
            name: true,
            slug: true,
            logoUrl: true,
            isVerified: true,
          },
        },
      },
    });

    return ResponseUtil.success(competition, 'Competition created successfully');
  }

  async update(id: string, userId: string, dto: UpdateCompetitionDto) {
    const competition = await this.db.competition.findUnique({
      where: { id },
    });
    if (!competition) {
      throw new NotFoundException('Competition not found');
    }

    await this.organizationsService.validateMemberRole(
      competition.organization_id,
      userId,
      ['OWNER', 'ADMIN'],
    );

    if (dto.slug && dto.slug !== competition.slug) {
      const slug = this.slugify(dto.slug);
      const existing = await this.db.competition.findUnique({
        where: { slug },
      });
      if (existing && existing.id !== id) {
        throw new BadRequestException(`Slug '${slug}' is already taken.`);
      }
      dto.slug = slug;
    }

    const updated = await this.db.competition.update({
      where: { id },
      data: {
        ...dto,
      },
      include: {
        organization: {
          select: {
            id: true,
            name: true,
            slug: true,
            logoUrl: true,
            isVerified: true,
          },
        },
      },
    });

    return ResponseUtil.success(updated, 'Competition updated successfully');
  }

  async findBySlug(slug: string) {
    const competition = await this.db.competition.findFirst({
      where: {
        OR: [{ slug }, { id: slug }],
      },
      include: {
        organization: {
          select: {
            id: true,
            name: true,
            slug: true,
            logoUrl: true,
            isVerified: true,
          },
        },
        _count: {
          select: {
            followers: true,
            seasons: true,
          },
        },
        seasons: {
          select: {
            id: true,
            name: true,
            customName: true,
            seasonName: true,
            isCurrentSeason: true,
            start_date: true,
            end_date: true,
            visibility: true,
            sport: true,
            type: true,
            logoUrl: true,
          },
          orderBy: {
            start_date: 'desc',
          },
        },
      },
    });

    if (!competition) {
      throw new NotFoundException('Competition not found');
    }

    const activeSeason =
      competition.seasons.find((s) => s.isCurrentSeason) ||
      competition.seasons[0] ||
      null;

    return ResponseUtil.success({
      ...competition,
      activeSeasonId: activeSeason?.id || null,
      activeSeasonSlug: activeSeason?.customName || activeSeason?.id || null,
    });
  }

  async findAllByOrg(organizationId: string) {
    const competitions = await this.db.competition.findMany({
      where: { organization_id: organizationId },
      include: {
        _count: {
          select: {
            followers: true,
            seasons: true,
          },
        },
        seasons: {
          select: {
            id: true,
            name: true,
            customName: true,
            seasonName: true,
            isCurrentSeason: true,
            start_date: true,
            end_date: true,
          },
          orderBy: {
            start_date: 'desc',
          },
        },
      },
      orderBy: {
        created_at: 'desc',
      },
    });

    return ResponseUtil.success(competitions);
  }

  async follow(competitionId: string, userId: string) {
    const comp = await this.db.competition.findFirst({
      where: { OR: [{ id: competitionId }, { slug: competitionId }] },
    });
    if (!comp) {
      throw new NotFoundException('Competition not found');
    }

    await this.db.competitionFollower.upsert({
      where: {
        userId_competitionId: {
          userId,
          competitionId: comp.id,
        },
      },
      create: {
        userId,
        competitionId: comp.id,
      },
      update: {},
    });

    return ResponseUtil.success({ followed: true }, 'Followed competition');
  }

  async unfollow(competitionId: string, userId: string) {
    const comp = await this.db.competition.findFirst({
      where: { OR: [{ id: competitionId }, { slug: competitionId }] },
    });
    if (!comp) {
      throw new NotFoundException('Competition not found');
    }

    try {
      await this.db.competitionFollower.delete({
        where: {
          userId_competitionId: {
            userId,
            competitionId: comp.id,
          },
        },
      });
    } catch {
      // Record already absent
    }

    return ResponseUtil.success({ followed: false }, 'Unfollowed competition');
  }

  async isFollowing(competitionId: string, userId: string) {
    const comp = await this.db.competition.findFirst({
      where: { OR: [{ id: competitionId }, { slug: competitionId }] },
    });
    if (!comp) {
      return ResponseUtil.success({ isFollowing: false });
    }

    const follower = await this.db.competitionFollower.findUnique({
      where: {
        userId_competitionId: {
          userId,
          competitionId: comp.id,
        },
      },
    });

    return ResponseUtil.success({ isFollowing: !!follower });
  }
}