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
      },
      include: { participant: true }
    });
    
    return ResponseUtil.success(player);
  }

  async findAll() {
    const players = await this.db.player.findMany({
      include: { participant: true }
    });
    return ResponseUtil.success(players);
  }

  async findOne(id: string) {
    const player = await this.db.player.findUnique({
      where: { id },
      include: {
        participant: true,
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
      include: { participant: true }
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
}
