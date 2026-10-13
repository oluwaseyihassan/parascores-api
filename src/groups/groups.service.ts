import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import { ResponseUtil } from 'src/utils/api-response';
import { RedisService } from 'src/redis/redis.service';

@Injectable()
export class GroupsService {
  constructor(private readonly db: DatabaseService, private readonly redisService: RedisService) {}

  async create(dto: CreateGroupDto) {
    const tournament = await this.db.tournament.findFirst({
      where: {
        OR: [{ id: dto.tournament_id }, { customName: dto.tournament_id }],
      },
    });
    if (!tournament) throw new NotFoundException('Tournament not found');

    await this.redisService.del(`standings:${tournament.id}`);
    const group = await this.db.group.create({
      data: {
        name: dto.name,
        tournament_id: tournament.id,
      },
    });
    return ResponseUtil.success(group);
  }

  async findAllByTournament(tournamentId: string) {
    const tournament = await this.db.tournament.findFirst({
      where: { OR: [{ id: tournamentId }, { customName: tournamentId }] },
    });
    if (!tournament) throw new NotFoundException('Tournament not found');

    const groups = await this.db.group.findMany({
      where: { tournament_id: tournament.id },
      include: {
        participants: {
          include: {
            team: true,
            user: true,
          },
        },
      },
      orderBy: { created_at: 'asc' },
    });
    return ResponseUtil.success(groups);
  }

  async update(id: string, dto: UpdateGroupDto) {
    const group = await this.db.group.findUnique({ where: { id } });
    if (!group) throw new NotFoundException('Group not found');

    await this.redisService.del(`standings:${group.tournament_id}`);
    const updated = await this.db.group.update({
      where: { id },
      data: dto,
    });
    return ResponseUtil.success(updated);
  }

  async remove(id: string) {
    const group = await this.db.group.findUnique({
      where: { id },
      include: { participants: true },
    });
    if (!group) throw new NotFoundException('Group not found');

    // Unassign participants and sync standings
    if (group.participants && group.participants.length > 0) {
      const participantIds = group.participants.map((p) => p.id);

      // Update participants
      await this.db.participant.updateMany({
        where: { id: { in: participantIds } },
        data: { groupId: null },
      });

      // Update standings
      await this.db.standing.updateMany({
        where: {
          participant_id: { in: participantIds },
          tournament_id: group.tournament_id,
        },
        data: { group: null },
      });
    }

    await this.redisService.del(`standings:${group.tournament_id}`);
    await this.db.group.delete({ where: { id } });
    return ResponseUtil.success({ message: 'Group deleted successfully' });
  }
}
