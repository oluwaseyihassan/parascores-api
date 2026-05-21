import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import { AddParticipantDto, BulkAddParticipantDto } from 'src/participants/dto/add-participant.dto';
import { AddPlayerDto, BulkAddPlayerDto } from 'src/participants/dto/add-player.dto';
import { UpdateParticipantDto } from 'src/participants/dto/update-participant.dto';
import { ResponseUtil } from 'src/utils/api-response';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EmailEvents } from 'src/email/email.events';

@Injectable()
export class ParticipantsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async addParticipant(
    tournamentId: string,
    dto: AddParticipantDto,
    userIdRef: string,
  ) {
    const tournament = await this.db.tournament.findFirst({
      where: { OR: [{ id: tournamentId }, { customName: tournamentId }] },
      include: {
        participants: true,
        fixtures: true,
      },
    });

    if (!tournament) {
      throw new NotFoundException('Tournament not found');
    }

    if (!tournament.organization_id) {
      throw new ForbiddenException('Tournament has no organization');
    }

    const isMember = await this.db.organizationMember.findFirst({
      where: {
        organizationId: tournament.organization_id,
        userId: userIdRef,
      },
    });

    if (!isMember) {
      throw new ForbiddenException(
        'You are not authorized to add participants to this tournament',
      );
    }

    const subscription = await this.db.subscription.findUnique({
      where: { organizationId: tournament.organization_id! },
    });
    const isPremium = tournament.isPremium || (
      subscription &&
      (subscription.status === 'ACTIVE' || subscription.status === 'TRIALING') &&
      (subscription.plan === 'PRO' || subscription.plan === 'ENTERPRISE')
    );

    if (!isPremium && tournament.participants.length >= 32) {
      throw new BadRequestException(
        'Free tournaments are limited to 32 participants. Please upgrade to Premium or Pro.',
      );
    }

    if (
      tournament.maxParticipants &&
      tournament.participants.length >= tournament.maxParticipants
    ) {
      throw new BadRequestException('Tournament is full');
    }

    if (tournament.fixtures.length > 0) {
      throw new BadRequestException(
        'Cannot add participants after fixtures have been generated. Please clear fixtures first.',
      );
    }

    const participant = await this.db.participant.create({
      data: {
        tournament_id: tournament.id,
        user_id: dto.userId,
        customName: dto.customName,
        team_id: dto.teamId,
        seed: dto.seed,
        logoUrl: dto.logoUrl,
        status: 'CONFIRMED', // Assuming manual add means confirmed
      },
    });
    return ResponseUtil.success(participant);
  }

  async addParticipantsBulk(
    tournamentId: string,
    dto: BulkAddParticipantDto,
    userIdRef: string,
  ) {
    const tournament = await this.db.tournament.findFirst({
      where: { OR: [{ id: tournamentId }, { customName: tournamentId }] },
      include: {
        participants: true,
        fixtures: true,
      },
    });

    if (!tournament) {
      throw new NotFoundException('Tournament not found');
    }

    if (!tournament.organization_id) {
      throw new ForbiddenException('Tournament has no organization');
    }

    const isMember = await this.db.organizationMember.findFirst({
      where: {
        organizationId: tournament.organization_id,
        userId: userIdRef,
      },
    });

    if (!isMember) {
      throw new ForbiddenException(
        'You are not authorized to add participants to this tournament',
      );
    }

    const subscription = await this.db.subscription.findUnique({
      where: { organizationId: tournament.organization_id! },
    });
    const isPremium = tournament.isPremium || (
      subscription &&
      (subscription.status === 'ACTIVE' || subscription.status === 'TRIALING') &&
      (subscription.plan === 'PRO' || subscription.plan === 'ENTERPRISE')
    );

    if (!isPremium && (tournament.participants.length + dto.participants.length) > 32) {
      throw new BadRequestException(
        'Free tournaments are limited to a maximum of 32 participants. Please upgrade to Premium or Pro.',
      );
    }

    if (
      tournament.maxParticipants &&
      (tournament.participants.length + dto.participants.length) > tournament.maxParticipants
    ) {
      throw new BadRequestException(`Adding these participants would exceed the maximum limit of ${tournament.maxParticipants}`);
    }

    if (tournament.fixtures.length > 0) {
      throw new BadRequestException(
        'Cannot add participants after fixtures have been generated. Please clear fixtures first.',
      );
    }

    const participantsData = dto.participants.map(p => ({
      tournament_id: tournament.id,
      user_id: p.userId,
      customName: p.customName,
      team_id: p.teamId,
      seed: p.seed,
      logoUrl: p.logoUrl,
      status: 'CONFIRMED' as any, // assuming manual means confirmed
    }));

    await this.db.participant.createMany({
      data: participantsData,
    });

    return this.getParticipants(tournament.id);
  }

  // get participants of a tournament
  async getParticipants(tournamentId: string) {
    const tournament = await this.db.tournament.findFirst({
      where: { OR: [{ id: tournamentId }, { customName: tournamentId }] },
    });
    if (!tournament) {
      throw new NotFoundException('Tournament not found');
    }
    const participants = await this.db.participant.findMany({
      where: { tournament_id: tournament.id },
      include: {
        players: true,
      },
    });
    if (!participants) {
      throw new NotFoundException('Participants not found');
    }
    return ResponseUtil.success(participants);
  }

  // Add player to participant
  async addPlayer(participantId: string, dto: AddPlayerDto) {
    const participant = await this.db.participant.findUnique({
      where: { id: participantId },
      include: { tournament: true },
    });

    if (!participant) {
      throw new NotFoundException('Participant not found');
    }

    if (participant.tournament.participantType === 'INDIVIDUAL') {
      throw new BadRequestException(
        'Cannot add players to a participant in an INDIVIDUAL tournament.',
      );
    }

    const player = await this.db.player.create({
      data: {
        participantId: participant.id,
        name: dto.name,
        number: dto.number,
        position: dto.position,
      },
    });
    return ResponseUtil.success(player);
  }

  // Add players in bulk
  async addPlayersBulk(participantId: string, dto: BulkAddPlayerDto) {
    const participant = await this.db.participant.findUnique({
      where: { id: participantId },
      include: { tournament: true },
    });

    if (!participant) {
      throw new NotFoundException('Participant not found');
    }

    if (participant.tournament.participantType === 'INDIVIDUAL') {
      throw new BadRequestException(
        'Cannot add players to a participant in an INDIVIDUAL tournament.',
      );
    }

    const playersData = dto.players.map((p) => ({
      participantId: participant.id,
      name: p.name,
      number: p.number,
      position: p.position,
    }));

    await this.db.player.createMany({
      data: playersData,
    });

    return this.getPlayers(participant.id);
  }

  // Get players of participant
  async getPlayers(participantId: string) {
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

  // Get participant by id
  async getParticipantById(participantId: string) {
    const participant = await this.db.participant.findUnique({
      where: { id: participantId },
      include: {
        players: true,
        user: true,
        team: true,
      },
    });
    if (!participant) {
      throw new NotFoundException('Participant not found');
    }
    return ResponseUtil.success(participant);
  }

  // Update participant
  async updateParticipant(participantId: string, dto: UpdateParticipantDto) {
    const participant = await this.db.participant.findUnique({
      where: { id: participantId },
    });

    if (!participant) {
      throw new NotFoundException('Participant not found');
    }

    const updatedParticipant = await this.db.participant.update({
      where: { id: participantId },
      data: {
        customName: dto.customName !== undefined ? dto.customName : undefined,
        logoUrl: dto.logoUrl !== undefined ? dto.logoUrl : undefined,
        groupId: dto.groupId !== undefined ? dto.groupId : undefined,
        team_id: dto.teamId !== undefined ? dto.teamId : undefined,
      },
      include: {
        players: true,
        user: true,
        team: true,
        group: true,
      }
    });

    // Sync standing if groupId was changed
    if (dto.groupId !== undefined) {
      await this.syncParticipantStanding(participantId, dto.groupId);
    }

    return ResponseUtil.success(updatedParticipant);
  }

  async generateLinkCode(participantId: string) {
    const participant = await this.db.participant.findUnique({
      where: { id: participantId },
    });

    if (!participant) {
      throw new NotFoundException('Participant not found');
    }

    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 48);

    const updated = await this.db.participant.update({
      where: { id: participantId },
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

  private async syncParticipantStanding(participantId: string, groupId: string | null) {
    const participant = await this.db.participant.findUnique({
      where: { id: participantId },
      include: { group: true },
    });

    if (!participant) return;

    await this.db.standing.upsert({
      where: {
        tournament_id_participant_id: {
          tournament_id: participant.tournament_id,
          participant_id: participant.id,
        },
      },
      create: {
        tournament_id: participant.tournament_id,
        participant_id: participant.id,
        group: participant.group?.name || null,
        played: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        goalDiff: 0,
        points: 0,
      },
      update: {
        group: participant.group?.name || null,
      },
    });
  }

  // Update player status (approve/reject)
  async updatePlayerStatus(
    participantId: string,
    playerId: string,
    status: string,
  ) {
    const player = await this.db.player.findUnique({
      where: { id: playerId },
    });

    if (!player || player.participantId !== participantId) {
      throw new NotFoundException('Player not found in this team');
    }

    const updatedPlayer = await this.db.player.update({
      where: { id: playerId },
      data: { status: status as any },
    });

    if (status?.toUpperCase() === 'APPROVED' && updatedPlayer.userId) {
      try {
        const user = await this.db.user.findUnique({
          where: { id: updatedPlayer.userId },
        });
        const participant = await this.db.participant.findUnique({
          where: { id: participantId },
          include: { tournament: true },
        });

        if (user?.email && participant?.tournament) {
          this.eventEmitter.emit(EmailEvents.TEAM_JOIN_APPROVAL, {
            playerEmail: user.email,
            playerName: user.name,
            teamName: participant.customName || 'their team',
            tournamentName: participant.tournament.name,
            customName: participant.tournament.customName,
            tournamentLogoUrl: participant.tournament.logoUrl || undefined,
          });
        }
      } catch (error) {
        console.error('Failed to send player approval email:', error);
      }
    } else if (status?.toUpperCase() === 'REJECTED' && updatedPlayer.userId) {
      try {
        const user = await this.db.user.findUnique({
          where: { id: updatedPlayer.userId },
        });
        const participant = await this.db.participant.findUnique({
          where: { id: participantId },
          include: { tournament: true },
        });

        if (user?.email && participant?.tournament) {
          this.eventEmitter.emit(EmailEvents.TEAM_JOIN_REJECTION, {
            playerEmail: user.email,
            playerName: user.name,
            teamName: participant.customName || 'their team',
            tournamentName: participant.tournament.name,
            tournamentLogoUrl: participant.tournament.logoUrl || undefined,
          });
        }
      } catch (error) {
        console.error('Failed to send player rejection email:', error);
      }
    }

    return ResponseUtil.success(updatedPlayer);
  }

  // Remove player
  async removePlayer(participantId: string, playerId: string) {
    const player = await this.db.player.findUnique({
      where: { id: playerId },
    });

    if (!player || player.participantId !== participantId) {
      throw new NotFoundException('Player not found in this team');
    }

    await this.db.player.delete({
      where: { id: playerId },
    });

    return ResponseUtil.success(null, 'Player removed successfully');
  }

  // Update participant status (approve/reject)
  async updateParticipantStatus(
    participantId: string,
    status: string,
    userIdRef: string,
  ) {
    const participant = await this.db.participant.findUnique({
      where: { id: participantId },
      include: { 
        tournament: true,
        user: true,
        team: true
      },
    });

    if (!participant) {
      throw new NotFoundException('Participant not found');
    }

    if (!participant.tournament.organization_id) {
      throw new ForbiddenException('Tournament has no organization');
    }

    // Verify authorized member
    const isMember = await this.db.organizationMember.findFirst({
      where: {
        organizationId: participant.tournament.organization_id,
        userId: userIdRef,
      },
    });

    const isAuthorized = isMember && (isMember.role === 'OWNER' || isMember.role === 'ADMIN');
    if (!isAuthorized) {
      throw new ForbiddenException('You are not authorized to update participant status');
    }

    const updatedParticipant = await this.db.participant.update({
      where: { id: participantId },
      data: { status: status as any },
      include: {
        players: true,
        user: true,
        team: true,
        group: true,
      }
    });

    // Notify user
    if (updatedParticipant.user?.email) {
      if (status.toUpperCase() === 'CONFIRMED') {
        const tournamentUrl = `${process.env.CLIENT_URL || 'http://lvh.me:3001'}/t/${participant.tournament.customName || participant.tournament.id}`;
        this.eventEmitter.emit(EmailEvents.TOURNAMENT_JOIN_APPROVAL, {
          userEmail: updatedParticipant.user.email,
          userName: updatedParticipant.user.name,
          teamName: updatedParticipant.customName || updatedParticipant.team?.name || 'your team',
          tournamentName: participant.tournament.name,
          tournamentUrl,
          tournamentLogoUrl: participant.tournament.logoUrl || undefined,
        });
      } else if (status.toUpperCase() === 'DECLINED') {
        this.eventEmitter.emit(EmailEvents.TOURNAMENT_JOIN_REJECTION, {
          userEmail: updatedParticipant.user.email,
          userName: updatedParticipant.user.name,
          teamName: updatedParticipant.customName || updatedParticipant.team?.name || 'your team',
          tournamentName: participant.tournament.name,
          tournamentLogoUrl: participant.tournament.logoUrl || undefined,
        });
      }
    }

    // Sync standing if confirmed
    if (status.toUpperCase() === 'CONFIRMED' && updatedParticipant.groupId) {
      await this.syncParticipantStanding(participantId, updatedParticipant.groupId);
    }

    return ResponseUtil.success(updatedParticipant);
  }

  // Remove participant
  async removeParticipant(participantId: string) {
    const participant = await this.db.participant.findUnique({
      where: { id: participantId },
    });

    if (!participant) {
      throw new NotFoundException('Participant not found');
    }

    await this.db.participant.delete({
      where: { id: participantId },
    });

    return ResponseUtil.success(null, 'Participant removed successfully');
  }
}
