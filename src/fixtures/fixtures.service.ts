import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import { UpdateFixtureDto } from './dto/update-fixture.dto';
import { AddMatchEventDto } from './dto/add-match-event.dto';
import { ResponseUtil } from 'src/utils/api-response';
import { Subject } from 'rxjs';

@Injectable()
export class FixturesService {
  public liveFixturesSubject = new Subject<{ type: string; data: any }>();

  constructor(private readonly db: DatabaseService) {}

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
                user: true
              }
            }
          }
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
  async getTournamentFixtures(tournamentId: string, round?: number, stage?: any) {
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
  async update(fixtureId: string, dto: UpdateFixtureDto) {
    console.log(dto);
    const fixture = await this.db.fixture.findUnique({
      where: { id: fixtureId },
    });

    if (!fixture) {
      throw new NotFoundException('Fixture not found');
    }

    // Validate penalty scores for knockout matches being completed
    if (dto.status === 'COMPLETED') {
      const homeScore = dto.homeScore ?? fixture.homeScore ?? 0;
      const awayScore = dto.awayScore ?? fixture.awayScore ?? 0;
      const homePen = dto.homePenaltyScore ?? fixture.homePenaltyScore ?? 0;
      const awayPen = dto.awayPenaltyScore ?? fixture.awayPenaltyScore ?? 0;

      // If scores are tied, penalty scores must not be equal
      if (homeScore === awayScore && homePen === awayPen) {
        // Check if this is a knockout tournament
        const tournament = await this.db.tournament.findUnique({
          where: { id: fixture.tournament_id },
          select: { type: true },
        });
        
        if (tournament?.type === 'KNOCKOUT') {
          throw new BadRequestException('Penalty scores cannot be equal when regular scores are tied in a knockout match');
        }
      }
    }

    const updatedFixture = await this.db.fixture.update({
      where: { id: fixtureId },
      data: {
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.homeScore !== undefined && { homeScore: dto.homeScore }),
        ...(dto.awayScore !== undefined && { awayScore: dto.awayScore }),
        ...(dto.startTime !== undefined && { startTime: new Date(dto.startTime) }),
        ...(dto.homePenaltyScore !== undefined && { homePenaltyScore: dto.homePenaltyScore }),
        ...(dto.awayPenaltyScore !== undefined && { awayPenaltyScore: dto.awayPenaltyScore }),
        ...(dto.homeTeamId !== undefined && { homeTeamId: dto.homeTeamId }),
        ...(dto.awayTeamId !== undefined && { awayTeamId: dto.awayTeamId }),
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
    if (updatedFixture.status === 'COMPLETED') {
      const tournament = updatedFixture.tournament;
      
      if (tournament.type === 'KNOCKOUT') {
        await this.handleKnockoutProgression(updatedFixture);
      } else if (tournament.type === 'GROUP' || tournament.type === 'ROUND_ROBIN' || tournament.type === 'LEAGUE' || tournament.type === 'HYBRID') {
         // For HYBRID, handle knockout progression if this is a knockout-stage fixture
         if (tournament.type === 'HYBRID' && updatedFixture.stage === 'KNOCKOUT') {
           await this.handleKnockoutProgression(updatedFixture);
         } else {
           await this.updateStandings(updatedFixture.tournament_id);
         }
      }
    }

    // Emit live update
    this.liveFixturesSubject.next({ type: 'fixture_updated', data: updatedFixture });

    return ResponseUtil.success(updatedFixture);
  }

  // Knockout Progression: Move winner to next round
  private async handleKnockoutProgression(fixture: any) {
    if (!fixture.nextFixtureId) return;

    const homeScore = fixture.homeScore ?? 0;
    const awayScore = fixture.awayScore ?? 0;
    const homePen = fixture.homePenaltyScore ?? 0;
    const awayPen = fixture.awayPenaltyScore ?? 0;

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
       // Determine if this match feeds into Home or Away slot of next match
       // Match 1 (Odd) -> Home, Match 2 (Even) -> Away
       const isHomeFeed = fixture.matchNumber % 2 !== 0;

       await this.db.fixture.update({
         where: { id: fixture.nextFixtureId },
         data: {
           ...(isHomeFeed ? { homeTeamId: winnerId } : { awayTeamId: winnerId }),
         },
       });
    }
  }

  // Update Standings (Recalculate for tournament)
  private async updateStandings(tournamentId: string) {
    // 1. Fetch all participants and completed fixtures
    const participants = await this.db.participant.findMany({ where: { tournament_id: tournamentId } });
    const fixtures = await this.db.fixture.findMany({ 
      where: { tournament_id: tournamentId, status: 'COMPLETED' } 
    });

    // 2. Initialize stats map
    const stats = new Map<string, {
      played: number; wins: number; draws: number; losses: number;
      goalsFor: number; goalsAgainst: number; points: number;
    }>();

    for (const p of participants) {
      stats.set(p.id, { played: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0, points: 0 });
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
            participant_id: pId
          }
        },
        create: {
          tournament_id: tournamentId,
          participant_id: pId,
          ...s,
          goalDiff: s.goalsFor - s.goalsAgainst
        },
        update: {
          ...s,
          goalDiff: s.goalsFor - s.goalsAgainst
        }
      });
    }
  }

  // Add a match event (goal, card, substitution, etc.)
  async addEvent(fixtureId: string, dto: AddMatchEventDto) {
    const fixture = await this.db.fixture.findUnique({
      where: { id: fixtureId },
    });

    if (!fixture) {
      throw new NotFoundException('Fixture not found');
    }

    const event = await this.db.matchEvent.create({
      data: {
        fixture_id: fixtureId,
        type: dto.type,
        minute: dto.minute,
        participant_id: dto.participantId,
        playerId: dto.playerId,
        relatedPlayerId: dto.relatedPlayerId,
        description: dto.description,
        metadata: dto.metadata,
      },
      include: {
        player: true,
        relatedPlayer: true,
        participant: {
          include: {
            team: { select: { id: true, name: true } },
          },
        },
      },
    });

    // Emit live update
    this.liveFixturesSubject.next({ type: 'event_added', data: event });

    return ResponseUtil.success(event);
  }

  // Get all events for a fixture
  async getEvents(fixtureId: string) {
    const fixture = await this.db.fixture.findUnique({
      where: { id: fixtureId },
    });

    if (!fixture) {
      throw new NotFoundException('Fixture not found');
    }

    const events = await this.db.matchEvent.findMany({
      where: { fixture_id: fixtureId },
      include: {
        player: true,
        relatedPlayer: true,
        participant: {
          include: {
            team: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { minute: 'asc' },
    });

    return ResponseUtil.success(events);
  }

  // Delete a match event
  async deleteEvent(eventId: string) {
    const event = await this.db.matchEvent.findUnique({
      where: { id: eventId },
    });

    if (!event) {
      throw new NotFoundException('Event not found');
    }

    await this.db.matchEvent.delete({
      where: { id: eventId },
    });

    // Emit live update
    this.liveFixturesSubject.next({ type: 'event_deleted', data: { eventId, fixtureId: event.fixture_id } });

    return ResponseUtil.success({ deleted: true });
  }

  // Update a match event
  async updateEvent(eventId: string, dto: any) {
    const event = await this.db.matchEvent.findUnique({
      where: { id: eventId },
    });

    if (!event) {
      throw new NotFoundException('Event not found');
    }

    const updatedEvent = await this.db.matchEvent.update({
      where: { id: eventId },
      data: {
        ...(dto.type !== undefined && { type: dto.type }),
        ...(dto.minute !== undefined && { minute: dto.minute }),
        ...(dto.participantId !== undefined && { participant_id: dto.participantId }),
        ...(dto.playerId !== undefined && { playerId: dto.playerId }),
        ...(dto.relatedPlayerId !== undefined && { relatedPlayerId: dto.relatedPlayerId }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.metadata !== undefined && { metadata: dto.metadata }),
      },
      include: {
        player: true,
        relatedPlayer: true,
        participant: {
          include: {
            team: { select: { id: true, name: true } },
            user: { select: { id: true, name: true } }
          },
        },
      },
    });

    // Emit live update
    this.liveFixturesSubject.next({ type: 'event_updated', data: updatedEvent });

    return ResponseUtil.success(updatedEvent);
  }
}
