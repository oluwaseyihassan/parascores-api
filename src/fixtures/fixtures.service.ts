import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import { UpdateFixtureDto } from './dto/update-fixture.dto';
import { AddMatchEventDto } from './dto/add-match-event.dto';
import { ResponseUtil } from 'src/utils/api-response';

@Injectable()
export class FixturesService {
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
    const fixture = await this.db.fixture.findUnique({
      where: { id: fixtureId },
    });

    if (!fixture) {
      throw new NotFoundException('Fixture not found');
    }

    const updatedFixture = await this.db.fixture.update({
      where: { id: fixtureId },
      data: {
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.homeScore !== undefined && { homeScore: dto.homeScore }),
        ...(dto.awayScore !== undefined && { awayScore: dto.awayScore }),
        ...(dto.startTime !== undefined && { startTime: new Date(dto.startTime) }),
        ...(dto.homeTeamId !== undefined && { homeTeamId: dto.homeTeamId }),
        ...(dto.awayTeamId !== undefined && { awayTeamId: dto.awayTeamId }),
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
        tournament: { select: { id: true, type: true } },
      },
    });

    // Handle Match Progression and Standings
    if (updatedFixture.status === 'COMPLETED') {
      const tournament = updatedFixture.tournament;
      
      if (tournament.type === 'KNOCKOUT') {
        await this.handleKnockoutProgression(updatedFixture);
      } else if (tournament.type === 'GROUP' || tournament.type === 'ROUND_ROBIN' || tournament.type === 'LEAGUE') {
         await this.updateStandings(updatedFixture.tournament_id);
      }
    }

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
      // Tie - check penalties
      if (homePen > awayPen) {
        winnerId = fixture.homeTeamId;
      } else if (awayPen > homePen) {
        winnerId = fixture.awayTeamId;
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

    return ResponseUtil.success({ deleted: true });
  }
}
