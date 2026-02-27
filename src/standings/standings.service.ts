import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateStandingDto } from './dto/create-standing.dto';
import { UpdateStandingDto } from './dto/update-standing.dto';
import { DatabaseService } from 'src/database/database.service';
import { ResponseUtil } from 'src/utils/api-response';

@Injectable()
export class StandingsService {
  constructor(private readonly db: DatabaseService) {}

  async create(createStandingDto: CreateStandingDto) {
    const tournament = await this.db.tournament.findUnique({
      where: { id: createStandingDto.tournament_id },
    });
    if (!tournament) throw new NotFoundException('Tournament not found');

    const participant = await this.db.participant.findUnique({
      where: { id: createStandingDto.participant_id },
    });
    if (!participant) throw new NotFoundException('Participant not found');

    const standing = await this.db.standing.create({
      data: {
        ...createStandingDto,
        goalDiff: (createStandingDto.goalsFor || 0) - (createStandingDto.goalsAgainst || 0),
      },
      include: {
        participant: {
          include: {
            team: true,
            user: true,
          }
        },
        tournament: { select: { id: true, name: true } }
      }
    });

    return ResponseUtil.success(standing);
  }

  // Extracted from TournamentsService
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

  async findOne(id: string) {
    const standing = await this.db.standing.findUnique({
      where: { id },
      include: {
        participant: {
          include: {
            team: true,
            user: true,
          }
        },
        tournament: true
      }
    });

    if (!standing) throw new NotFoundException('Standing not found');
    return ResponseUtil.success(standing);
  }

  async update(id: string, updateStandingDto: UpdateStandingDto) {
    const standing = await this.db.standing.findUnique({ where: { id } });
    if (!standing) throw new NotFoundException('Standing not found');

    // recalculate goal difference if goals modify
    const goalsFor = updateStandingDto.goalsFor ?? standing.goalsFor;
    const goalsAgainst = updateStandingDto.goalsAgainst ?? standing.goalsAgainst;

    const updatedStanding = await this.db.standing.update({
      where: { id },
      data: {
        ...updateStandingDto,
        goalDiff: goalsFor - goalsAgainst,
      },
      include: {
        participant: {
          include: {
            team: true,
            user: true,
          }
        },
      }
    });

    return ResponseUtil.success(updatedStanding);
  }

  async remove(id: string) {
    const standing = await this.db.standing.findUnique({ where: { id } });
    if (!standing) throw new NotFoundException('Standing not found');

    await this.db.standing.delete({ where: { id } });
    return ResponseUtil.success({ message: 'Standing deleted successfully' });
  }
}
