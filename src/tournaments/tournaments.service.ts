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
  ParticipantStatus,
  ParticipantType,
  SubscriptionPlan,
  SubscriptionStatus,
  TournamentType,
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
          isPractice: false,
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

  async createPractice(userId: string, organizationId: string) {
    await this.organizationsService.validateMemberRole(organizationId, userId, [
      'OWNER',
      'ADMIN',
    ]);

    // Limit to 3 active practice tournaments per org
    const practiceCount = await this.db.tournament.count({
      where: {
        organization_id: organizationId,
        isPractice: true,
        end_date: { gte: new Date() },
      },
    });
    if (practiceCount >= 3) {
      throw new BadRequestException(
        'You already have 3 active practice tournaments. Delete or let one expire first.',
      );
    }

    const now = new Date();
    const endDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const suffix = Math.random().toString(36).slice(2, 8);

    const tournament = await this.db.tournament.create({
      data: {
        name: `Practice Tournament ${suffix.toUpperCase()}`,
        customName: `practice-${suffix}`,
        description:
          'Sandbox tournament for training editors. Data here is temporary.',
        sport: 'Football',
        type: TournamentType.ROUND_ROBIN,
        participantType: ParticipantType.TEAM,
        visibility: Visibility.PRIVATE,
        isPractice: true,
        maxParticipants: 4,
        start_date: now,
        end_date: endDate,
        timezone: 'Africa/Lagos',
        scoringRules: { win: 3, draw: 1, loss: 0 },
        autoApprove: true,
        organization_id: organizationId,
      },
    });

    const teamNames = [
      { name: 'Practice United', short: 'PUN' },
      { name: 'Demo City', short: 'DEM' },
      { name: 'Sample FC', short: 'SAM' },
      { name: 'Training Athletic', short: 'TRA' },
    ];

    const participants = await Promise.all(
      teamNames.map((team, index) =>
        this.db.participant.create({
          data: {
            tournament_id: tournament.id,
            customName: team.name,
            customShortName: team.short,
            seed: index + 1,
            status: ParticipantStatus.CONFIRMED,
          },
        }),
      ),
    );

    // Seed fake players so editors can practice lineups, scorers, subs and MOTM
    const squadTemplate = [
      { number: 1, position: 'GK' },
      { number: 2, position: 'DEF' },
      { number: 3, position: 'DEF' },
      { number: 4, position: 'DEF' },
      { number: 5, position: 'DEF' },
      { number: 6, position: 'MID' },
      { number: 7, position: 'MID' },
      { number: 8, position: 'MID' },
      { number: 9, position: 'FWD' },
      { number: 10, position: 'MID' },
      { number: 11, position: 'FWD' },
    ];

    await this.db.player.createMany({
      data: participants.flatMap((participant) =>
        squadTemplate.map((slot) => ({
          participantId: participant.id,
          name: `${participant.customShortName} Player ${slot.number}`,
          number: slot.number,
          position: slot.position,
        })),
      ),
    });

    const pairings = [
      [[0, 1], [2, 3]],
      [[0, 2], [1, 3]],
      [[0, 3], [1, 2]],
    ];

    const fixturesData = pairings.flatMap((round, roundIndex) =>
      round.map(([home, away], matchIndex) => ({
        tournament_id: tournament.id,
        round: roundIndex + 1,
        matchNumber: matchIndex + 1,
        homeTeamId: participants[home]!.id,
        awayTeamId: participants[away]!.id,
        startTime: now,
      })),
    );

    await this.db.fixture.createMany({ data: fixturesData });

    return ResponseUtil.success(tournament);
  }

  async resetPractice(userId: string, id: string) {
    const tournament = await this.db.tournament.findFirst({
      where: { OR: [{ id }, { customName: id }] },
    });
    if (!tournament) throw new NotFoundException('Tournament not found');
    if (!tournament.isPractice) {
      throw new BadRequestException('Only practice tournaments can be reset');
    }
    if (!tournament.organization_id) {
      throw new ForbiddenException('Tournament has no organization');
    }
    await this.organizationsService.validateMemberRole(
      tournament.organization_id,
      userId,
      ['OWNER', 'ADMIN'],
    );

    // Wipe events, fixtures and standings
    await this.db.matchEvent.deleteMany({
      where: { fixture: { tournament_id: tournament.id } },
    });
    await this.db.fixture.deleteMany({
      where: { tournament_id: tournament.id },
    });
    await this.db.standing.deleteMany({
      where: { tournament_id: tournament.id },
    });

    // Recreate the initial round-robin fixtures
    const participants = await this.db.participant.findMany({
      where: { tournament_id: tournament.id },
      orderBy: { seed: 'asc' },
    });

    if (participants.length >= 2) {
      const pairings = [
        [[0, 1], [2, 3]],
        [[0, 2], [1, 3]],
        [[0, 3], [1, 2]],
      ];
      const now = new Date();
      const fixturesData = pairings.flatMap((round, roundIndex) =>
        round
          .filter(
            ([home, away]) => participants[home] && participants[away],
          )
          .map(([home, away], matchIndex) => ({
            tournament_id: tournament.id,
            round: roundIndex + 1,
            matchNumber: matchIndex + 1,
            homeTeamId: participants[home]!.id,
            awayTeamId: participants[away]!.id,
            startTime: now,
          })),
      );
      await this.db.fixture.createMany({ data: fixturesData });
    }

    return ResponseUtil.success({ message: 'Practice tournament reset' });
  }

  async autofillPractice(userId: string, id: string) {
    const tournament = await this.db.tournament.findFirst({
      where: { OR: [{ id }, { customName: id }] },
    });
    if (!tournament) throw new NotFoundException('Tournament not found');
    if (!tournament.isPractice) {
      throw new BadRequestException(
        'Only practice tournaments can be auto-filled',
      );
    }
    if (!tournament.organization_id) {
      throw new ForbiddenException('Tournament has no organization');
    }
    await this.organizationsService.validateMemberRole(
      tournament.organization_id,
      userId,
      ['OWNER', 'ADMIN'],
    );

    const fixtures = await this.db.fixture.findMany({
      where: { tournament_id: tournament.id, status: 'SCHEDULED' },
    });

    const participants = await this.db.participant.findMany({
      where: { tournament_id: tournament.id },
      include: { players: true, group: true },
    });

    const randomScore = () => Math.floor(Math.random() * 4);
    const pickPlayer = (participantId: string) => {
      const team = participants.find((p) => p.id === participantId);
      if (!team || team.players.length === 0) return null;
      return team.players[Math.floor(Math.random() * team.players.length)]!;
    };

    for (const fixture of fixtures) {
      const homeScore = randomScore();
      const awayScore = randomScore();

      await this.db.fixture.update({
        where: { id: fixture.id },
        data: {
          homeScore,
          awayScore,
          status: 'COMPLETED',
          timerIsRunning: false,
        },
      });

      // Create goal events with random scorers
      const goals: {
        participantId: string;
        count: number;
      }[] = [
        { participantId: fixture.homeTeamId!, count: homeScore },
        { participantId: fixture.awayTeamId!, count: awayScore },
      ];

      for (const side of goals) {
        for (let i = 0; i < side.count; i++) {
          const scorer = pickPlayer(side.participantId);
          const minute = 1 + Math.floor(Math.random() * 90);
          await this.db.matchEvent.create({
            data: {
              fixture_id: fixture.id,
              participant_id: side.participantId,
              playerId: scorer?.id ?? null,
              type: MatchEventType.GOAL,
              minute,
              half:
                minute > 45 ? MatchHalf.SECOND_HALF : MatchHalf.FIRST_HALF,
              description: scorer
                ? `Goal by ${scorer.name}`
                : 'Goal',
            },
          });
        }
      }
    }

    // Recalculate standings from completed fixtures
    const completedFixtures = await this.db.fixture.findMany({
      where: { tournament_id: tournament.id, status: 'COMPLETED' },
    });

    const stats = new Map<
      string,
      {
        played: number;
        wins: number;
        draws: number;
        losses: number;
        goalsFor: number;
        goalsAgainst: number;
        points: number;
      }
    >();

    for (const p of participants) {
      stats.set(p.id, {
        played: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        points: 0,
      });
    }

    for (const f of completedFixtures) {
      if (!f.homeTeamId || !f.awayTeamId) continue;
      const home = stats.get(f.homeTeamId);
      const away = stats.get(f.awayTeamId);
      if (!home || !away) continue;

      const hScore = f.homeScore ?? 0;
      const aScore = f.awayScore ?? 0;

      home.played++;
      away.played++;
      home.goalsFor += hScore;
      home.goalsAgainst += aScore;
      away.goalsFor += aScore;
      away.goalsAgainst += hScore;

      if (hScore > aScore) {
        home.wins++;
        home.points += 3;
        away.losses++;
      } else if (aScore > hScore) {
        away.wins++;
        away.points += 3;
        home.losses++;
      } else {
        home.draws++;
        home.points += 1;
        away.draws++;
        away.points += 1;
      }
    }

    for (const [participantId, s] of stats.entries()) {
      const participant = participants.find((p) => p.id === participantId);
      await this.db.standing.upsert({
        where: {
          tournament_id_participant_id: {
            tournament_id: tournament.id,
            participant_id: participantId,
          },
        },
        create: {
          tournament_id: tournament.id,
          participant_id: participantId,
          group: participant?.group?.name || null,
          ...s,
          goalDiff: s.goalsFor - s.goalsAgainst,
        },
        update: {
          group: participant?.group?.name || null,
          ...s,
          goalDiff: s.goalsFor - s.goalsAgainst,
        },
      });
    }

    return ResponseUtil.success({
      message: 'Practice tournament filled with sample results',
    });
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

    // Paid registration requires the organization to have a payout account
    if (dto.isPaidRegistration && !tournament.isPaidRegistration) {
      const organization = await this.db.organization.findUnique({
        where: { id: tournament.organization_id },
        select: { paystackSubaccountCode: true },
      });
      if (!organization?.paystackSubaccountCode) {
        throw new BadRequestException(
          'Set up a payout account in Billing before enabling paid registration',
        );
      }
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

  async findNearby(
    lat: number,
    lon: number,
    radiusKm: number = 50,
    page: number = 1,
    limit: number = 12,
  ) {
    const tournaments = await this.db.tournament.findMany({
      where: {
        visibility: Visibility.PUBLIC,
        latitude: { not: null },
        longitude: { not: null },
        end_date: { gte: new Date() },
      },
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
    });

    const withDistance = tournaments
      .map((tournament) => ({
        ...tournament,
        distanceKm: this.haversineKm(
          lat,
          lon,
          tournament.latitude!,
          tournament.longitude!,
        ),
      }))
      .filter((tournament) => tournament.distanceKm <= radiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm);

    const total = withDistance.length;
    const skip = (page - 1) * limit;
    const items = withDistance.slice(skip, skip + limit).map((tournament) => ({
      ...tournament,
      distanceKm: Math.round(tournament.distanceKm * 10) / 10,
    }));

    return ResponseUtil.paginated(items, page, limit, total);
  }

  private haversineKm(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number {
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const earthRadiusKm = 6371;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) *
        Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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
