import { Injectable, NotFoundException } from '@nestjs/common';
import { CreatePlayerDto } from './dto/create-player.dto';
import { UpdatePlayerDto } from './dto/update-player.dto';
import { DatabaseService } from 'src/database/database.service';
import { ResponseUtil } from 'src/utils/api-response';

@Injectable()
export class PlayersService {
  constructor(private readonly db: DatabaseService) {}

  async create(createPlayerDto: CreatePlayerDto) {
    const participant = await this.db.participant.findUnique({
      where: { id: createPlayerDto.participantId },
    });

    if (!participant) {
      throw new NotFoundException('Participant not found');
    }

    const player = await this.db.player.create({
      data: {
        participantId: createPlayerDto.participantId,
        name: createPlayerDto.name,
        number: createPlayerDto.number,
        position: createPlayerDto.position,
        userId: createPlayerDto.userId,
        avatarUrl: createPlayerDto.avatarUrl,
        status: 'APPROVED',
      },
      include: { participant: true },
    });

    return ResponseUtil.success(player);
  }

  async findAll() {
    const players = await this.db.player.findMany({
      include: { participant: true },
    });
    return ResponseUtil.success(players);
  }

  async findOne(id: string) {
    const player = await this.db.player.findUnique({
      where: { id },
      include: {
        participant: {
          include: {
            tournament: true,
          },
        },
        matchEvents: true,
        user: {
          include: {
            player_profiles: {
              include: {
                participant: {
                  include: {
                    tournament: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!player) {
      throw new NotFoundException('Player not found');
    }

    return ResponseUtil.success(player);
  }

  async update(id: string, updatePlayerDto: UpdatePlayerDto) {
    const player = await this.db.player.findUnique({ where: { id } });
    if (!player) {
      throw new NotFoundException('Player not found');
    }

    const updatedPlayer = await this.db.player.update({
      where: { id },
      data: updatePlayerDto,
      include: { participant: true },
    });

    return ResponseUtil.success(updatedPlayer);
  }

  async remove(id: string) {
    const player = await this.db.player.findUnique({ where: { id } });
    if (!player) {
      throw new NotFoundException('Player not found');
    }

    await this.db.player.delete({ where: { id } });
    return ResponseUtil.success({ message: 'Player deleted successfully' });
  }

  async findByParticipant(participantId: string) {
    const participant = await this.db.participant.findUnique({
      where: { id: participantId },
    });

    if (!participant) {
      throw new NotFoundException('Participant not found');
    }

    const players = await this.db.player.findMany({
      where: { participantId },
      orderBy: { number: 'asc' },
    });

    return ResponseUtil.success(players);
  }

  async findByUserId(userId: string) {
    const players = await this.db.player.findMany({
      where: { userId },
      include: {
        participant: {
          include: {
            tournament: {
              select: {
                id: true,
                name: true,
                logoUrl: true,
                sport: true,
                start_date: true,
                end_date: true,
              },
            },
          },
        },
        matchEvents: true,
      },
      orderBy: { created_at: 'desc' },
    });

    return ResponseUtil.success(players);
  }

  async linkToUser(playerId: string, userId: string) {
    const player = await this.db.player.findUnique({ where: { id: playerId } });
    if (!player) {
      throw new NotFoundException('Player not found');
    }

    const updatedPlayer = await this.db.player.update({
      where: { id: playerId },
      data: { userId },
      include: {
        participant: {
          include: { tournament: true },
        },
      },
    });

    return ResponseUtil.success(updatedPlayer);
  }
}
