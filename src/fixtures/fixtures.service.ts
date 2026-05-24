import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import { UpdateFixtureDto } from './dto/update-fixture.dto';
import { CreateFixtureDto } from './dto/create-fixture.dto';
import { ResponseUtil } from 'src/utils/api-response';
import { Subject } from 'rxjs';
import { OrganizationsService } from 'src/organizations/organizations.service';

@Injectable()
export class FixturesService {
  public liveFixturesSubject = new Subject<{ type: string; data: any }>();

  constructor(
    private readonly db: DatabaseService,
    private readonly organizationsService: OrganizationsService,
  ) {}

  // Create a single fixture manually
  async create(dto: CreateFixtureDto, userId: string) {
    // Validate tournament exists
    const tournament = await this.db.tournament.findFirst({
      where: { OR: [{ id: dto.tournament_id }, { customName: dto.tournament_id }] },
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
      membership && (membership.role === 'OWNER' || membership.role === 'ADMIN');

    if (!isAuthorized) {
      throw new ForbiddenException(
        'You are not authorized to create fixtures for this tournament',
      );
    }

    // Validate that home and away are different
    if (dto.homeTeamId === dto.awayTeamId) {
      throw new BadRequestException('Home and Away teams must be different');
    }

    // Check for duplicates and matchday limits
    const existingFixturesInRound = await this.db.fixture.findMany({
      where: {
        tournament_id: tournament.id,
        round: dto.round,
        ...(dto.groupId ? { groupId: dto.groupId } : {}),
        ...(dto.stage ? { stage: dto.stage } : {}),
      },
      select: { homeTeamId: true, awayTeamId: true },
    });

    // 1. Duplicate check (Teams already playing in this round)
    const teamsInRound = new Set<string>();
    for (const f of existingFixturesInRound) {
      if (f.homeTeamId) teamsInRound.add(f.homeTeamId);
      if (f.awayTeamId) teamsInRound.add(f.awayTeamId);
    }

    if (teamsInRound.has(dto.homeTeamId)) {
      throw new BadRequestException(
        `Home team is already scheduled for a match in this round`,
      );
    }
    if (teamsInRound.has(dto.awayTeamId)) {
      throw new BadRequestException(
        `Away team is already scheduled for a match in this round`,
      );
    }

    // 2. Matchday limit check
    let maxFixtures = 0;
    if (
      tournament.type === 'ROUND_ROBIN' ||
      tournament.type === 'LEAGUE' ||
      tournament.type === 'GROUP' ||
      tournament.type === 'HYBRID'
    ) {
      // Determine relevant participant count
      let participantCount = 0;
      if (dto.groupId) {
        participantCount = await this.db.participant.count({
          where: { groupId: dto.groupId },
        });
      } else if (
        tournament.type === 'ROUND_ROBIN' ||
        tournament.type === 'LEAGUE'
      ) {
        participantCount = await this.db.participant.count({
          where: { tournament_id: tournament.id },
        });
      }

      if (participantCount > 0) {
        maxFixtures = Math.floor(participantCount / 2);
      }
    }

    if (maxFixtures > 0 && existingFixturesInRound.length >= maxFixtures) {
      throw new BadRequestException(
        `This matchday already has the maximum number of matches (${maxFixtures}) for the number of teams participating`,
      );
    }

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

    return ResponseUtil.success(fixture);
  }

  // Get a single fixture by ID
  async findOne(fixtureId: string) {
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
        group: true,
        lineupPlayers: true,
      },
    });

    if (!fixture) {
      throw new NotFoundException('Fixture not found');
    }

