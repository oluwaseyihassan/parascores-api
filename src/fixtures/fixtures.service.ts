import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import { UpdateFixtureDto } from './dto/update-fixture.dto';
import { SetResultsDto } from './dto/set-results.dto';
import { CreateFixtureDto } from './dto/create-fixture.dto';
import { CreateBulkFixturesDto } from './dto/create-bulk-fixtures.dto';
import { UpdateKnockoutPairingsDto } from './dto/update-knockout-pairings.dto';
import { ResponseUtil } from 'src/utils/api-response';
import { Subject } from 'rxjs';
import { OrganizationsService } from 'src/organizations/organizations.service';
import { RedisService } from 'src/redis/redis.service';
import { NotificationsService } from 'src/notifications/notifications.service';
import { PulseService } from 'src/pulse/pulse.service';

@Injectable()
export class FixturesService {
  public liveFixturesSubject = new Subject<{ type: string; data: any }>();

  constructor(
    private readonly db: DatabaseService,
    private readonly organizationsService: OrganizationsService,
    private readonly redisService: RedisService,
    private readonly notificationsService: NotificationsService,
    private readonly pulseService: PulseService,
  ) {}

  // Create a single fixture manually
  async create(dto: CreateFixtureDto, userId: string) {
    // Validate tournament exists
    const tournament = await this.db.tournament.findFirst({
      where: {
        OR: [{ id: dto.tournament_id }, { customName: dto.tournament_id }],
      },
      include: {
        organization: {
          include: {
            members: { where: { userId } },
          },
        },
      },
    });

    if (!tournament) {
      throw new NotFoundException('Tournament not found');
    }

    // Authorization check
    const membership = tournament.organization?.members[0];
    const isAuthorized =
      membership &&
      (membership.role === 'OWNER' || membership.role === 'ADMIN');

    if (!isAuthorized) {
      throw new ForbiddenException(
        'You are not authorized to create fixtures for this tournament',
      );
    }

    // Race events have no head-to-head teams — skip team validation
    const isRaceEvent = !dto.homeTeamId && !dto.awayTeamId;

    // Validate that home and away are different
    if (!isRaceEvent && dto.homeTeamId === dto.awayTeamId) {
      throw new BadRequestException('Home and Away teams must be different');
    }

    // Check for duplicates and matchday limits across the entire round
    const existingFixturesInRound = isRaceEvent
      ? []
      : await this.db.fixture.findMany({
          where: {
            tournament_id: tournament.id,
            round: dto.round,
          },
          select: { homeTeamId: true, awayTeamId: true },
        });

    // 1. Duplicate check (Teams already playing in this round)
    const teamsInRound = new Set<string>();
    const isTwoLegsKnockout =
      tournament.type === 'KNOCKOUT' && tournament.twoLegsKnockout;

    for (const f of existingFixturesInRound) {
      // Allow same matchup twice in the same round for two-legged knockouts
      const isSameMatchup =
        (f.homeTeamId === dto.homeTeamId && f.awayTeamId === dto.awayTeamId) ||
        (f.homeTeamId === dto.awayTeamId && f.awayTeamId === dto.homeTeamId);

      if (isTwoLegsKnockout && isSameMatchup) {
        continue;
      }

      if (f.homeTeamId) teamsInRound.add(f.homeTeamId);
      if (f.awayTeamId) teamsInRound.add(f.awayTeamId);
    }

    if (dto.homeTeamId && teamsInRound.has(dto.homeTeamId)) {
      throw new BadRequestException(
        `Home team is already scheduled for a match in this round`,
      );
    }
    if (dto.awayTeamId && teamsInRound.has(dto.awayTeamId)) {
      throw new BadRequestException(
        `Away team is already scheduled for a match in this round`,
      );
    }

    // Note: The per-team duplicate check above already prevents any team
    // from being scheduled twice in the same round, which is the correct constraint.

    // Auto-calculate match number if not provided
    let matchNumber = dto.matchNumber;
    if (!matchNumber) {
      const lastFixture = await this.db.fixture.findFirst({
        where: { tournament_id: tournament.id },
        orderBy: { matchNumber: 'desc' },
      });
      matchNumber = (lastFixture?.matchNumber ?? 0) + 1;
    }

    const fixture = await this.db.fixture.create({
      data: {
        tournament_id: tournament.id,
        homeTeamId: dto.homeTeamId,
        awayTeamId: dto.awayTeamId,
        round: dto.round,
        roundName: dto.roundName || `Matchday ${dto.round}`,
        matchNumber,
        startTime: dto.startTime ? new Date(dto.startTime) : null,
        venue: dto.venue || null,
        groupId: dto.groupId || null,
        stage: dto.stage || null,
        status: 'SCHEDULED',
        matchDuration:
          dto.matchDuration !== undefined ? dto.matchDuration : undefined,
        livestreamUrl: dto.livestreamUrl || null,
        livestreamPlatform: dto.livestreamPlatform || null,
      },
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
      },
    });

    // Invalidate caches
    await this.redisService.delPattern(
      `fixtures:tournament:${tournament.id}:*`,
    );
    if (tournament.customName) {
      await this.redisService.delPattern(
        `fixtures:tournament:${tournament.customName}:*`,
      );
    }
    await this.redisService.del('fixtures:live');
    await this.redisService.delPattern('fixtures:live:org:*');

