import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import { UpdateFixtureDto } from './dto/update-fixture.dto';
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
    // Note: Already-completed matches can be freely edited (scores + penalties in separate steps)
    // The progression logic handles winner detection and won't progress without a clear winner
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

    // Track whether this match was already completed (for detecting score edits vs first-time completion)
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
      },
    });

    // Handle Match Progression and Standings
    // Run recalculation if the fixture is transitioning to COMPLETED, or if it was ALREADY COMPLETED and got updated
    if (updatedFixture.status === 'COMPLETED') {
      const tournament = updatedFixture.tournament;

      const isKnockoutStage =
        tournament.type === 'KNOCKOUT' ||
        (tournament.type === 'HYBRID' && updatedFixture.stage === 'KNOCKOUT');

      if (isKnockoutStage) {
        // Check if this is a two-legged knockout
        const tournamentSettings = await this.db.tournament.findUnique({
          where: { id: updatedFixture.tournament_id },
          select: { twoLegsKnockout: true },
        });

        const isTwoLegged = tournamentSettings?.twoLegsKnockout;
        const isLeg1 = isTwoLegged && updatedFixture.matchNumber % 2 !== 0;

        if (isLeg1 && wasAlreadyCompleted) {
          // Leg 1 was edited — check if Leg 2 is already completed
          // If so, re-evaluate the aggregate winner through Leg 2's perspective
          const leg2 = await this.db.fixture.findFirst({
            where: {
              tournament_id: updatedFixture.tournament_id,
              round: updatedFixture.round,
              matchNumber: updatedFixture.matchNumber + 1,
              ...(updatedFixture.stage ? { stage: updatedFixture.stage } : {}),
            },
          });

          if (leg2 && leg2.status === 'COMPLETED') {
            // Compute old aggregate winner (using OLD Leg 1 scores + current Leg 2 scores)
            const oldAggHome = (leg2.homeScore ?? 0) + (fixture.awayScore ?? 0);
            const oldAggAway = (leg2.awayScore ?? 0) + (fixture.homeScore ?? 0);
            let oldWinnerId: string | null = null;
            if (oldAggHome > oldAggAway) oldWinnerId = leg2.homeTeamId;
            else if (oldAggAway > oldAggHome) oldWinnerId = leg2.awayTeamId;
            else {
              // Check penalties on Leg 2
              const oldHomePen = leg2.homePenaltyScore ?? 0;
              const oldAwayPen = leg2.awayPenaltyScore ?? 0;
              if (oldHomePen > oldAwayPen) oldWinnerId = leg2.homeTeamId;
              else if (oldAwayPen > oldHomePen) oldWinnerId = leg2.awayTeamId;
            }

            // Compute new aggregate winner (using NEW Leg 1 scores + current Leg 2 scores)
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
              // Winner changed — validate and swap downstream (use Leg 2 as the progression fixture)
              await this.validateAndSwapDownstream(leg2, oldWinnerId, newWinnerId);
            } else if (newWinnerId && (!oldWinnerId || oldWinnerId === newWinnerId)) {
              // Same winner or first-time — re-run normal progression through Leg 2
              await this.handleKnockoutProgression(leg2);
            }
          }
          // If Leg 2 is not completed yet, nothing to do for Leg 1 edits
        } else if (!isLeg1) {
          // Normal case: Leg 2 completed (or single-leg knockout)
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
        // else: Leg 1 first-time completion — nothing to progress yet
      } else if (
        tournament.type === 'GROUP' ||
        tournament.type === 'ROUND_ROBIN' ||
        tournament.type === 'LEAGUE' ||
        tournament.type === 'HYBRID'
      ) {
        await this.updateStandings(updatedFixture.tournament_id);
      }
    }

    // Emit live update
    this.liveFixturesSubject.next({
      type: 'fixture_updated',
      data: updatedFixture,
    });

    return ResponseUtil.success(updatedFixture);
  }

  // Knockout Progression: Move winner to next round
  private async handleKnockoutProgression(fixture: any) {
    if (!fixture.nextFixtureId) return;

    // Check tournament settings for two-legged knockout
    const tournament = await this.db.tournament.findUnique({
      where: { id: fixture.tournament_id },
      select: { type: true, twoLegsKnockout: true },
    });

    let homeScore = fixture.homeScore ?? 0;
    let awayScore = fixture.awayScore ?? 0;
    const homePen = fixture.homePenaltyScore ?? 0;
    const awayPen = fixture.awayPenaltyScore ?? 0;

    // Handle two-legged knockout progression
    if (
      tournament?.twoLegsKnockout &&
      (tournament.type === 'KNOCKOUT' || tournament.type === 'HYBRID')
    ) {
      // If this is Leg 1 (odd match number), DO NOT progress yet.
      if (fixture.matchNumber % 2 !== 0) {
        return;
      }

      // If this is Leg 2 (even match number), calculate aggregate score.
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
        // Leg 1 home team is Leg 2 away team (and vice versa)
        // From Leg 2 perspective:
        // Aggregate Home Score = Leg 2 Home Score + Leg 1 Away Score
        // Aggregate Away Score = Leg 2 Away Score + Leg 1 Home Score
        homeScore += leg1.awayScore ?? 0;
        awayScore += leg1.homeScore ?? 0;
      }
    }

    let winnerId: string | null = null;

    // Determine winner
    if (homeScore > awayScore) {
      winnerId = fixture.homeTeamId;
    } else if (awayScore > homeScore) {
      winnerId = fixture.awayTeamId;
    } else {
      // Tie - check penalties (only if they're not equal)
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

      // Determine if this match feeds into Home or Away slot of next match
      // For two-legged, the two legs feed into ONE slot in the next round.
      // E.g., Matches 1 & 2 feed into Match 1 (Home). Matches 3 & 4 feed into Match 1 (Away).
      // If twoLegsKnockout: Match 2 -> feeds Home of Match 1. Match 4 -> feeds Away of Match 1.
      // So slot Index = Math.ceil(matchNumber / 2). If slot Index is odd -> Home, even -> Away.
      let isHomeFeed = fixture.matchNumber % 2 !== 0;

      if (tournament?.twoLegsKnockout) {
        const slotIndex = Math.ceil(fixture.matchNumber / 2);
        isHomeFeed = slotIndex % 2 !== 0; // If slotIndex is odd, feeds into Home.
      }

      await this.db.fixture.update({
        where: { id: fixture.nextFixtureId },
        data: {
          ...(isHomeFeed ? { homeTeamId: winnerId } : { awayTeamId: winnerId }),
        },
      });

      // For two-legged knockouts, also assign the winner to the Leg 2 fixture of the next round
      // Leg 2 has home/away swapped relative to Leg 1
      // Only do this if the next fixture is actually a Leg 1 (not the Final, which is single-leg)
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
            // In Leg 2, home/away are swapped: Leg 1 home -> Leg 2 away, Leg 1 away -> Leg 2 home
            await this.db.fixture.update({
              where: { id: leg2OfNext.id },
              data: {
                ...(isHomeFeed ? { awayTeamId: winnerId } : { homeTeamId: winnerId }),
              },
            });
          }
        }
      }

      // Handle 3rd place match: advance the loser to the third place fixture
      if (loserId) {
        const fullTournament = await this.db.tournament.findUnique({
          where: { id: fixture.tournament_id },
          select: { thirdPlaceMatch: true },
        });

        if (fullTournament?.thirdPlaceMatch) {
          // Find the 3rd place match fixture in the same round as the next fixture (final round)
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
      // Leg 1 doesn't determine a winner on its own
      if (fixture.matchNumber % 2 !== 0) return null;

      // Leg 2: compute aggregate
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

    // Tied: check penalties
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

    // Fetch the downstream fixture (Leg 1 of next round, or the Final)
    const nextFixture = await this.db.fixture.findUnique({
      where: { id: fixture.nextFixtureId },
    });

    if (!nextFixture) return;

    // BLOCK if downstream match has been played
    if (nextFixture.status === 'LIVE' || nextFixture.status === 'COMPLETED') {
      throw new BadRequestException(
        'Cannot change the result of this match because the next round match has already been played. Reset the downstream match first.',
      );
    }

    // If two-legged, also check the Leg 2 of the next round
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

    // Safe to swap — determine feed direction
    let isHomeFeed = fixture.matchNumber % 2 !== 0;
    if (tournament?.twoLegsKnockout) {
      const slotIndex = Math.ceil(fixture.matchNumber / 2);
      isHomeFeed = slotIndex % 2 !== 0;
    }

    const oldLoserId = oldWinnerId === fixture.homeTeamId ? fixture.awayTeamId : fixture.homeTeamId;
    const newLoserId = newWinnerId === fixture.homeTeamId ? fixture.awayTeamId : fixture.homeTeamId;

    // Swap winner in next fixture (Leg 1)
    await this.db.fixture.update({
      where: { id: nextFixture.id },
      data: {
        ...(isHomeFeed ? { homeTeamId: newWinnerId } : { awayTeamId: newWinnerId }),
      },
    });

    // Swap winner in Leg 2 of next round (if applicable)
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

    // Swap loser in 3rd place match (if applicable)
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
        // Block if 3rd place match has been played
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
    // 1. Fetch all participants and completed fixtures
    const participants = await this.db.participant.findMany({
      where: { tournament_id: tournamentId },
    });
    const fixtures = await this.db.fixture.findMany({
      where: { tournament_id: tournamentId, status: 'COMPLETED' },
    });

    // 2. Initialize stats map
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

    // 3. Calculate stats
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

    // 4. Update DB
    for (const [pId, s] of stats.entries()) {
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
          ...s,
          goalDiff: s.goalsFor - s.goalsAgainst,
        },
        update: {
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
      },
      orderBy: { updated_at: 'desc' },
      take: limit,
    });

    return ResponseUtil.success(fixtures);
  }
}
