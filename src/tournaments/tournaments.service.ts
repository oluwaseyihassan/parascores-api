import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import { CreateTournamentDto } from './dto/create-tournament.dto';
import { AddParticipantDto } from './dto/add-participant.dto';
import { Visibility } from 'prisma/generated/client';

@Injectable()
export class TournamentsService {
  constructor(private readonly db: DatabaseService) { }

  async create(userId: string, dto: CreateTournamentDto) {
    const { startDate, endDate, ...rest } = dto;
    return this.db.tournament.create({
      data: {
        ...rest,
        start_date: new Date(startDate),
        end_date: new Date(endDate),
        organizer_id: userId,
      },
    });
  }

  async findAllPublic() {
    return this.db.tournament.findMany({
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
    });
  }

  async findAllMine(userId: string) {
    return this.db.tournament.findMany({
      where: {
        organizer_id: userId,
      },
      include: {
        _count: {
          select: { participants: true },
        },
      },
    });
  }

  async addParticipant(tournamentId: string, dto: AddParticipantDto, userIdRef: string) {
    const tournament = await this.db.tournament.findUnique({
      where: { id: tournamentId },
      include: {
        participants: true,
        admins: true,
      },
    });

    if (!tournament) {
      throw new NotFoundException('Tournament not found');
    }

    // Check authorization: Organizer or Admin
    // The user requirement says "restrict to Organizer/Admins only".
    // I am passing userIdRef (the user making the request)
    const isOrganizer = tournament.organizer_id === userIdRef;
    const isAdmin = tournament.admins.some(admin => admin.id === userIdRef);
    
    // Also check if user is SUPER_ADMIN? The prompt didn't strictly specify, but "Organizer/Admins" likely refers to tournament level.
    // However, if strict role-based (RBAC) implies generic admins, I'd check that too. I'll stick to tournament-level auth for now.
    
    if (!isOrganizer && !isAdmin) {
       // Wait, the Requirement says "restrict to Organizer/Admins only" for ADDING A PARTICIPANT.
       // Usually participants register themselves? 
       // "addParticipant(restrict to Organizer/Admins only)" typically implies *manual* addition/management.
       // If a user wants to join, that might be "joinTournament".
       // I will assume this endpoint is for management actions as requested.
       throw new ForbiddenException('You are not authorized to add participants to this tournament');
    }

    if (tournament.maxParticipants && tournament.participants.length >= tournament.maxParticipants) {
      throw new BadRequestException('Tournament is full');
    }

    // Check duplicates? (optional but good)

    return this.db.participant.create({
      data: {
        tournament_id: tournamentId,
        user_id: dto.userId,
        customName: dto.customName,
        team_id: dto.teamId,
        seed: dto.seed,
        status: 'CONFIRMED', // Assuming manual add means confirmed
      },
    });
  }
}
