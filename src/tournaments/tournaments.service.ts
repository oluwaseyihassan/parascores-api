import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import { CreateTournamentDto } from './dto/create-tournament.dto';
import { UpdateTournamentDto } from './dto/update-tournament.dto';

import { Visibility, FixtureStage } from 'prisma/generated/client';
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
    const tournament = await this.db.tournament.findUnique({ where: { id } });
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
      where: { id },
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
            select: { id: true, name: true, email: true },
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

    return ResponseUtil.paginated(tournaments, page, limit, total);
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

    const { participants, fixtures, standings, sponsors, socials, ...tournamentData } = tournament;
    
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
      socials
    });
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
    const tournament = await this.db.tournament.findUnique({ where: { id } });
    if (!tournament) throw new NotFoundException('Tournament not found');
    if (tournament.organizer_id !== userId)
      throw new ForbiddenException('Not authorized');

    await this.db.tournament.delete({ where: { id } });

    return ResponseUtil.success({ message: 'Tournament deleted successfully' });
  }
}
