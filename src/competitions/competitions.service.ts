import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import {
  FixtureStage,
  FixtureStatus,
  TournamentType,
  Visibility,
} from 'prisma/generated/client';
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

  private deriveSeasonStatus(
    startDate: Date,
    endDate: Date,
  ): 'upcoming' | 'live' | 'completed' {
    const now = new Date();
    if (now < startDate) return 'upcoming';
    if (now > endDate) return 'completed';
    return 'live';
  }

  private pickActiveSeason<
    T extends {
      id: string;
      customName?: string | null;
      isCurrentSeason?: boolean;
      status?: 'upcoming' | 'live' | 'completed';
    },
  >(seasons: T[]): T | null {
    if (!seasons.length) return null;
    return (
      seasons.find((s) => s.isCurrentSeason) ||
      seasons.find((s) => s.status === 'live') ||
      seasons.find((s) => s.status === 'upcoming') ||
      seasons[0]
    );
  }

  private async resolveChampionsByTournament(
    seasons: Array<{
      id: string;
      type: TournamentType;
      status: 'upcoming' | 'live' | 'completed';
    }>,
  ): Promise<
    Map<string, { id: string; name: string; logoUrl: string | null }>
  > {
    const result = new Map<
      string,
      { id: string; name: string; logoUrl: string | null }
    >();
    const candidateIds = seasons
      .filter((s) => s.status !== 'upcoming')
      .map((s) => s.id);
    if (!candidateIds.length) return result;

    const [fixtures, standings] = await Promise.all([
      this.db.fixture.findMany({
        where: { tournament_id: { in: candidateIds } },
        select: {
          tournament_id: true,
          stage: true,
          round: true,
          roundName: true,
          matchNumber: true,
          status: true,
          homeTeamId: true,
          awayTeamId: true,
          homeScore: true,
          awayScore: true,
          homePenaltyScore: true,
          awayPenaltyScore: true,
          config: true,
        },
      }),
      this.db.standing.findMany({
        where: { tournament_id: { in: candidateIds } },
        select: {
          tournament_id: true,
          participant_id: true,
          position: true,
          points: true,
          goalDiff: true,
          goalsFor: true,
          wins: true,
        },
        orderBy: [
          { points: 'desc' },
          { goalDiff: 'desc' },
          { goalsFor: 'desc' },
          { wins: 'desc' },
        ],
      }),
    ]);

    const fixturesByTourney = new Map<string, typeof fixtures>();
    for (const f of fixtures) {
      const list = fixturesByTourney.get(f.tournament_id) || [];
      list.push(f);
      fixturesByTourney.set(f.tournament_id, list);
    }

    const standingsByTourney = new Map<string, typeof standings>();
    for (const s of standings) {
      const list = standingsByTourney.get(s.tournament_id) || [];
      list.push(s);
      standingsByTourney.set(s.tournament_id, list);
    }

    const winnerParticipantIds = new Map<string, string>();
    const activeStatuses = new Set<FixtureStatus>([
      FixtureStatus.LIVE,
      FixtureStatus.NORMAL_TIME_ENDED,
      FixtureStatus.EXTRATIME,
    ]);

    for (const season of seasons) {
      if (season.status === 'upcoming') continue;
      const seasonFixtures = fixturesByTourney.get(season.id) || [];
      if (seasonFixtures.some((f) => activeStatuses.has(f.status))) continue;

      if (
        season.type === TournamentType.KNOCKOUT ||
        season.type === TournamentType.HYBRID
      ) {
        const koFixtures = seasonFixtures.filter(
          (f) =>
            f.stage === FixtureStage.KNOCKOUT ||
            season.type === TournamentType.KNOCKOUT,
        );
        if (!koFixtures.length) continue;

        const maxRound = Math.max(...koFixtures.map((f) => f.round));
        const finalRoundFixtures = koFixtures
          .filter((f) => f.round === maxRound)
          .sort((a, b) => a.matchNumber - b.matchNumber);

        const finalMatch =
          finalRoundFixtures.find((f) => {
            const name = (f.roundName || '').toLowerCase();
            return (
              name.includes('final') &&
              !name.includes('third') &&
              !name.includes('3rd')
            );
          }) || finalRoundFixtures[0];

        if (finalMatch?.status === FixtureStatus.COMPLETED) {
          const overrideWinnerId = (finalMatch.config as any)?.winnerId;
          if (overrideWinnerId) {
            winnerParticipantIds.set(season.id, overrideWinnerId);
            continue;
          }
          const hs = finalMatch.homeScore ?? 0;
          const as = finalMatch.awayScore ?? 0;
          if (hs > as && finalMatch.homeTeamId) {
            winnerParticipantIds.set(season.id, finalMatch.homeTeamId);
          } else if (as > hs && finalMatch.awayTeamId) {
            winnerParticipantIds.set(season.id, finalMatch.awayTeamId);
          } else {
            const hp = finalMatch.homePenaltyScore ?? 0;
            const ap = finalMatch.awayPenaltyScore ?? 0;
            if (hp > ap && finalMatch.homeTeamId) {
              winnerParticipantIds.set(season.id, finalMatch.homeTeamId);
            } else if (ap > hp && finalMatch.awayTeamId) {
              winnerParticipantIds.set(season.id, finalMatch.awayTeamId);
            }
          }
        }
      } else if (season.type !== TournamentType.FRIENDLY) {
        const seasonStandings = standingsByTourney.get(season.id) || [];
        const allFinished =
          seasonFixtures.length > 0
            ? seasonFixtures.every((f) => f.status === FixtureStatus.COMPLETED)
            : season.status === 'completed';

        if (seasonStandings.length > 0 && allFinished) {
          const sorted = [...seasonStandings].sort((a, b) => {
            if (a.position != null && b.position != null) {
              return a.position - b.position;
            }
            return (
              b.points - a.points ||
              b.goalDiff - a.goalDiff ||
              b.goalsFor - a.goalsFor ||
              b.wins - a.wins
            );
          });
          if (sorted[0]?.participant_id) {
            winnerParticipantIds.set(season.id, sorted[0].participant_id);
          }
        }
      }
    }

    const uniqueParticipantIds = Array.from(
      new Set(winnerParticipantIds.values()),
    );
    if (!uniqueParticipantIds.length) return result;

    const participants = await this.db.participant.findMany({
      where: { id: { in: uniqueParticipantIds } },
      select: {
        id: true,
        customName: true,
        logoUrl: true,
        team: { select: { name: true, logoUrl: true } },
        user: { select: { name: true, picture: true } },
      },
    });
    const participantMap = new Map(participants.map((p) => [p.id, p]));

    for (const [tourneyId, participantId] of winnerParticipantIds.entries()) {
      const p = participantMap.get(participantId);
      if (!p) continue;
      result.set(tourneyId, {
        id: p.id,
        name: p.customName || p.team?.name || p.user?.name || 'Champion',
        logoUrl: p.logoUrl || p.team?.logoUrl || p.user?.picture || null,
      });
    }

    return result;
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
            description: true,
            isVerified: true,
            socials: true,
          },
        },
        _count: {
          select: {
            followers: true,
          },
        },
        seasons: {
          where: {
            visibility: Visibility.PUBLIC,
          },
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
            bannerUrl: true,
            location: true,
            _count: {
              select: {
                participants: true,
                followers: true,
              },
            },
          },
          orderBy: {
            start_date: 'desc',
          },
        },
      },
    });

    if (!competition || competition.seasons.length === 0) {
      throw new NotFoundException('Competition not found');
    }

    const seasonsWithStatus = competition.seasons.map((s) => ({
      ...s,
      status: this.deriveSeasonStatus(s.start_date, s.end_date),
    }));

    const champions = await this.resolveChampionsByTournament(seasonsWithStatus);

    const enrichedSeasons = seasonsWithStatus.map((s) => ({
      ...s,
      champion: champions.get(s.id) || null,
    }));

    const activeSeason = this.pickActiveSeason(enrichedSeasons);

    return ResponseUtil.success({
      ...competition,
      _count: {
        ...competition._count,
        seasons: enrichedSeasons.length,
      },
      seasons: enrichedSeasons,
      activeSeasonId: activeSeason?.id || null,
      activeSeasonSlug: activeSeason?.customName || activeSeason?.id || null,
    });
  }

  async findAllPublic(page: number = 1, limit: number = 12, search?: string) {
    const skip = (page - 1) * limit;
    const where: any = {
      seasons: {
        some: { visibility: Visibility.PUBLIC },
      },
    };

    if (search?.trim()) {
      const q = search.trim();
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        { sport: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [competitions, total] = await Promise.all([
      this.db.competition.findMany({
        where,
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
              seasons: { where: { visibility: Visibility.PUBLIC } },
            },
          },
          seasons: {
            where: { visibility: Visibility.PUBLIC },
            select: {
              id: true,
              name: true,
              customName: true,
              seasonName: true,
              isCurrentSeason: true,
              start_date: true,
              end_date: true,
            },
            orderBy: [{ isCurrentSeason: 'desc' }, { start_date: 'desc' }],
          },
        },
        skip,
        take: limit,
        orderBy: [{ followers: { _count: 'desc' } }, { created_at: 'desc' }],
      }),
      this.db.competition.count({ where }),
    ]);

    const mapped = competitions.map((comp) => {
      const active =
        comp.seasons.find((s) => s.isCurrentSeason) || comp.seasons[0] || null;
      return {
        ...comp,
        activeSeasonId: active?.id || null,
        activeSeasonSlug: active?.customName || active?.id || null,
      };
    });

    return ResponseUtil.paginated(mapped, page, limit, total);
  }

  async findFollowedByUser(userId: string) {
    const follows = await this.db.competitionFollower.findMany({
      where: { userId },
      include: {
        competition: {
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
                seasons: { where: { visibility: Visibility.PUBLIC } },
              },
            },
            seasons: {
              where: { visibility: Visibility.PUBLIC },
              select: {
                id: true,
                name: true,
                customName: true,
                seasonName: true,
                isCurrentSeason: true,
                start_date: true,
                end_date: true,
              },
              orderBy: [{ isCurrentSeason: 'desc' }, { start_date: 'desc' }],
              take: 1,
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const mapped = follows.map(({ competition }) => {
      const active = competition.seasons[0] || null;
      return {
        ...competition,
        activeSeasonId: active?.id || null,
        activeSeasonSlug: active?.customName || active?.id || null,
      };
    });

    return ResponseUtil.success(mapped);
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