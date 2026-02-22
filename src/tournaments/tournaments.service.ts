import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import { CreateTournamentDto } from './dto/create-tournament.dto';

import { Visibility, FixtureStage } from 'prisma/generated/client';
import { ResponseUtil } from 'src/utils/api-response';

@Injectable()
export class TournamentsService {
  constructor(private readonly db: DatabaseService) { }

  async create(userId: string, dto: CreateTournamentDto) {
    const { start_date, end_date, ...rest } = dto;

    // Check customName uniqueness
    if (dto.customName) {
      const existing = await this.db.tournament.findUnique({ where: { customName: dto.customName } });
      if (existing) {
        throw new BadRequestException(`The custom name '${dto.customName}' is already taken`);
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
        OR: [
          { id: identifier },
          { customName: identifier },
        ],
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

  // Check if a custom name is available
  async checkCustomName(customName: string) {
    const existing = await this.db.tournament.findUnique({
      where: { customName },
    });
    return ResponseUtil.success({ customName, available: !existing });
  }



  // Get tournament standings
  async getStandings(tournamentId: string) {
    const tournament = await this.db.tournament.findFirst({
      where: { OR: [{ id: tournamentId }, { customName: tournamentId }] },
    });

    if (!tournament) {
      throw new NotFoundException('Tournament not found');
    }

    const standings = await this.db.standing.findMany({
      where: { tournament_id: tournament.id },
      include: {
        participant: {
          include: {
            team: true,
            user: true,
          }
        }
      },
      orderBy: [
        { group: 'asc' },
        { points: 'desc' },
        { goalDiff: 'desc' },
        { goalsFor: 'desc' },
        { played: 'asc' },
      ]
    });

    return ResponseUtil.success({
      standings: standings.map(s => ({
        ...s,
        participantName: s.participant?.team?.name || s.participant?.customName || s.participant?.user?.name || 'Unknown',
      }))
    });
  }






}


