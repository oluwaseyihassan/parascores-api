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

@Injectable()
export class ParticipantsService {
  constructor(private readonly db: DatabaseService) {}

  async addParticipant(
    tournamentId: string,
    dto: AddParticipantDto,
    userIdRef: string,
  ) {
    const tournament = await this.db.tournament.findFirst({
      where: { OR: [{ id: tournamentId }, { customName: tournamentId }] },
      include: {
        participants: true,
        admins: true,
        fixtures: true,
      },
    });

    if (!tournament) {
      throw new NotFoundException('Tournament not found');
    }

    const isOrganizer = tournament.organizer_id === userIdRef;
    const isAdmin = tournament.admins.some((admin) => admin.id === userIdRef);

    if (!isOrganizer && !isAdmin) {
      throw new ForbiddenException(
        'You are not authorized to add participants to this tournament',
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
        admins: true,
        fixtures: true,
      },
    });

    if (!tournament) {
      throw new NotFoundException('Tournament not found');
    }

    const isOrganizer = tournament.organizer_id === userIdRef;
    const isAdmin = tournament.admins.some((admin) => admin.id === userIdRef);

    if (!isOrganizer && !isAdmin) {
      throw new ForbiddenException(
        'You are not authorized to add participants to this tournament',
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
      },
      include: {
        players: true,
        user: true,
        team: true,
      }
    });

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