    return ResponseUtil.success(fixture);
  }

  
  // Create fixtures in bulk (e.g. from manual schedule wizard)
  async createBulk(
    tournamentId: string,
    dto: CreateBulkFixturesDto,
    userId: string,
  ) {
    const tournament = await this.db.tournament.findFirst({
      where: {
        OR: [{ id: tournamentId }, { customName: tournamentId }],
      },
      include: {
        organization: {
          include: {
            members: { where: { userId } },
          },
        },
      },
    });

    if (!tournament) {
      throw new NotFoundException('Tournament not found');
    }

    const membership = tournament.organization?.members[0];
    const isAuthorized =
      membership &&
      (membership.role === 'OWNER' || membership.role === 'ADMIN');

    if (!isAuthorized) {
      throw new ForbiddenException(
        'You are not authorized to create fixtures for this tournament',
      );
    }

    if (!dto.fixtures || dto.fixtures.length === 0) {
      return ResponseUtil.success([], 'No fixtures to create');
    }

    // Auto-calculate match numbers
    const lastFixture = await this.db.fixture.findFirst({
      where: { tournament_id: tournament.id },
      orderBy: { matchNumber: 'desc' },
    });
    let startingMatchNumber = (lastFixture?.matchNumber ?? 0) + 1;

    const fixturesToInsert = dto.fixtures.map((f) => ({
      id: crypto.randomUUID(),
      tournament_id: tournament.id,
      homeTeamId: f.homeTeamId || null,
      awayTeamId: f.awayTeamId || null,
      round: f.round,
      roundName: f.roundName || `Matchday ${f.round}`,
      matchNumber: f.matchNumber ?? startingMatchNumber++,
      startTime: f.startTime ? new Date(f.startTime) : null,
      venue: f.venue || null,
      groupId: f.groupId || null,
      stage: f.stage || null,
      status: 'SCHEDULED' as any,
    }));

    await this.db.fixture.createMany({
      data: fixturesToInsert,
    });

    // Invalidate caches
    await this.redisService.delPattern(
      `fixtures:tournament:${tournament.id}:*`,
    );
    if (tournament.customName) {
      await this.redisService.delPattern(
        `fixtures:tournament:${tournament.customName}:*`,
      );
    }
    await this.redisService.del('fixtures:live');
    await this.redisService.delPattern('fixtures:live:org:*');

    return ResponseUtil.success(
      fixturesToInsert,
      `${fixturesToInsert.length} fixtures created successfully`,
    );
  }

  // Get a single fixture by ID
  async findOne(fixtureId: string) {
    const cacheKey = `fixtures:single:${fixtureId}`;
    const cachedResponse = await this.redisService.get<any>(cacheKey);
    if (cachedResponse) {
      return cachedResponse;
    }

    const fixture = await this.db.fixture.findUnique({
      where: { id: fixtureId },
      include: {
        homeTeam: {
          include: {
            user: { select: { id: true, name: true } },
            team: { select: { id: true, name: true } },
            players: true,
          },
        },
        awayTeam: {
          include: {
            user: { select: { id: true, name: true } },
            team: { select: { id: true, name: true } },
            players: true,
          },
        },
        matchEvents: {
          orderBy: { minute: 'asc' },
          include: {
            player: true,
            relatedPlayer: true,
            participant: {
              include: {
                team: true,
                user: true,
              },
            },
          },
        },
        tournament: {
          select: { id: true, name: true, sport: true },
        },
        resultEntries: {
          orderBy: { rank: 'asc' },
          include: {
            participant: {
              select: { customName: true, customShortName: true, logoUrl: true },
            },
          },
        },
        group: true,
        lineupPlayers: true,
        manOfTheMatchPlayer: {
          include: {
            participant: {
              include: {
                team: { select: { id: true, name: true, logoUrl: true } },
                user: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    });

    if (!fixture) {
      throw new NotFoundException('Fixture not found');
    }

    const response = ResponseUtil.success(fixture);
    await this.redisService.set(cacheKey, response, 3600); // Cache for 1 hour

    return response;
  }

  // Get all fixtures for a specific tournament
  async getTournamentFixtures(
    tournamentId: string,
    round?: number,
    stage?: any,
  ) {
    const cacheKey = `fixtures:tournament:${tournamentId}:${round ?? 'all'}:${stage ?? 'all'}`;
    const cachedResponse = await this.redisService.get<any>(cacheKey);
    if (cachedResponse) {
      return cachedResponse;
    }

    const tournament = await this.db.tournament.findFirst({
      where: { OR: [{ id: tournamentId }, { customName: tournamentId }] },
    });

    if (!tournament) {
      throw new NotFoundException('Tournament not found');
    }

    const whereClause: any = {
      tournament_id: tournament.id,
    };

    if (round !== undefined) {
      whereClause.round = round;
    }

    if (stage !== undefined) {
      whereClause.stage = stage;
    }

    const fixtures = await this.db.fixture.findMany({
      where: whereClause,
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
        manOfTheMatchPlayer: {
          select: { id: true, name: true, number: true },
        },
        resultEntries: {
          orderBy: { rank: 'asc' },
          include: {
            participant: {
              select: { customName: true, customShortName: true, logoUrl: true },
            },
          },
        },
      },
      orderBy: [{ round: 'asc' }, { startTime: 'asc' }, { matchNumber: 'asc' }],
    });

    const response = ResponseUtil.success(fixtures);
    await this.redisService.set(cacheKey, response, 3600); // Cache for 1 hour

    return response;
  }

  // Get all live fixtures (optionally filtered by organization)
  async findLive(organizationId?: string) {
    const cacheKey = organizationId
      ? `fixtures:live:org:${organizationId}`
      : `fixtures:live`;
    const cachedResponse = await this.redisService.get<any>(cacheKey);
    if (cachedResponse) {
      return cachedResponse;
    }

    const where: any = {
      status: { in: ['LIVE', 'NORMAL_TIME_ENDED', 'EXTRATIME'] },
    };
    if (organizationId) {
      where.tournament = { organization_id: organizationId };
    }

    const fixtures = await this.db.fixture.findMany({
      where,
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
        tournament: {
          select: { id: true, name: true, sport: true },
        },
        group: true,
      },
      orderBy: { startTime: 'asc' },
    });

    const response = ResponseUtil.success(fixtures);
    await this.redisService.set(cacheKey, response, 60); // Cache for 60 seconds

    return response;
  }

  // Update a fixture (status, scores, etc.)
  async update(fixtureId: string, userId: string, dto: UpdateFixtureDto) {
    const fixture = await this.db.fixture.findUnique({
      where: { id: fixtureId },
      include: {
        tournament: true,
      },
    });

    if (!fixture) {
      throw new NotFoundException('Fixture not found');
    }

    if (!fixture.tournament.organization_id) {
      throw new ForbiddenException('Tournament has no organization');
    }

    // Role-based access control
    const membership = await this.organizationsService.validateMemberRole(
      fixture.tournament.organization_id,
      userId,
      ['OWNER', 'ADMIN', 'MEMBER'],
    );

    if (membership.role === 'MEMBER') {
      // Members can only update scores and status
      const allowedFields = [
        'homeScore',
        'awayScore',
        'homePenaltyScore',
        'awayPenaltyScore',
        'status',
        'timerStartedAt',
        'timerElapsedSeconds',
        'timerIsRunning',
        'matchDuration',
        'manOfTheMatchPlayerId',
        'periodScores',
        'allowReopen',
      ];
      const attemptedFields = Object.keys(dto).filter(
        (key) => dto[key] !== undefined,
      );
      const invalidFields = attemptedFields.filter(
        (field) => !allowedFields.includes(field),
      );

      if (invalidFields.length > 0) {
        throw new ForbiddenException(
          `Members are only allowed to update scores and status. Restricted fields: ${invalidFields.join(', ')}`,
        );
      }
    }

    // Race fixtures (or fixtures with result entries) are ranked by
    // placement — completion behaves differently (no FT push, no winner check)
    const raceEntryCount = await this.db.resultEntry.count({
      where: { fixtureId },
    });

    // Combat engines record an explicit winner in fixture.config (a KO/DQ can
    // end a bout with the scores level) — that bypasses the knockout tie check
    const winnerOverride =
      (dto.config?.winnerId ?? (fixture.config as any)?.winnerId) != null;

    // Validate penalty scores for knockout matches being completed for the first time
    if (dto.status === 'COMPLETED') {
      const homeScore = dto.homeScore ?? fixture.homeScore ?? 0;
      const awayScore = dto.awayScore ?? fixture.awayScore ?? 0;
      const homePen = dto.homePenaltyScore ?? fixture.homePenaltyScore ?? 0;
      const awayPen = dto.awayPenaltyScore ?? fixture.awayPenaltyScore ?? 0;

      // Validate that knockout matches have a winner
      const tournament = await this.db.tournament.findUnique({
        where: { id: fixture.tournament_id },
        select: { type: true, twoLegsKnockout: true },
      });

      // Race fixtures are ranked by result entries, not head-to-head winner
      const isRace = tournament?.type === 'RACE' || raceEntryCount > 0;

      const isKnockoutStage =
        !isRace &&
        (tournament?.type === 'KNOCKOUT' ||
          (tournament?.type === 'HYBRID' && fixture.stage === 'KNOCKOUT'));

      if (isKnockoutStage) {
        let isTie = homeScore === awayScore && !winnerOverride;

        if (tournament?.twoLegsKnockout) {
          if (fixture.matchNumber % 2 !== 0) {
            // Leg 1 is allowed to essentially end in a tie (no penalties needed)
            isTie = false;
          } else {
            // Leg 2: Check the aggregate score
            const leg1 = await this.db.fixture.findFirst({
              where: {
                tournament_id: fixture.tournament_id,
                round: fixture.round,
                matchNumber: fixture.matchNumber - 1,
                ...(fixture.stage ? { stage: fixture.stage } : {}),
                ...(fixture.groupId ? { groupId: fixture.groupId } : {}),
              },
            });

            if (leg1) {
              const aggHome = homeScore + (leg1.awayScore ?? 0);
              const aggAway = awayScore + (leg1.homeScore ?? 0);
              isTie = aggHome === aggAway;
            }
          }
        }

        if (isTie && homePen === awayPen) {
          throw new BadRequestException(
            'Penalty scores cannot be equal when regular scores (or aggregate scores) are tied in a knockout match',
          );
        }
      }
    }

    // Guard: Prevent restarting a completed or cancelled fixture unless explicitly reopening
    if (
      dto.status === 'LIVE' &&
      (fixture.status === 'COMPLETED' || fixture.status === 'CANCELLED') &&
      !dto.allowReopen
    ) {
      throw new BadRequestException(
        `Cannot start a fixture that is already ${fixture.status.toLowerCase()}. Refresh your page to see the latest state.`,
      );
    }

    // Guard: Prevent starting a match that is already live (stale tab race condition)
    if (
      dto.status === 'LIVE' &&
      fixture.status === 'LIVE' &&
      dto.timerElapsedSeconds === 0 &&
      !dto.allowReopen
    ) {
      throw new BadRequestException(
        'This match is already live. Refresh your page to see the latest state.',
      );
    }

    // Validate Leg 1 completion before starting Leg 2
    if (
      dto.status === 'LIVE' &&
      fixture.status !== 'LIVE' &&
      fixture.status !== 'NORMAL_TIME_ENDED'
    ) {
      // Validate that both teams are assigned (not TBD)
      const homeTeamId = dto.homeTeamId || fixture.homeTeamId;
      const awayTeamId = dto.awayTeamId || fixture.awayTeamId;

      if (!homeTeamId || !awayTeamId) {
        throw new BadRequestException(
          'Cannot start a fixture that contains unassigned teams (TBD). Please assign teams first.',
        );
      }

      const tournament = await this.db.tournament.findUnique({
        where: { id: fixture.tournament_id },
        select: { type: true, twoLegsKnockout: true },
      });

      if (
        tournament?.twoLegsKnockout &&
        (tournament.type === 'KNOCKOUT' || tournament.type === 'HYBRID') &&
        fixture.matchNumber % 2 === 0 &&
        fixture.roundName?.includes('Leg 2')
      ) {
        const leg1 = await this.db.fixture.findFirst({
          where: {
            tournament_id: fixture.tournament_id,
            round: fixture.round,
            matchNumber: fixture.matchNumber - 1,
            ...(fixture.stage ? { stage: fixture.stage } : {}),
            ...(fixture.groupId ? { groupId: fixture.groupId } : {}),
          },
        });

        if (leg1 && leg1.status !== 'COMPLETED') {
          throw new BadRequestException(
            'Cannot start Leg 2 until Leg 1 is completed',
          );
        }
      }
    }

    // Track whether this match was already completed
    const wasAlreadyCompleted = fixture.status === 'COMPLETED';

    const updatedFixture = await this.db.fixture.update({
      where: { id: fixtureId },
      data: {
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.homeScore !== undefined && { homeScore: dto.homeScore }),
        ...(dto.awayScore !== undefined && { awayScore: dto.awayScore }),
        ...(dto.timerStartedAt !== undefined && {
          timerStartedAt: dto.timerStartedAt
            ? new Date(dto.timerStartedAt)
            : null,
        }),
        ...(dto.timerElapsedSeconds !== undefined && {
          timerElapsedSeconds: dto.timerElapsedSeconds,
        }),
        ...(dto.timerIsRunning !== undefined && {
          timerIsRunning: dto.timerIsRunning,
        }),
        ...(dto.matchDuration !== undefined && {
          matchDuration: dto.matchDuration,
        }),
        ...(dto.half !== undefined && { half: dto.half }),
        ...(dto.startTime !== undefined && {
          startTime: new Date(dto.startTime),
        }),
        ...(dto.homePenaltyScore !== undefined && {
          homePenaltyScore: dto.homePenaltyScore,
        }),
        ...(dto.awayPenaltyScore !== undefined && {
          awayPenaltyScore: dto.awayPenaltyScore,
        }),
        ...(dto.periodScores !== undefined && {
          periodScores: dto.periodScores,
        }),
        ...(dto.config !== undefined && { config: dto.config }),
        ...(dto.homeTeamId !== undefined && { homeTeamId: dto.homeTeamId }),
        ...(dto.awayTeamId !== undefined && { awayTeamId: dto.awayTeamId }),
        ...(dto.venue !== undefined && { venue: dto.venue }),
        ...(dto.homeFormation !== undefined && {
          homeFormation: dto.homeFormation,
        }),
        ...(dto.awayFormation !== undefined && {
          awayFormation: dto.awayFormation,
        }),
        ...(dto.lineupPositions !== undefined && {
          lineupPositions: dto.lineupPositions,
        }),
        ...(dto.lineupPlayerIds !== undefined && {
          lineupPlayers: {
            set: dto.lineupPlayerIds.map((id) => ({ id })),
          },
        }),
        ...(dto.manOfTheMatchPlayerId !== undefined && {
          manOfTheMatchPlayerId: dto.manOfTheMatchPlayerId,
        }),
        ...(dto.livestreamUrl !== undefined && {
          livestreamUrl: dto.livestreamUrl || null,
        }),
        ...(dto.livestreamPlatform !== undefined && {
          livestreamPlatform: dto.livestreamPlatform || null,
        }),
      },
      include: {
        homeTeam: {
          include: {
            user: { select: { id: true, name: true } },
            team: { select: { id: true, name: true } },
            players: true,
          },
        },
        awayTeam: {
          include: {
            user: { select: { id: true, name: true } },
            team: { select: { id: true, name: true } },
            players: true,
          },
        },
        tournament: { select: { id: true, type: true } },
        group: true,
        lineupPlayers: true,
        manOfTheMatchPlayer: {
          include: {
            participant: {
              include: {
                team: { select: { id: true, name: true, logoUrl: true } },
                user: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    });

    if (updatedFixture.status === 'COMPLETED') {
      const tournament = updatedFixture.tournament;

      const isKnockoutStage =
        tournament.type === 'KNOCKOUT' ||
        (tournament.type === 'HYBRID' && updatedFixture.stage === 'KNOCKOUT');

      if (isKnockoutStage) {
        const tournamentSettings = await this.db.tournament.findUnique({
          where: { id: updatedFixture.tournament_id },
          select: { twoLegsKnockout: true },
        });

        const isTwoLegged = tournamentSettings?.twoLegsKnockout;
        const isLeg1 = isTwoLegged && updatedFixture.matchNumber % 2 !== 0;

        if (isLeg1 && wasAlreadyCompleted) {
          const leg2 = await this.db.fixture.findFirst({
            where: {
              tournament_id: updatedFixture.tournament_id,
              round: updatedFixture.round,
              matchNumber: updatedFixture.matchNumber + 1,
              ...(updatedFixture.stage ? { stage: updatedFixture.stage } : {}),
            },
          });

          if (leg2 && leg2.status === 'COMPLETED') {
            const oldAggHome = (leg2.homeScore ?? 0) + (fixture.awayScore ?? 0);
            const oldAggAway = (leg2.awayScore ?? 0) + (fixture.homeScore ?? 0);
            let oldWinnerId: string | null = null;
            if (oldAggHome > oldAggAway) oldWinnerId = leg2.homeTeamId;
            else if (oldAggAway > oldAggHome) oldWinnerId = leg2.awayTeamId;
            else {
              const oldHomePen = leg2.homePenaltyScore ?? 0;
              const oldAwayPen = leg2.awayPenaltyScore ?? 0;
              if (oldHomePen > oldAwayPen) oldWinnerId = leg2.homeTeamId;
              else if (oldAwayPen > oldHomePen) oldWinnerId = leg2.awayTeamId;
            }

            const newAggHome =
              (leg2.homeScore ?? 0) + (updatedFixture.awayScore ?? 0);
            const newAggAway =
              (leg2.awayScore ?? 0) + (updatedFixture.homeScore ?? 0);
            let newWinnerId: string | null = null;
            if (newAggHome > newAggAway) newWinnerId = leg2.homeTeamId;
            else if (newAggAway > newAggHome) newWinnerId = leg2.awayTeamId;
            else {
              const newHomePen = leg2.homePenaltyScore ?? 0;
              const newAwayPen = leg2.awayPenaltyScore ?? 0;
              if (newHomePen > newAwayPen) newWinnerId = leg2.homeTeamId;
              else if (newAwayPen > newHomePen) newWinnerId = leg2.awayTeamId;
            }

            if (oldWinnerId && newWinnerId && oldWinnerId !== newWinnerId) {
              await this.validateAndSwapDownstream(
                leg2,
                oldWinnerId,
                newWinnerId,
              );
            } else if (
              newWinnerId &&
              (!oldWinnerId || oldWinnerId === newWinnerId)
            ) {
              await this.handleKnockoutProgression(leg2);
            }
          }
        } else if (!isLeg1) {
          const oldWinnerId = wasAlreadyCompleted
            ? await this.determineWinnerFromFixture(
                fixture,
                fixture.tournament_id,
              )
            : null;
          const newWinnerId = await this.determineWinnerFromFixture(
            updatedFixture,
            updatedFixture.tournament_id,
          );

          if (
            wasAlreadyCompleted &&
            oldWinnerId &&
            newWinnerId &&
            oldWinnerId !== newWinnerId
          ) {
            await this.validateAndSwapDownstream(
              updatedFixture,
              oldWinnerId,
              newWinnerId,
            );
          } else {
            await this.handleKnockoutProgression(updatedFixture);
          }
        }
      } else if (
        tournament.type === 'GROUP' ||
        tournament.type === 'ROUND_ROBIN' ||
        tournament.type === 'LEAGUE' ||
        tournament.type === 'HYBRID'
      ) {
        await this.updateStandings(updatedFixture.tournament_id);
      }
    }

    // Invalidate caches
    await this.redisService.del(`fixtures:single:${fixtureId}`);
    await this.redisService.delPattern(
      `fixtures:tournament:${fixture.tournament_id}:*`,
    );
    if (fixture.tournament?.customName) {
      await this.redisService.delPattern(
        `fixtures:tournament:${fixture.tournament.customName}:*`,
      );
    }
    await this.redisService.del('fixtures:live');
    await this.redisService.delPattern('fixtures:live:org:*');
    await this.redisService.del(`standings:${fixture.tournament_id}`);
    if (fixture.tournament?.customName) {
      await this.redisService.del(`standings:${fixture.tournament.customName}`);
    }

    this.liveFixturesSubject.next({
      type: 'fixture_updated',
      data: updatedFixture,
    });

    // Kickoff notification
    if (
      updatedFixture.status === 'LIVE' &&
      fixture.status !== 'LIVE' &&
      fixture.status !== 'NORMAL_TIME_ENDED'
    ) {
      const homeName =
        updatedFixture.homeTeam?.customName ||
        updatedFixture.homeTeam?.team?.name ||
        'TBD';
      const awayName =
        updatedFixture.awayTeam?.customName ||
        updatedFixture.awayTeam?.team?.name ||
        'TBD';
      const title = `Match Kicked Off! ⚽`;
      const body = `${homeName} vs ${awayName} has started. Follow for live updates!`;
      const url = `/t/${updatedFixture.tournament_id}/fixture/${updatedFixture.id}`;
      this.notificationsService
        .sendNotificationToTournamentFollowers(
          updatedFixture.tournament_id,
          title,
          body,
          url,
          `fixture-${updatedFixture.id}-kickoff`,
        )
        .catch(() => {});
      this.pulseService
        .recordFixtureState(updatedFixture.id, 'kickoff')
        .catch(() => {});
    }

    // Race completion: official result notification with medalists,
    // no football-style FT/medal behaviors
    const isRaceCompletion =
      updatedFixture.status === 'COMPLETED' &&
      fixture.status !== 'COMPLETED' &&
      raceEntryCount > 0;

    if (isRaceCompletion) {
      const topThree = await this.db.resultEntry.findMany({
        where: { fixtureId, rank: { in: [1, 2, 3] } },
        orderBy: { rank: 'asc' },
        include: { participant: { select: { customName: true, customShortName: true } } },
      });
      if (topThree.length > 0) {
        const medals = ['🥇', '🥈', '🥉'];
        const podiumText = topThree
          .map(
            (e) =>
              `${medals[(e.rank ?? 1) - 1]} ${e.participant.customShortName ?? e.participant.customName}${e.value ? ` (${e.value})` : ''}`,
          )
          .join(' · ');
        const title = `🏁 Official Result: ${fixture.tournament?.name ?? 'Race'}${updatedFixture.roundName ? ` ${updatedFixture.roundName}` : ''}`;
        const url = `/t/${updatedFixture.tournament_id}/fixture/${updatedFixture.id}`;
        this.notificationsService
          .sendNotificationToTournamentFollowers(
            updatedFixture.tournament_id,
            title,
            podiumText,
            url,
            `fixture-${updatedFixture.id}-result`,
          )
          .catch(() => {});
        this.pulseService
          .recordFixtureState(updatedFixture.id, 'race_result')
          .catch(() => {});
      }
    }

    // Full-time completion notification (match sports only)
    if (
      !isRaceCompletion &&
      updatedFixture.status === 'COMPLETED' &&
      fixture.status !== 'COMPLETED'
    ) {
      const homeName =
        updatedFixture.homeTeam?.customName ||
        updatedFixture.homeTeam?.team?.name ||
        'TBD';
      const awayName =
        updatedFixture.awayTeam?.customName ||
        updatedFixture.awayTeam?.team?.name ||
        'TBD';
      const homeScore = updatedFixture.homeScore ?? 0;
      const awayScore = updatedFixture.awayScore ?? 0;
      const title = `Full Time: ${homeName} ${homeScore} - ${awayScore} ${awayName} 🏁`;
      const body = `The match has ended. Final score: ${homeName} ${homeScore} - ${awayScore} ${awayName}.`;
      const url = `/t/${updatedFixture.tournament_id}/fixture/${updatedFixture.id}`;
      this.notificationsService
        .sendNotificationToTournamentFollowers(
          updatedFixture.tournament_id,
          title,
          body,
          url,
          `fixture-${updatedFixture.id}-completion`,
        )
        .catch(() => {});
      this.pulseService
        .recordFixtureState(updatedFixture.id, 'full_time')
        .catch(() => {});

      // Medal notification: finals (gold/silver) and third-place matches (bronze)
      const roundName = updatedFixture.roundName;
      if (roundName === 'Final' || roundName === 'Third Place Match') {
        // Winner: score first, penalty shootout as tiebreak
        let winnerName: string | null = null;
        let loserName: string | null = null;
        if (homeScore !== awayScore) {
          winnerName = homeScore > awayScore ? homeName : awayName;
          loserName = homeScore > awayScore ? awayName : homeName;
        } else {
          const hp = updatedFixture.homePenaltyScore;
          const ap = updatedFixture.awayPenaltyScore;
          if (hp != null && ap != null && hp !== ap) {
            winnerName = hp > ap ? homeName : awayName;
            loserName = hp > ap ? awayName : homeName;
          }
        }

        if (winnerName && loserName) {
          const isFinal = roundName === 'Final';
          const medalTitle = isFinal
            ? `🥇 GOLD: ${winnerName} are champions!`
            : `🥉 BRONZE: ${winnerName} take third place!`;
          const medalBody = isFinal
            ? `${winnerName} beat ${loserName} ${homeScore} - ${awayScore} in the final. ${loserName} take silver.`
            : `${winnerName} beat ${loserName} ${homeScore} - ${awayScore} in the third-place match.`;
          const medalUrl = `/t/${updatedFixture.tournament_id}/fixture/${updatedFixture.id}`;
          this.notificationsService
            .sendNotificationToTournamentFollowers(
              updatedFixture.tournament_id,
              medalTitle,
              medalBody,
              medalUrl,
              `fixture-${updatedFixture.id}-medal`,
            )
            .catch(() => {});
          this.pulseService
            .recordFixtureState(updatedFixture.id, 'medal', {
              medal: isFinal ? 'gold' : 'bronze',
              winnerName,
              loserName,
              homeScore,
              awayScore,
            })
            .catch(() => {});
        }
      }
    }

        if (
      (dto.homeTeamId !== undefined || dto.awayTeamId !== undefined) &&
      fixture.tournament.twoLegsKnockout &&
      fixture.roundName?.includes('Leg 1')
    ) {
      const leg2 = await this.db.fixture.findFirst({
        where: {
          tournament_id: fixture.tournament_id,
          round: fixture.round,
          matchNumber: fixture.matchNumber + 1,
          roundName: { contains: 'Leg 2' },
        },
      });
      if (leg2) {
        await this.db.fixture.update({
          where: { id: leg2.id },
          data: {
            ...(dto.awayTeamId !== undefined && { homeTeamId: dto.awayTeamId, homeTeamPlaceholder: null }),
            ...(dto.homeTeamId !== undefined && { awayTeamId: dto.homeTeamId, awayTeamPlaceholder: null }),
          },
        });
      }
    }

    return ResponseUtil.success(updatedFixture);
    // mirroringCodeAdded
  }

  // Set placement results for a race fixture (athletics, swimming).
  // Bulk-upserts entries and computes ranks (lowest numeric value wins).
  async setResults(fixtureId: string, userId: string, dto: SetResultsDto) {
    const fixture = await this.db.fixture.findUnique({
      where: { id: fixtureId },
      include: { tournament: true },
    });

    if (!fixture) {
      throw new NotFoundException('Fixture not found');
    }

    if (!fixture.tournament.organization_id) {
      throw new ForbiddenException('Tournament has no organization');
    }

    // Scoring officials (MEMBER) may set results — same policy as scores
    await this.organizationsService.validateMemberRole(
      fixture.tournament.organization_id,
      userId,
      ['OWNER', 'ADMIN', 'MEMBER'],
    );

    // Ranks: parse "10.42" / "2:03.44" / "1:02:33.5" numerically; direction
    // decides winner order ('low' = fastest, 'high' = biggest lift/distance).
    // Entries with an explicit rank (manual placement, no value) keep it.
    const toSeconds = (v: string): number => {
      const parts = v.split(':');
      if (parts.length === 3) {
        return Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2]);
      }
      if (parts.length === 2) {
        return Number(parts[0]) * 60 + Number(parts[1]);
      }
      return Number(v);
    };

    const direction = dto.direction ?? 'low';

    const explicitRanked = dto.results.filter((r) => r.rank != null);
    const timed = dto.results
      .filter((r) => r.rank == null && r.value)
      .map((r) => ({ ...r, seconds: toSeconds(r.value!) }))
      .filter((r) => !Number.isNaN(r.seconds))
      .sort((a, b) =>
        direction === 'high' ? b.seconds - a.seconds : a.seconds - b.seconds,
      );

    // Timed entries fill the ranks not taken by explicit placements
    const takenRanks = new Set(explicitRanked.map((r) => r.rank as number));
    const rankByParticipant = new Map<string, number>();
    for (const r of explicitRanked) {
      rankByParticipant.set(r.participantId, r.rank as number);
    }
    let nextRank = 1;
    for (const r of timed) {
      while (takenRanks.has(nextRank)) nextRank++;
      rankByParticipant.set(r.participantId, nextRank);
      takenRanks.add(nextRank);
      nextRank++;
    }

    await this.db.$transaction(async (tx) => {
      for (const r of dto.results) {
        await tx.resultEntry.upsert({
          where: {
            fixtureId_participantId: {
              fixtureId,
              participantId: r.participantId,
            },
          },
          create: {
            fixtureId,
            participantId: r.participantId,
            value: r.value,
            lane: r.lane,
            note: r.note,
            rank: rankByParticipant.get(r.participantId),
          },
          update: {
            value: r.value,
            lane: r.lane,
            note: r.note,
            rank: rankByParticipant.get(r.participantId),
          },
        });
      }

      // Full replace: athletes not in the payload are removed from the event
      // (not every institution enters every event)
      await tx.resultEntry.deleteMany({
        where: {
          fixtureId,
          participantId: {
            notIn: dto.results.map((r) => r.participantId),
          },
        },
      });
    });

    const updated = await this.db.fixture.findUnique({
      where: { id: fixtureId },
      include: {
        resultEntries: {
          orderBy: { rank: 'asc' },
          include: {
            participant: {
              select: { customName: true, customShortName: true, logoUrl: true },
            },
          },
        },
      },
    });

    // Invalidate caches so result entries are fresh everywhere
    await this.redisService.delPattern(`fixtures:tournament:${fixture.tournament_id}:*`);
    await this.redisService.del(`fixtures:single:${fixtureId}`);

    this.liveFixturesSubject.next({
      type: 'fixture_updated',
      data: updated,
    });

    return ResponseUtil.success(updated, 'Results saved successfully');
  }

  // Knockout Progression: Move winner to next round
  private async handleKnockoutProgression(fixture: any) {
    if (!fixture.nextFixtureId) return;

    const tournament = await this.db.tournament.findUnique({
      where: { id: fixture.tournament_id },
      select: { type: true, twoLegsKnockout: true },
    });

    let homeScore = fixture.homeScore ?? 0;
    let awayScore = fixture.awayScore ?? 0;
    const homePen = fixture.homePenaltyScore ?? 0;
    const awayPen = fixture.awayPenaltyScore ?? 0;

    if (
      tournament?.twoLegsKnockout &&
      (tournament.type === 'KNOCKOUT' || tournament.type === 'HYBRID')
    ) {
      if (fixture.matchNumber % 2 !== 0) {
        return;
      }

      const leg1 = await this.db.fixture.findFirst({
        where: {
          tournament_id: fixture.tournament_id,
          round: fixture.round,
          matchNumber: fixture.matchNumber - 1,
          ...(fixture.stage ? { stage: fixture.stage } : {}),
          ...(fixture.groupId ? { groupId: fixture.groupId } : {}),
        },
      });

      if (leg1) {
        homeScore += leg1.awayScore ?? 0;
        awayScore += leg1.homeScore ?? 0;
      }
    }

    let winnerId: string | null = null;

    if (homeScore > awayScore) {
      winnerId = fixture.homeTeamId;
    } else if (awayScore > homeScore) {
      winnerId = fixture.awayTeamId;
    } else {
      if (homePen !== awayPen) {
        if (homePen > awayPen) {
          winnerId = fixture.homeTeamId;
        } else {
          winnerId = fixture.awayTeamId;
        }
      }
    }

    if (winnerId) {
      const loserId =
        winnerId === fixture.homeTeamId
          ? fixture.awayTeamId
          : fixture.homeTeamId;

      const nextFixture = await this.db.fixture.findUnique({
        where: { id: fixture.nextFixtureId },
      });

      let isHomeFeed = fixture.matchNumber % 2 !== 0;

      if (tournament?.twoLegsKnockout) {
        const slotIndex = Math.ceil(fixture.matchNumber / 2);
        isHomeFeed = slotIndex % 2 !== 0;
      }

      // Special handling for playoff round or pre-seeded direct bye fixtures
      if (nextFixture) {
        if (
          nextFixture.homeTeamPlaceholder?.startsWith('Seed ') &&
          (nextFixture.awayTeamPlaceholder?.includes('PO(') ||
           nextFixture.awayTeamPlaceholder?.includes('Winner'))
        ) {
          isHomeFeed = false;
        } else if (
          nextFixture.awayTeamPlaceholder?.startsWith('Seed ') &&
          (nextFixture.homeTeamPlaceholder?.includes('PO(') ||
           nextFixture.homeTeamPlaceholder?.includes('Winner'))
        ) {
          isHomeFeed = true;
        } else if (nextFixture.homeTeamId && !nextFixture.awayTeamId) {
          isHomeFeed = false;
        } else if (nextFixture.awayTeamId && !nextFixture.homeTeamId) {
          isHomeFeed = true;
        }
      }

      await this.db.fixture.update({
        where: { id: fixture.nextFixtureId },
        data: {
          ...(isHomeFeed ? { homeTeamId: winnerId } : { awayTeamId: winnerId }),
        },
      });

      if (tournament?.twoLegsKnockout) {

        if (nextFixture && nextFixture.roundName?.includes('Leg 1')) {
          const leg2OfNext = await this.db.fixture.findFirst({
            where: {
              tournament_id: fixture.tournament_id,
              round: nextFixture.round,
              matchNumber: nextFixture.matchNumber + 1,
              ...(fixture.stage ? { stage: fixture.stage } : {}),
            },
          });

          if (leg2OfNext) {
            await this.db.fixture.update({
              where: { id: leg2OfNext.id },
              data: {
                ...(isHomeFeed
                  ? { awayTeamId: winnerId }
                  : { homeTeamId: winnerId }),
              },
            });
          }
        }
      }

      if (loserId) {
        const fullTournament = await this.db.tournament.findUnique({
          where: { id: fixture.tournament_id },
          select: { thirdPlaceMatch: true },
        });

        if (fullTournament?.thirdPlaceMatch) {
          const nextFixture = await this.db.fixture.findUnique({
            where: { id: fixture.nextFixtureId },
          });

          if (nextFixture) {
            const thirdPlaceFixture = await this.db.fixture.findFirst({
              where: {
                tournament_id: fixture.tournament_id,
                round: nextFixture.round,
                roundName: 'Third Place Match',
                ...(fixture.stage ? { stage: fixture.stage } : {}),
              },
            });

            if (thirdPlaceFixture) {
              await this.db.fixture.update({
                where: { id: thirdPlaceFixture.id },
                data: {
                  ...(isHomeFeed
                    ? { homeTeamId: loserId }
                    : { awayTeamId: loserId }),
                },
              });
            }
          }
        }
      }
    }
  }

  // Determine the winner of a fixture, accounting for two-legged aggregate scores
  private async determineWinnerFromFixture(
    fixture: any,
    tournamentId: string,
  ): Promise<string | null> {
    const tournament = await this.db.tournament.findUnique({
      where: { id: tournamentId },
      select: { type: true, twoLegsKnockout: true },
    });

    let homeScore = fixture.homeScore ?? 0;
    let awayScore = fixture.awayScore ?? 0;
    const homePen = fixture.homePenaltyScore ?? 0;
    const awayPen = fixture.awayPenaltyScore ?? 0;

    const isTwoLegged =
      tournament?.twoLegsKnockout &&
      (tournament.type === 'KNOCKOUT' || tournament.type === 'HYBRID');

    if (isTwoLegged) {
      if (fixture.matchNumber % 2 !== 0) return null;

      const leg1 = await this.db.fixture.findFirst({
        where: {
          tournament_id: tournamentId,
          round: fixture.round,
          matchNumber: fixture.matchNumber - 1,
          ...(fixture.stage ? { stage: fixture.stage } : {}),
        },
      });

      if (leg1) {
        homeScore += leg1.awayScore ?? 0;
        awayScore += leg1.homeScore ?? 0;
      }
    }

    if (homeScore > awayScore) return fixture.homeTeamId;
    if (awayScore > homeScore) return fixture.awayTeamId;

    if (homePen > awayPen) return fixture.homeTeamId;
    if (awayPen > homePen) return fixture.awayTeamId;

    return null;
  }

  // Validate and swap downstream teams when a winner changes on a score edit
  private async validateAndSwapDownstream(
    fixture: any,
    oldWinnerId: string,
    newWinnerId: string,
  ) {
    if (!fixture.nextFixtureId) return;

    const tournament = await this.db.tournament.findUnique({
      where: { id: fixture.tournament_id },
      select: { type: true, twoLegsKnockout: true, thirdPlaceMatch: true },
    });

    const nextFixture = await this.db.fixture.findUnique({
      where: { id: fixture.nextFixtureId },
    });

    if (!nextFixture) return;

    if (
      nextFixture.status === 'LIVE' ||
      nextFixture.status === 'NORMAL_TIME_ENDED' ||
      nextFixture.status === 'EXTRATIME' ||
      nextFixture.status === 'COMPLETED'
    ) {
      throw new BadRequestException(
        'Cannot change the result of this match because the next round match has already been played. Reset the downstream match first.',
      );
    }

    if (
      tournament?.twoLegsKnockout &&
      nextFixture.roundName?.includes('Leg 1')
    ) {
      const leg2OfNext = await this.db.fixture.findFirst({
        where: {
          tournament_id: fixture.tournament_id,
          round: nextFixture.round,
          matchNumber: nextFixture.matchNumber + 1,
          ...(fixture.stage ? { stage: fixture.stage } : {}),
        },
      });

      if (
        leg2OfNext &&
        (leg2OfNext.status === 'LIVE' ||
          leg2OfNext.status === 'NORMAL_TIME_ENDED' ||
          leg2OfNext.status === 'EXTRATIME' ||
          leg2OfNext.status === 'COMPLETED')
      ) {
        throw new BadRequestException(
          'Cannot change the result of this match because the next round Leg 2 has already been played. Reset the downstream match first.',
        );
      }
    }

    let isHomeFeed = fixture.matchNumber % 2 !== 0;
    if (tournament?.twoLegsKnockout) {
      const slotIndex = Math.ceil(fixture.matchNumber / 2);
      isHomeFeed = slotIndex % 2 !== 0;
    }

    const oldLoserId =
      oldWinnerId === fixture.homeTeamId
        ? fixture.awayTeamId
        : fixture.homeTeamId;
    const newLoserId =
      newWinnerId === fixture.homeTeamId
        ? fixture.awayTeamId
        : fixture.homeTeamId;

    await this.db.fixture.update({
      where: { id: nextFixture.id },
      data: {
        ...(isHomeFeed
          ? { homeTeamId: newWinnerId }
          : { awayTeamId: newWinnerId }),
      },
    });

    if (
      tournament?.twoLegsKnockout &&
      nextFixture.roundName?.includes('Leg 1')
    ) {
      const leg2OfNext = await this.db.fixture.findFirst({
        where: {
          tournament_id: fixture.tournament_id,
          round: nextFixture.round,
          matchNumber: nextFixture.matchNumber + 1,
          ...(fixture.stage ? { stage: fixture.stage } : {}),
        },
      });

      if (leg2OfNext) {
        await this.db.fixture.update({
          where: { id: leg2OfNext.id },
          data: {
            ...(isHomeFeed
              ? { awayTeamId: newWinnerId }
              : { homeTeamId: newWinnerId }),
          },
        });
      }
    }

    if (tournament?.thirdPlaceMatch) {
      const thirdPlaceFixture = await this.db.fixture.findFirst({
        where: {
          tournament_id: fixture.tournament_id,
          round: nextFixture.round,
          roundName: 'Third Place Match',
          ...(fixture.stage ? { stage: fixture.stage } : {}),
        },
      });

      if (thirdPlaceFixture) {
        if (
          thirdPlaceFixture.status === 'LIVE' ||
          thirdPlaceFixture.status === 'NORMAL_TIME_ENDED' ||
          thirdPlaceFixture.status === 'EXTRATIME' ||
          thirdPlaceFixture.status === 'COMPLETED'
        ) {
          throw new BadRequestException(
            'Cannot change the result because the 3rd Place Match has already been played.',
          );
        }

        await this.db.fixture.update({
          where: { id: thirdPlaceFixture.id },
          data: {
            ...(isHomeFeed
              ? { homeTeamId: newLoserId }
              : { awayTeamId: newLoserId }),
          },
        });
      }
    }
  }

  // Update Standings (Recalculate for tournament)
  private async updateStandings(tournamentId: string) {
    const tournament = await this.db.tournament.findUnique({
      where: { id: tournamentId },
      select: { id: true, unifiedStandings: true },
    });
    const isUnified = !!tournament?.unifiedStandings;

    const participants = await this.db.participant.findMany({
      where: { tournament_id: tournamentId },
      include: { group: true },
    });
    const fixtures = await this.db.fixture.findMany({
      where: { tournament_id: tournamentId, status: 'COMPLETED' },
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

    for (const f of fixtures) {
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

    const sortedEntries = Array.from(stats.entries()).sort((a, b) => {
      const sa = a[1];
      const sb = b[1];
      if (sb.points !== sa.points) return sb.points - sa.points;
      const gdA = sa.goalsFor - sa.goalsAgainst;
      const gdB = sb.goalsFor - sb.goalsAgainst;
      if (gdB !== gdA) return gdB - gdA;
      if (sb.goalsFor !== sa.goalsFor) return sb.goalsFor - sa.goalsFor;
      if (sb.wins !== sa.wins) return sb.wins - sa.wins;
      return sa.played - sb.played;
    });

    for (let i = 0; i < sortedEntries.length; i++) {
      const [pId, s] = sortedEntries[i];
      const p = participants.find((part) => part.id === pId);
      const groupName = isUnified ? null : (p?.group?.name || null);
      await this.db.standing.upsert({
        where: {
          tournament_id_participant_id: {
            tournament_id: tournamentId,
            participant_id: pId,
          },
        },
        create: {
          tournament_id: tournamentId,
          participant_id: pId,
          group: groupName,
          ...s,
          goalDiff: s.goalsFor - s.goalsAgainst,
          position: isUnified ? i + 1 : undefined,
        },
        update: {
          group: groupName,
          ...s,
          goalDiff: s.goalsFor - s.goalsAgainst,
          position: isUnified ? i + 1 : undefined,
        },
      });
    }
  }

  // Get recent completed fixtures (activity stream)
  async findRecentResults(limit: number = 10) {
    const fixtures = await this.db.fixture.findMany({
      where: { status: 'COMPLETED' },
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
        tournament: {
          select: {
            id: true,
            name: true,
            customName: true,
            sport: true,
            organization: {
              select: { name: true, slug: true, logoUrl: true },
            },
          },
        },
        group: true,
      },
      orderBy: { updated_at: 'desc' },
      take: limit,
    });

    return ResponseUtil.success(fixtures);
  }

  async findUpcoming(limit: number = 10) {
    const fixtures = await this.db.fixture.findMany({
      where: {
        status: 'SCHEDULED',
        startTime: {
          gte: new Date(),
        },
      },
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
        tournament: {
          select: {
            id: true,
            name: true,
            customName: true,
            sport: true,
            logoUrl: true,
            organization: {
              select: { name: true, slug: true, logoUrl: true },
            },
          },
        },
        group: true,
      },
      orderBy: { startTime: 'asc' },
      take: limit,
    });

    return ResponseUtil.success(fixtures);
  }

  async findByDate(date: string) {
    const startOfDay = new Date(`${date}T00:00:00.000Z`);
    const endOfDay = new Date(`${date}T23:59:59.999Z`);

    const fixtures = await this.db.fixture.findMany({
      where: {
        startTime: {
          gte: startOfDay,
          lte: endOfDay,
        },
      },
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
        tournament: {
          select: {
            id: true,
            name: true,
            customName: true,
            sport: true,
            logoUrl: true,
            organization: {
              select: { name: true, slug: true, logoUrl: true },
            },
          },
        },
        group: true,
      },
      orderBy: { startTime: 'asc' },
    });

    return ResponseUtil.success(fixtures);
  }

  async findFixtureDates(tournamentIds?: string[]) {
    const whereClause: any = {};
    if (tournamentIds && tournamentIds.length > 0) {
      whereClause.tournament_id = { in: tournamentIds };
    }

    const fixtures = await this.db.fixture.findMany({
      where: whereClause,
      select: {
        startTime: true,
      },
      orderBy: { startTime: 'asc' },
    });

    const dates = new Set<string>();
    for (const fixture of fixtures) {
      if (fixture.startTime) {
        const d = new Date(fixture.startTime);
        const year = d.getUTCFullYear();
        const month = String(d.getUTCMonth() + 1).padStart(2, '0');
        const day = String(d.getUTCDate()).padStart(2, '0');
        dates.add(`${year}-${month}-${day}`);
      }
    }

    return ResponseUtil.success(Array.from(dates));
  }

  // Delete a single fixture
  async delete(fixtureId: string, userId: string) {
    const fixture = await this.db.fixture.findUnique({
      where: { id: fixtureId },
      include: { tournament: true },
    });

    if (!fixture) {
      throw new NotFoundException('Fixture not found');
    }

    // Role-based access control
    if (fixture.tournament.organization_id) {
      await this.organizationsService.validateMemberRole(
        fixture.tournament.organization_id,
        userId,
        ['OWNER', 'ADMIN'],
      );
    }

    // Delete the fixture
    await this.db.fixture.delete({
      where: { id: fixtureId },
    });

    // If it was a completed fixture, update standings for RR/League
    if (
      fixture.status === 'COMPLETED' &&
      (fixture.tournament.type === 'LEAGUE' ||
        fixture.tournament.type === 'ROUND_ROBIN' ||
        fixture.tournament.type === 'GROUP' ||
        fixture.tournament.type === 'HYBRID')
    ) {
      await this.updateStandings(fixture.tournament_id);
    }

    return ResponseUtil.success({
      message: 'Fixture deleted successfully',
    });
  }

  // Delete all fixtures for a tournament
  async deleteAllTournamentFixtures(
    tournamentId: string,
    userId: string,
    stage?: string,
  ) {
    const tournament = await this.db.tournament.findFirst({
      where: { OR: [{ id: tournamentId }, { customName: tournamentId }] },
    });

    if (!tournament) {
      throw new NotFoundException('Tournament not found');
    }

    // Role-based access control
    if (tournament.organization_id) {
      await this.organizationsService.validateMemberRole(
        tournament.organization_id,
        userId,
        ['OWNER', 'ADMIN'],
      );
    }

    // Delete all fixtures (cascades to MatchEvents)
    await this.db.fixture.deleteMany({
      where: {
        tournament_id: tournament.id,
        ...(stage ? { stage: stage as any } : {}),
      },
    });

    // Reset standings only if clearing ALL or GROUP_STAGE
    if (!stage || stage === 'GROUP_STAGE') {
      await this.db.standing.deleteMany({
        where: { tournament_id: tournament.id },
      });
    }

    return ResponseUtil.success({
      message: 'All fixtures cleared successfully',
    });
  }

  async updateKnockoutPairings(
    tournamentId: string,
    userId: string,
    dto: UpdateKnockoutPairingsDto,
  ) {
    const tournament = await this.db.tournament.findFirst({
      where: { OR: [{ id: tournamentId }, { customName: tournamentId }] },
      include: {
        organization: {
          include: {
            members: {
              where: { userId },
            },
          },
        },
      },
    });

    if (!tournament) {
      throw new NotFoundException('Tournament not found');
    }

    const membership = tournament.organization?.members[0];
    const isAuthorized =
      membership &&
      (membership.role === 'OWNER' || membership.role === 'ADMIN');

    if (!isAuthorized) {
      throw new ForbiddenException(
        'You are not authorized to update knockout pairings for this tournament',
      );
    }

    for (const pair of dto.pairings) {
      const fixture = await this.db.fixture.findUnique({
        where: { id: pair.fixtureId },
      });
      if (!fixture || fixture.tournament_id !== tournament.id) continue;

      await this.db.fixture.update({
        where: { id: fixture.id },
        data: {
          ...(pair.homeTeamId !== undefined && {
            homeTeamId: pair.homeTeamId,
            homeTeamPlaceholder: null,
          }),
          ...(pair.awayTeamId !== undefined && {
            awayTeamId: pair.awayTeamId,
            awayTeamPlaceholder: null,
          }),
        },
      });

      // Mirror to Leg 2 if two-legged
      if (tournament.twoLegsKnockout && fixture.roundName?.includes('Leg 1')) {
        const leg2 = await this.db.fixture.findFirst({
          where: {
            tournament_id: tournament.id,
            round: fixture.round,
            matchNumber: fixture.matchNumber + 1,
            roundName: { contains: 'Leg 2' },
          },
        });
        if (leg2) {
          await this.db.fixture.update({
            where: { id: leg2.id },
            data: {
              ...(pair.awayTeamId !== undefined && {
                homeTeamId: pair.awayTeamId,
                homeTeamPlaceholder: null,
              }),
              ...(pair.homeTeamId !== undefined && {
                awayTeamId: pair.homeTeamId,
                awayTeamPlaceholder: null,
              }),
            },
          });
        }
      }
    }

    return ResponseUtil.success({ message: 'Knockout pairings updated successfully' });
  }

}