    return ResponseUtil.success(fixture);
  }

  // Get all fixtures for a specific tournament
  async getTournamentFixtures(
    tournamentId: string,
    round?: number,
    stage?: any,
  ) {
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
      },
      orderBy: [{ round: 'asc' }, { matchNumber: 'asc' }],
    });

    return ResponseUtil.success(fixtures);
  }

  // Get all live fixtures
  async findLive() {
    const fixtures = await this.db.fixture.findMany({
      where: { status: 'LIVE' },
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

    return ResponseUtil.success(fixtures);
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

      const isKnockoutStage =
        tournament?.type === 'KNOCKOUT' ||
        (tournament?.type === 'HYBRID' && fixture.stage === 'KNOCKOUT');

      if (isKnockoutStage) {
        let isTie = homeScore === awayScore;

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

    // Validate Leg 1 completion before starting Leg 2
    if (dto.status === 'LIVE' && fixture.status !== 'LIVE') {
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
        ...(dto.startTime !== undefined && {
          startTime: new Date(dto.startTime),
        }),
        ...(dto.homePenaltyScore !== undefined && {
          homePenaltyScore: dto.homePenaltyScore,
        }),
        ...(dto.awayPenaltyScore !== undefined && {
          awayPenaltyScore: dto.awayPenaltyScore,
        }),
        ...(dto.homeTeamId !== undefined && { homeTeamId: dto.homeTeamId }),
        ...(dto.awayTeamId !== undefined && { awayTeamId: dto.awayTeamId }),
        ...(dto.venue !== undefined && { venue: dto.venue }),
        ...(dto.lineupPlayerIds !== undefined && {
          lineupPlayers: {
            set: dto.lineupPlayerIds.map((id) => ({ id })),
          },
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

            const newAggHome = (leg2.homeScore ?? 0) + (updatedFixture.awayScore ?? 0);
            const newAggAway = (leg2.awayScore ?? 0) + (updatedFixture.homeScore ?? 0);
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
              await this.validateAndSwapDownstream(leg2, oldWinnerId, newWinnerId);
            } else if (newWinnerId && (!oldWinnerId || oldWinnerId === newWinnerId)) {
              await this.handleKnockoutProgression(leg2);
            }
          }
        } else if (!isLeg1) {
          const oldWinnerId = wasAlreadyCompleted
            ? await this.determineWinnerFromFixture(fixture, fixture.tournament_id)
            : null;
          const newWinnerId = await this.determineWinnerFromFixture(updatedFixture, updatedFixture.tournament_id);

          if (wasAlreadyCompleted && oldWinnerId && newWinnerId && oldWinnerId !== newWinnerId) {
            await this.validateAndSwapDownstream(updatedFixture, oldWinnerId, newWinnerId);
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

    this.liveFixturesSubject.next({
      type: 'fixture_updated',
      data: updatedFixture,
    });

    return ResponseUtil.success(updatedFixture);
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
      const loserId = winnerId === fixture.homeTeamId ? fixture.awayTeamId : fixture.homeTeamId;

      let isHomeFeed = fixture.matchNumber % 2 !== 0;

      if (tournament?.twoLegsKnockout) {
        const slotIndex = Math.ceil(fixture.matchNumber / 2);
        isHomeFeed = slotIndex % 2 !== 0;
      }

      await this.db.fixture.update({
        where: { id: fixture.nextFixtureId },
        data: {
          ...(isHomeFeed ? { homeTeamId: winnerId } : { awayTeamId: winnerId }),
        },
      });

      if (tournament?.twoLegsKnockout) {
        const nextFixture = await this.db.fixture.findUnique({
          where: { id: fixture.nextFixtureId },
        });

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
                ...(isHomeFeed ? { awayTeamId: winnerId } : { homeTeamId: winnerId }),
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
                  ...(isHomeFeed ? { homeTeamId: loserId } : { awayTeamId: loserId }),
                },
              });
            }
          }
        }
      }
    }
  }

  // Determine the winner of a fixture, accounting for two-legged aggregate scores
  private async determineWinnerFromFixture(fixture: any, tournamentId: string): Promise<string | null> {
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
  private async validateAndSwapDownstream(fixture: any, oldWinnerId: string, newWinnerId: string) {
    if (!fixture.nextFixtureId) return;

    const tournament = await this.db.tournament.findUnique({
      where: { id: fixture.tournament_id },
      select: { type: true, twoLegsKnockout: true, thirdPlaceMatch: true },
    });

    const nextFixture = await this.db.fixture.findUnique({
      where: { id: fixture.nextFixtureId },
    });

    if (!nextFixture) return;

    if (nextFixture.status === 'LIVE' || nextFixture.status === 'COMPLETED') {
      throw new BadRequestException(
        'Cannot change the result of this match because the next round match has already been played. Reset the downstream match first.',
      );
    }

    if (tournament?.twoLegsKnockout && nextFixture.roundName?.includes('Leg 1')) {
      const leg2OfNext = await this.db.fixture.findFirst({
        where: {
          tournament_id: fixture.tournament_id,
          round: nextFixture.round,
          matchNumber: nextFixture.matchNumber + 1,
          ...(fixture.stage ? { stage: fixture.stage } : {}),
        },
      });

      if (leg2OfNext && (leg2OfNext.status === 'LIVE' || leg2OfNext.status === 'COMPLETED')) {
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

    const oldLoserId = oldWinnerId === fixture.homeTeamId ? fixture.awayTeamId : fixture.homeTeamId;
    const newLoserId = newWinnerId === fixture.homeTeamId ? fixture.awayTeamId : fixture.homeTeamId;

    await this.db.fixture.update({
      where: { id: nextFixture.id },
      data: {
        ...(isHomeFeed ? { homeTeamId: newWinnerId } : { awayTeamId: newWinnerId }),
      },
    });

    if (tournament?.twoLegsKnockout && nextFixture.roundName?.includes('Leg 1')) {
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
            ...(isHomeFeed ? { awayTeamId: newWinnerId } : { homeTeamId: newWinnerId }),
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
        if (thirdPlaceFixture.status === 'LIVE' || thirdPlaceFixture.status === 'COMPLETED') {
          throw new BadRequestException(
            'Cannot change the result because the 3rd Place Match has already been played.',
          );
        }

        await this.db.fixture.update({
          where: { id: thirdPlaceFixture.id },
          data: {
            ...(isHomeFeed ? { homeTeamId: newLoserId } : { awayTeamId: newLoserId }),
          },
        });
      }
    }
  }

  // Update Standings (Recalculate for tournament)
  private async updateStandings(tournamentId: string) {
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

    for (const [pId, s] of stats.entries()) {
      const p = participants.find((part) => part.id === pId);
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
          group: p?.group?.name || null,
          ...s,
          goalDiff: s.goalsFor - s.goalsAgainst,
        },
        update: {
          group: p?.group?.name || null,
          ...s,
          goalDiff: s.goalsFor - s.goalsAgainst,
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
  async deleteAllTournamentFixtures(tournamentId: string, userId: string, stage?: string) {
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
        ...(stage ? { stage: stage as any } : {})
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
}
