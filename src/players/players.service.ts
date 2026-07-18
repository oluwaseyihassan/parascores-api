import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { CreatePlayerDto } from './dto/create-player.dto';
import { UpdatePlayerDto } from './dto/update-player.dto';
import { DatabaseService } from 'src/database/database.service';
import { ResponseUtil } from 'src/utils/api-response';
import { Role } from 'src/auth/enums/role.enum';

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
        relatedMatchEvents: true,
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

  async update(
    id: string,
    updatePlayerDto: UpdatePlayerDto,
    currentUser?: any,
  ) {
    const player = await this.db.player.findUnique({ where: { id } });
    if (!player) {
      throw new NotFoundException('Player not found');
    }

    if (currentUser) {
      const isOwner = player.userId === currentUser.sub;
      const isAdmin = currentUser.role === Role.SUPER_ADMIN;
      const isOrganizer = currentUser.role === Role.ORGANIZER;
      if (!isOwner && !isAdmin && !isOrganizer) {
        throw new ForbiddenException(
          'You do not have permission to edit this player profile',
        );
      }

      // Player-owners cannot edit until their claim is approved
      if (isOwner && !isAdmin && !isOrganizer && player.status === 'PENDING') {
        throw new ForbiddenException(
          'Your profile claim is pending approval. You cannot edit your profile until the organizer has approved it.',
        );
      }
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
        relatedMatchEvents: true,
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

  async generateLinkCode(playerId: string) {
    const player = await this.db.player.findUnique({ where: { id: playerId } });
    if (!player) {
      throw new NotFoundException('Player not found');
    }

    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 48);

    const updated = await this.db.player.update({
      where: { id: playerId },
      data: {
        linkCode: code,
        linkCodeExpires: expiresAt,
      },
    });

    return ResponseUtil.success({
      code: updated.linkCode,
      expiresAt: updated.linkCodeExpires,
    });
  }

  async claimPlayer(code: string, userId: string) {
    const player = await this.db.player.findFirst({
      where: { linkCode: code.toUpperCase() },
    });

    if (!player) {
      throw new NotFoundException('Invalid claim code');
    }

    if (player.linkCodeExpires && player.linkCodeExpires < new Date()) {
      throw new ForbiddenException('Claim code has expired');
    }

    if (player.userId) {
      throw new ForbiddenException(
        'This player profile is already linked to a user',
      );
    }

    const updatedPlayer = await this.db.player.update({
      where: { id: player.id },
      data: {
        userId,
        linkCode: null,
        linkCodeExpires: null,
      },
      include: {
        participant: {
          include: { tournament: true },
        },
      },
    });

    return ResponseUtil.success(
      updatedPlayer,
      'Player profile linked successfully',
    );
  }

  async verifyClaimCode(code: string, userId: string) {
    const player = await this.db.player.findFirst({
      where: { linkCode: code.toUpperCase() },
      include: {
        participant: {
          include: {
            tournament: true,
          },
        },
      },
    });

    if (!player) {
      throw new NotFoundException('Invalid claim code');
    }

    if (player.linkCodeExpires && player.linkCodeExpires < new Date()) {
      throw new ForbiddenException('Claim code has expired');
    }

    if (player.userId) {
      throw new ForbiddenException(
        'This player profile is already linked to a user',
      );
    }

    // Check if user already has a claimed player profile in this tournament
    const existingPlayerInTournament = await this.db.player.findFirst({
      where: {
        userId,
        participant: {
          tournament_id: player.participant.tournament_id,
        },
      },
    });

    if (existingPlayerInTournament) {
      throw new ForbiddenException(
        'You already have a linked player profile in this tournament',
      );
    }

    return ResponseUtil.success({
      id: player.id,
      name: player.name,
      number: player.number,
      position: player.position,
      teamName: player.participant.customName || 'Individual',
      tournamentName: player.participant.tournament.name,
    });
  }

  async unlinkProfile(playerId: string, currentUser?: any) {
    const player = await this.db.player.findUnique({ where: { id: playerId } });
    if (!player) {
      throw new NotFoundException('Player not found');
    }

    if (currentUser) {
      const isOwner = player.userId === currentUser.sub;
      const isAdmin = currentUser.role === Role.SUPER_ADMIN;
      const isOrganizer = currentUser.role === Role.ORGANIZER;
      if (!isOwner && !isAdmin && !isOrganizer) {
        throw new ForbiddenException(
          'You do not have permission to unlink this player profile',
        );
      }
    }

    const updated = await this.db.player.update({
      where: { id: playerId },
      data: {
        userId: null,
        status: 'APPROVED',
        linkCode: null,
        linkCodeExpires: null,
      },
      include: {
        participant: {
          include: { tournament: true },
        },
      },
    });

    return ResponseUtil.success(
      updated,
      'Player profile unlinked successfully',
    );
  }
}
