import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateStandingDto } from './dto/create-standing.dto';
import { UpdateStandingDto } from './dto/update-standing.dto';
import { DatabaseService } from 'src/database/database.service';
import { ResponseUtil } from 'src/utils/api-response';
import { RedisService } from 'src/redis/redis.service';

@Injectable()
export class StandingsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly redisService: RedisService,
  ) {}

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
        goalDiff:
          (createStandingDto.goalsFor || 0) -
          (createStandingDto.goalsAgainst || 0),
      },
      include: {
        participant: {
          include: {
            team: true,
            user: true,
          },
        },
        tournament: { select: { id: true, name: true, customName: true } },
      },
    });

    // Invalidate caches
    await this.redisService.del(`standings:${createStandingDto.tournament_id}`);
    if (tournament.customName) {
      await this.redisService.del(`standings:${tournament.customName}`);
    }

    return ResponseUtil.success(standing);
  }

  // Extracted from TournamentsService
  async getStandings(tournamentId: string) {
    const cacheKey = `standings:${tournamentId}`;
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

    if (tournament.type === 'KNOCKOUT' || tournament.type === 'FRIENDLY') {
      const response = ResponseUtil.success({ standings: [] });
      await this.redisService.set(cacheKey, response, 3600);
      return response;
    }

    const standings = await this.db.standing.findMany({
      where: { tournament_id: tournament.id },
      include: {
        participant: {
          include: {
            team: true,
            user: true,
          },
        },
      },
      orderBy: [
        { group: 'asc' },
        { points: 'desc' },
        { goalDiff: 'desc' },
        { goalsFor: 'desc' },
        { played: 'asc' },
      ],
    });

    const response = ResponseUtil.success({
      standings: standings.map((s) => ({
        ...s,
        participantName:
          s.participant?.team?.name ||
          s.participant?.customName ||
          s.participant?.user?.name ||
          'Unknown',
      })),
    });

    await this.redisService.set(cacheKey, response, 3600); // Cache for 1 hour

    return response;
  }

  async findOne(id: string) {
    const standing = await this.db.standing.findUnique({
      where: { id },
      include: {
        participant: {
          include: {
            team: true,
            user: true,
          },
        },
        tournament: true,
      },
    });

    if (!standing) throw new NotFoundException('Standing not found');
    return ResponseUtil.success(standing);
  }

  async update(id: string, updateStandingDto: UpdateStandingDto) {
    const standing = await this.db.standing.findUnique({
      where: { id },
      include: { tournament: true },
    });
    if (!standing) throw new NotFoundException('Standing not found');

    // recalculate goal difference if goals modify
    const goalsFor = updateStandingDto.goalsFor ?? standing.goalsFor;
    const goalsAgainst =
      updateStandingDto.goalsAgainst ?? standing.goalsAgainst;

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
          },
        },
      },
    });

    // Invalidate caches
    await this.redisService.del(`standings:${standing.tournament_id}`);
    if (standing.tournament?.customName) {
      await this.redisService.del(`standings:${standing.tournament.customName}`);
    }

    return ResponseUtil.success(updatedStanding);
  }

  async remove(id: string) {
    const standing = await this.db.standing.findUnique({
      where: { id },
      include: { tournament: true },
    });
    if (!standing) throw new NotFoundException('Standing not found');

    await this.db.standing.delete({ where: { id } });

    // Invalidate caches
    await this.redisService.del(`standings:${standing.tournament_id}`);
    if (standing.tournament?.customName) {
      await this.redisService.del(`standings:${standing.tournament.customName}`);
    }

    return ResponseUtil.success({ message: 'Standing deleted successfully' });
  }
}
