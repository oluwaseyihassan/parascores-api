import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import { CreateTournamentDto } from './dto/create-tournament.dto';
import { UpdateTournamentDto } from './dto/update-tournament.dto';
import { StartSeasonDto } from './dto/start-season.dto';
import { OrganizationsService } from 'src/organizations/organizations.service';

import {
  Visibility,
  MatchEventType,
  MatchHalf,
  SubscriptionPlan,
  SubscriptionStatus,
} from 'prisma/generated/client';
import { ResponseUtil } from 'src/utils/api-response';

@Injectable()
export class TournamentsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly organizationsService: OrganizationsService,
  ) {}

  async create(userId: string, dto: CreateTournamentDto) {
    const { start_date, end_date, ...rest } = dto;

    // 1. Check if user has OWNER or ADMIN role in the target organization
    await this.organizationsService.validateMemberRole(
      dto.organization_id,
      userId,
      ['OWNER', 'ADMIN'],
    );

    // 2. Enforce Free plan tournament count limit (max 3)
    const subscription = await this.db.subscription.findUnique({
      where: { organizationId: dto.organization_id },
    });

    const isPremiumOrg =
      subscription &&
      (subscription.status === SubscriptionStatus.ACTIVE ||
        subscription.status === SubscriptionStatus.TRIALING) &&
      (subscription.plan === SubscriptionPlan.PRO ||
        subscription.plan === SubscriptionPlan.ENTERPRISE);

    if (!isPremiumOrg && dto.type !== 'FRIENDLY') {
      const count = await this.db.tournament.count({
        where: {
          organization_id: dto.organization_id,
          type: { not: 'FRIENDLY' },
        },
      });
      if (count >= 3) {
        throw new BadRequestException(
          'Free plan is limited to 3 tournaments. Please upgrade to Pro.',
        );
      }
    }

    // 3. Check customName uniqueness
    if (dto.customName) {
      const existing = await this.db.tournament.findUnique({
        where: { customName: dto.customName },
      });
      if (existing) {
        throw new BadRequestException(
          `The custom name '${dto.customName}' is already taken`,
        );
      }
    }

    const tournament = await this.db.tournament.create({
      data: {
        ...rest,
        start_date: new Date(start_date),
        end_date: new Date(end_date),
        organization_id: dto.organization_id,
      },
    });
    return ResponseUtil.success(tournament);
  }

  async update(id: string, userId: string, dto: UpdateTournamentDto) {
    const tournament = await this.db.tournament.findFirst({
      where: { OR: [{ id }, { customName: id }] },
    });
    if (!tournament) throw new NotFoundException('Tournament not found');

    if (!tournament.organization_id)
      throw new ForbiddenException('Tournament has no organization');

    // Check if user has OWNER or ADMIN role in the current organization
    await this.organizationsService.validateMemberRole(
      tournament.organization_id,
      userId,
      ['OWNER', 'ADMIN'],
    );

    // Check if user has OWNER or ADMIN role in the target organization
    if (
      dto.organization_id &&
      dto.organization_id !== tournament.organization_id
    ) {
      await this.organizationsService.validateMemberRole(
        dto.organization_id,
        userId,
        ['OWNER', 'ADMIN'],
      );
    }

    const { start_date, end_date, ...rest } = dto;

    // Check customName uniqueness if it's being updated
    if (dto.customName && dto.customName !== tournament.customName) {
      const existing = await this.db.tournament.findUnique({
        where: { customName: dto.customName },
      });
      if (existing) {
        throw new BadRequestException(
          `The custom name '${dto.customName}' is already taken`,
        );
      }
    }

    const updated = await this.db.tournament.update({
      where: { id: tournament.id },
      data: {
        ...rest,
        ...(start_date && { start_date: new Date(start_date) }),
        ...(end_date && { end_date: new Date(end_date) }),
      },
    });

    return ResponseUtil.success(updated);
  }

  async startSeason(id: string, userId: string, dto: StartSeasonDto) {
    const parentTournament = await this.db.tournament.findFirst({
      where: { OR: [{ id }, { customName: id }] },
    });
    if (!parentTournament) throw new NotFoundException('Tournament not found');

    if (!parentTournament.organization_id)
      throw new ForbiddenException('Tournament has no organization');

    // Check if user has permission
    await this.organizationsService.validateMemberRole(
      parentTournament.organization_id,
      userId,
      ['OWNER', 'ADMIN'],
    );

    // Create the new tournament using settings from parent
    const season = await this.db.tournament.create({
      data: {
        name: parentTournament.name,
        seasonName: dto.seasonName,
        start_date: new Date(dto.start_date),
        end_date: new Date(dto.end_date),
        organization_id: parentTournament.organization_id,
        parent_id: parentTournament.parent_id || parentTournament.id,

        sport: parentTournament.sport,
        type: parentTournament.type,
        participantType: parentTournament.participantType,
        scoringRules: parentTournament.scoringRules || {},
        visibility: parentTournament.visibility || Visibility.PUBLIC,

        logoUrl: parentTournament.logoUrl,
        bannerUrl: parentTournament.bannerUrl,
        location: parentTournament.location,
        timezone: parentTournament.timezone,

        maxParticipants: parentTournament.maxParticipants,
        autoApprove: parentTournament.autoApprove,
        twoLegsKnockout: parentTournament.twoLegsKnockout,
        thirdPlaceMatch: parentTournament.thirdPlaceMatch,
        numberOfGroups: parentTournament.numberOfGroups,
        teamsPerGroup: parentTournament.teamsPerGroup,
        doubleRoundRobin: (parentTournament as any).doubleRoundRobin,
        isPinned: false,
      },
    });

    return ResponseUtil.success(season);
  }

  async findAllPublic(
    page: number = 1,
    limit: number = 10,
    organizationSlug?: string,
    search?: string,
    type?: string,
    status?: string,
  ) {
    const skip = (page - 1) * limit;

    const whereClause: any = {
      visibility: Visibility.PUBLIC,
    };
    if (organizationSlug) {
      whereClause.organization = { slug: organizationSlug };
    }
    if (type) {
      whereClause.type = type;
    }
    if (search) {
      whereClause.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { sport: { contains: search, mode: 'insensitive' } },
        { location: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (status) {
      const now = new Date();
      if (status === 'ongoing') {
        whereClause.start_date = { lte: now };
        whereClause.end_date = { gte: now };
      } else if (status === 'past') {
        whereClause.end_date = { lt: now };
      } else if (status === 'upcoming') {
        whereClause.start_date = { gt: now };
      }
    }

    console.log(
      '[DEBUG findAllPublic] status:',
      status,
      'whereClause:',
      JSON.stringify(whereClause),
    );

    const [tournaments, total] = await Promise.all([
      this.db.tournament.findMany({
        where: whereClause,
        include: {
          organization: {
            select: {
              id: true,
              name: true,
              slug: true,
              isVerified: true,
              logoUrl: true,
              color: true,
            },
          },
          _count: {
            select: { participants: true },
          },
        },
        skip,
        take: limit,
        orderBy: { created_at: 'desc' },
      }),
      this.db.tournament.count({
        where: whereClause,
      }),
    ]);

    return ResponseUtil.paginated(tournaments, page, limit, total);
  }

  async findAllMine(
    userId: string,
    page: number = 1,
    limit: number = 10,
    organizationId?: string,
  ) {
    const skip = (page - 1) * limit;

    const where: any = {
      organization: {
        members: {
          some: { userId },
        },
      },
    };

    if (organizationId) {
      where.organization_id = organizationId;
    }

    const [tournaments, total] = await Promise.all([
      this.db.tournament.findMany({
        where,
        include: {
          organization: true,
          _count: {
            select: { participants: true },
          },
        },
        skip,
        take: limit,
        orderBy: { created_at: 'desc' },
      }),
      this.db.tournament.count({
        where,
      }),
    ]);

    // Add pending player counts
    const tournamentsWithCounts = await Promise.all(
      tournaments.map(async (t) => {
        const pendingRequestsCount = await this.db.player.count({
          where: {
            participant: { tournament_id: t.id },
            status: 'PENDING',
          },
        });
        return { ...t, pendingRequestsCount };
      }),
    );

    return ResponseUtil.paginated(tournamentsWithCounts, page, limit, total);
  }

  // fetch tournament by id or customName
  async findOne(identifier: string) {
    // Check if it looks like a CUID or a customName (slug)
    const tournament = await this.db.tournament.findFirst({
      where: {
        OR: [{ id: identifier }, { customName: identifier }],
      },
      include: {
        sponsors: true,
        socials: true,
        venues: true,
        _count: {
          select: { followers: true },
        },
      },
    });
    if (!tournament) {
      throw new NotFoundException('Tournament not found');
    }
    return ResponseUtil.success(tournament);
  }

  // fetch full tournament overview data to minimize concurrent API calls
  async getOverviewData(identifier: string) {
    const tournament = await this.db.tournament.findFirst({
      where: {
        OR: [{ id: identifier }, { customName: identifier }],
      },
      include: {
        sponsors: true,
        socials: true,
        venues: true,
        _count: {
          select: { followers: true },
        },
        organization: {
          select: {
            id: true,
            slug: true,
            name: true,
            isVerified: true,
            logoUrl: true,
            color: true,
          },
        },
        participants: {
          include: { players: true },
        },
        fixtures: {
          include: {
            homeTeam: {
              include: {
                user: { select: { id: true, name: true } },
                team: { select: { id: true, name: true } },
              },
            },
            awayTeam: {
              include: {
                user: { select: { id: true, name: true } },
                team: { select: { id: true, name: true } },
              },
            },
            group: true,
            matchEvents: {
              where: {
                type: { in: ['YELLOW_CARD', 'RED_CARD'] },
              },
            },
          },
          orderBy: { matchNumber: 'asc' },
        },
        standings: {
          include: {
            participant: {
              include: { team: true, user: true },
            },
          },
          orderBy: [
            { group: 'asc' },
            { points: 'desc' },
            { goalDiff: 'desc' },
            { goalsFor: 'desc' },
            { played: 'asc' },
          ],
        },
      },
    });

    if (!tournament) {
      throw new NotFoundException('Tournament not found');
    }

    const {
      participants,
      fixtures,
      standings,
      sponsors,
      socials,
      venues,
      ...tournamentData
    } = tournament;

    // Format standings to match what StandingsService returns
    const formattedStandings = standings.map((s) => ({
      ...s,
      participantName:
        s.participant?.team?.name ||
        s.participant?.customName ||
        s.participant?.user?.name ||
        'Unknown',
    }));

    return ResponseUtil.success({
      tournament: tournamentData,
      participants,
      fixtures,
      standings: formattedStandings,
      sponsors,
      socials,
      venues,
    });
  }

  // Get top players stats
  async getPlayerStats(tournamentId: string) {
    const tournament = await this.db.tournament.findFirst({
      where: { OR: [{ id: tournamentId }, { customName: tournamentId }] },
      select: { id: true, participantType: true },
    });

    if (!tournament) throw new NotFoundException('Tournament not found');

    if (tournament.participantType === 'INDIVIDUAL') {
      return ResponseUtil.success({ topScorers: [], topAssists: [] });
    }

    const events = await this.db.matchEvent.findMany({
      where: {
        fixture: { tournament_id: tournament.id },
        type: {
          in: [
            MatchEventType.GOAL,
            MatchEventType.PENALTY,
            MatchEventType.ASSIST,
          ],
        },
      },
      include: {
        player: {
          include: { participant: { include: { team: true, user: true } } },
        },
        relatedPlayer: {
          include: { participant: { include: { team: true, user: true } } },
        },
      },
    });

    const goalsMap = new Map<string, any>();
    const assistsMap = new Map<string, any>();

    for (const event of events) {
      if (event.half === MatchHalf.PENALTY_SHOOTOUT) {
        continue;
      }

      if (
        event.type === MatchEventType.GOAL ||
        event.type === MatchEventType.PENALTY
      ) {
        if (event.playerId && event.player) {
          if (!goalsMap.has(event.playerId)) {
            const participantName =
              event.player.participant?.team?.name ||
              event.player.participant?.customName ||
              event.player.participant?.user?.name ||
              'Unknown';
            const participantLogo =
              event.player.participant?.logoUrl ||
              (event.player.participant?.team as any)?.logoUrl ||
              null;
            goalsMap.set(event.playerId, {
              player: {
                id: event.player.id,
                name: event.player.name,
                number: event.player.number,
                avatarUrl: event.player.avatarUrl,
              },
              teamName: participantName,
              teamLogoUrl: participantLogo,
              count: 0,
            });
          }
          goalsMap.get(event.playerId).count += 1;
        }

        if (event.relatedPlayerId && event.relatedPlayer) {
          if (!assistsMap.has(event.relatedPlayerId)) {
            const participantName =
              event.relatedPlayer.participant?.team?.name ||
              event.relatedPlayer.participant?.customName ||
              event.relatedPlayer.participant?.user?.name ||
              'Unknown';
            const participantLogo =
              event.relatedPlayer.participant?.logoUrl ||
              (event.relatedPlayer.participant?.team as any)?.logoUrl ||
              null;
            assistsMap.set(event.relatedPlayerId, {
              player: {
                id: event.relatedPlayer.id,
                name: event.relatedPlayer.name,
                number: event.relatedPlayer.number,
                avatarUrl: event.relatedPlayer.avatarUrl,
              },
              teamName: participantName,
              teamLogoUrl: participantLogo,
              count: 0,
            });
          }
          assistsMap.get(event.relatedPlayerId).count += 1;
        }
      } else if (event.type === MatchEventType.ASSIST) {
        if (event.playerId && event.player) {
          if (!assistsMap.has(event.playerId)) {
            const participantName =
              event.player.participant?.team?.name ||
              event.player.participant?.customName ||
              event.player.participant?.user?.name ||
              'Unknown';
            const participantLogo =
              event.player.participant?.logoUrl ||
              (event.player.participant?.team as any)?.logoUrl ||
              null;
            assistsMap.set(event.playerId, {
              player: {
                id: event.player.id,
                name: event.player.name,
                number: event.player.number,
                avatarUrl: event.player.avatarUrl,
              },
              teamName: participantName,
              teamLogoUrl: participantLogo,
              count: 0,
            });
          }
          assistsMap.get(event.playerId).count += 1;
        }
      }
    }

    const topScorers = Array.from(goalsMap.values()).sort(
      (a, b) => b.count - a.count,
    );
    const topAssists = Array.from(assistsMap.values()).sort(
      (a, b) => b.count - a.count,
    );

    return ResponseUtil.success({ topScorers, topAssists });
  }

  // Check if a custom name is available
  async checkCustomName(customName: string) {
    const existing = await this.db.tournament.findUnique({
      where: { customName },
    });
    return ResponseUtil.success({ customName, available: !existing });
  }

  // Delete a tournament
  async remove(id: string, userId: string) {
    const tournament = await this.db.tournament.findFirst({
      where: { OR: [{ id }, { customName: id }] },
    });
    if (!tournament) throw new NotFoundException('Tournament not found');

    if (!tournament.organization_id)
      throw new ForbiddenException('Tournament has no organization');

    // Check if user has OWNER or ADMIN role in the organization
    await this.organizationsService.validateMemberRole(
      tournament.organization_id,
      userId,
      ['OWNER', 'ADMIN'],
    );

    await this.db.tournament.delete({ where: { id: tournament.id } });

    return ResponseUtil.success({ message: 'Tournament deleted successfully' });
  }

  // Follow a tournament
  async followTournament(userId: string, tournamentId: string) {
    const tournament = await this.db.tournament.findFirst({
      where: { OR: [{ id: tournamentId }, { customName: tournamentId }] },
    });
    if (!tournament) throw new NotFoundException('Tournament not found');

    const existing = await this.db.tournamentFollower.findUnique({
      where: { userId_tournamentId: { userId, tournamentId: tournament.id } },
    });

    if (!existing) {
      await this.db.tournamentFollower.create({
        data: { userId, tournamentId: tournament.id },
      });
    } else {
      throw new BadRequestException('Tournament already followed');
    }

    return ResponseUtil.success({
      message: 'Successfully followed tournament',
    });
  }

  // Unfollow a tournament
  async unfollowTournament(userId: string, tournamentId: string) {
    const tournament = await this.db.tournament.findFirst({
      where: { OR: [{ id: tournamentId }, { customName: tournamentId }] },
    });
    if (!tournament) throw new NotFoundException('Tournament not found');

    const existing = await this.db.tournamentFollower.findUnique({
      where: { userId_tournamentId: { userId, tournamentId: tournament.id } },
    });

    if (existing) {
      await this.db.tournamentFollower.delete({
        where: { userId_tournamentId: { userId, tournamentId: tournament.id } },
      });
    }
    return ResponseUtil.success({
      message: 'Successfully unfollowed tournament',
    });
  }

  // List followed tournaments
  async getFollowedTournaments(
    userId: string,
    page: number = 1,
    limit: number = 20,
  ) {
    const skip = (page - 1) * limit;

    const [followers, total] = await Promise.all([
      this.db.tournamentFollower.findMany({
        where: { userId },
        include: {
          tournament: {
            include: {
              organization: {
                select: {
                  id: true,
                  name: true,
                  slug: true,
                  isVerified: true,
                  logoUrl: true,
                  color: true,
                },
              },
              _count: { select: { participants: true } },
            },
          },
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.db.tournamentFollower.count({ where: { userId } }),
    ]);

    const tournaments = followers.map((f) => f.tournament);
    return ResponseUtil.paginated(tournaments, page, limit, total);
  }
}
