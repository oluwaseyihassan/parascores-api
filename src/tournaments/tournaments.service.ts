import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import { CreateTournamentDto } from './dto/create-tournament.dto';
import { UpdateTournamentDto } from './dto/update-tournament.dto';

import { Visibility, FixtureStage, MatchEventType } from 'prisma/generated/client';
import { ResponseUtil } from 'src/utils/api-response';

@Injectable()
export class TournamentsService {
  constructor(private readonly db: DatabaseService) {}

  async create(userId: string, dto: CreateTournamentDto) {
    const { start_date, end_date, ...rest } = dto;

    // Check customName uniqueness
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
        organizer_id: userId,
      },
    });
    return ResponseUtil.success(tournament);
  }

  async update(id: string, userId: string, dto: UpdateTournamentDto) {
    const tournament = await this.db.tournament.findFirst({
      where: { OR: [{ id }, { customName: id }] },
    });
    if (!tournament) throw new NotFoundException('Tournament not found');
    if (tournament.organizer_id !== userId)
      throw new ForbiddenException('Not authorized');

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

  async findAllPublic(page: number = 1, limit: number = 10) {
    const skip = (page - 1) * limit;

    const [tournaments, total] = await Promise.all([
      this.db.tournament.findMany({
        where: {
          visibility: Visibility.PUBLIC,
        },
        include: {
          organizer: {
            select: { id: true, name: true, email: true, isVerified: true, organization_name: true, organization_logo: true, organization_color: true },
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
        where: {
          visibility: Visibility.PUBLIC,
        },
      }),
    ]);

    return ResponseUtil.paginated(tournaments, page, limit, total);
  }

  async findAllMine(userId: string, page: number = 1, limit: number = 10) {
    const skip = (page - 1) * limit;

    const [tournaments, total] = await Promise.all([
      this.db.tournament.findMany({
        where: {
          organizer_id: userId,
        },
        include: {
          _count: {
            select: { participants: true },
          },
        },
        skip,
        take: limit,
        orderBy: { created_at: 'desc' },
      }),
      this.db.tournament.count({
        where: {
          organizer_id: userId,
        },
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
        organizer: {
          select: { name: true, isVerified: true, organization_name: true, organization_logo: true, organization_color: true },
        },
        participants: {
          include: { players: true }
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
            matchEvents: {
              where: {
                type: { in: ['YELLOW_CARD', 'RED_CARD'] }
              }
            }
          },
          orderBy: { matchNumber: 'asc' }
        },
        standings: {
          include: {
            participant: {
              include: { team: true, user: true }
            }
          },
          orderBy: [
            { group: 'asc' },
            { points: 'desc' },
            { goalDiff: 'desc' },
            { goalsFor: 'desc' },
            { played: 'asc' },
          ],
        }
      },
    });

    if (!tournament) {
      throw new NotFoundException('Tournament not found');
    }

    const { participants, fixtures, standings, sponsors, socials, venues, ...tournamentData } = tournament;
    
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
      venues
    });
  }

  // Get top players stats
  async getPlayerStats(tournamentId: string) {
    const tournament = await this.db.tournament.findFirst({
      where: { OR: [{ id: tournamentId }, { customName: tournamentId }] },
      select: { id: true, participantType: true }
    });
    
    if (!tournament) throw new NotFoundException('Tournament not found');

    if (tournament.participantType === 'INDIVIDUAL') {
      return ResponseUtil.success({ topScorers: [], topAssists: [] });
    }

    const events = await this.db.matchEvent.findMany({
      where: {
        fixture: { tournament_id: tournament.id },
        type: { in: [MatchEventType.GOAL, MatchEventType.PENALTY, MatchEventType.ASSIST] }
      },
      include: {
        player: { include: { participant: { include: { team: true, user: true } } } },
        relatedPlayer: { include: { participant: { include: { team: true, user: true } } } },
      }
    });

    const goalsMap = new Map<string, any>();
    const assistsMap = new Map<string, any>();

    for (const event of events) {
      if (event.type === MatchEventType.GOAL || event.type === MatchEventType.PENALTY) {
        if (event.playerId && event.player) {
          if (!goalsMap.has(event.playerId)) {
            const participantName = event.player.participant?.team?.name || event.player.participant?.customName || event.player.participant?.user?.name || 'Unknown';
            const participantLogo = event.player.participant?.logoUrl || (event.player.participant?.team as any)?.logoUrl || null;
            goalsMap.set(event.playerId, {
              player: { id: event.player.id, name: event.player.name, number: event.player.number },
              teamName: participantName,
              teamLogoUrl: participantLogo,
              count: 0
            });
          }
          goalsMap.get(event.playerId).count += 1;
        }

        if (event.relatedPlayerId && event.relatedPlayer) {
          if (!assistsMap.has(event.relatedPlayerId)) {
            const participantName = event.relatedPlayer.participant?.team?.name || event.relatedPlayer.participant?.customName || event.relatedPlayer.participant?.user?.name || 'Unknown';
            const participantLogo = event.relatedPlayer.participant?.logoUrl || (event.relatedPlayer.participant?.team as any)?.logoUrl || null;
            assistsMap.set(event.relatedPlayerId, {
              player: { id: event.relatedPlayer.id, name: event.relatedPlayer.name, number: event.relatedPlayer.number },
              teamName: participantName,
              teamLogoUrl: participantLogo,
              count: 0
            });
          }
          assistsMap.get(event.relatedPlayerId).count += 1;
        }
      } else if (event.type === MatchEventType.ASSIST) {
        if (event.playerId && event.player) {
          if (!assistsMap.has(event.playerId)) {
            const participantName = event.player.participant?.team?.name || event.player.participant?.customName || event.player.participant?.user?.name || 'Unknown';
            const participantLogo = event.player.participant?.logoUrl || (event.player.participant?.team as any)?.logoUrl || null;
            assistsMap.set(event.playerId, {
              player: { id: event.player.id, name: event.player.name, number: event.player.number },
              teamName: participantName,
              teamLogoUrl: participantLogo,
              count: 0
            });
          }
          assistsMap.get(event.playerId).count += 1;
        }
      }
    }

    const topScorers = Array.from(goalsMap.values()).sort((a, b) => b.count - a.count).slice(0, 10);
    const topAssists = Array.from(assistsMap.values()).sort((a, b) => b.count - a.count).slice(0, 10);

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
    if (tournament.organizer_id !== userId)
      throw new ForbiddenException('Not authorized');

    await this.db.tournament.delete({ where: { id: tournament.id } });

    return ResponseUtil.success({ message: 'Tournament deleted successfully' });
  }
}
