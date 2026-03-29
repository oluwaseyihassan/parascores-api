import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import { ResponseUtil } from 'src/utils/api-response';
import { CreateTeamInviteDto } from './dto/create-team-invite.dto';
import { AcceptTeamInviteDto } from './dto/accept-team-invite.dto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EmailEvents } from 'src/email/email.events';

@Injectable()
export class TeamInvitesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async createInvite(dto: CreateTeamInviteDto, userId: string) {
    // Verify participant and tournament exist
    const participant = await this.db.participant.findUnique({
      where: { id: dto.participantId },
      include: { tournament: true },
    });

    if (!participant) {
      throw new NotFoundException('Participant (team) not found');
    }

    if (participant.tournament_id !== dto.tournamentId) {
      throw new BadRequestException(
        'Participant does not belong to this tournament',
      );
    }

    // Verify user is the organizer or admin of this tournament
    const tournament = await this.db.tournament.findUnique({
      where: { id: dto.tournamentId },
      include: { admins: { select: { id: true } } },
    });

    if (!tournament) {
      throw new NotFoundException('Tournament not found');
    }

    const isOrganizer = tournament.organizer_id === userId;
    const isAdmin = tournament.admins.some((a) => a.id === userId);

    if (!isOrganizer && !isAdmin) {
      throw new ForbiddenException(
        'Only tournament organizers and admins can create invite links',
      );
    }

    const invite = await this.db.teamInvite.create({
      data: {
        participant_id: dto.participantId,
        tournament_id: dto.tournamentId,
        createdById: userId,
        maxUses: dto.maxUses,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      },
      include: {
        participant: { select: { id: true, customName: true, logoUrl: true } },
        tournament: { select: { id: true, name: true, logoUrl: true } },
      },
    });

    return ResponseUtil.success(invite);
  }

  async getInviteByToken(token: string) {
    const invite = await this.db.teamInvite.findUnique({
      where: { token },
      include: {
        participant: {
          select: {
            id: true,
            customName: true,
            logoUrl: true,
            players: {
              select: { id: true, name: true, number: true, position: true, avatarUrl: true },
            },
          },
        },
        tournament: {
          select: {
            id: true,
            name: true,
            customName: true,
            logoUrl: true,
            bannerUrl: true,
            sport: true,
            start_date: true,
            end_date: true,
            location: true,
            autoApprove: true,
            organizer: {
              select: {
                name: true,
                organization_name: true,
                organization_logo: true,
              },
            },
          },
        },
      },
    });

    if (!invite) {
      throw new NotFoundException('Invite not found');
    }

    // Check validity without modifying
    const isExpired = invite.expiresAt && new Date(invite.expiresAt) < new Date();
    const isMaxedOut = invite.maxUses && invite.usedCount >= invite.maxUses;

    return ResponseUtil.success({
      ...invite,
      isValid: invite.isActive && !isExpired && !isMaxedOut,
      isExpired: !!isExpired,
      isMaxedOut: !!isMaxedOut,
    });
  }

  async acceptInvite(token: string, userId: string, dto: AcceptTeamInviteDto) {
    // 1. Fetch tournament details with organizer for status & notification
    const invite = await this.db.teamInvite.findUnique({
      where: { token },
      include: {
        participant: {
          include: {
            players: { select: { userId: true } },
          },
        },
        tournament: {
          include: {
            organizer: { select: { id: true, email: true, name: true } },
            
          },
        },
      },
    });

    if (!invite) {
      throw new NotFoundException('Invite not found or has expired');
    }

    if (!invite.isActive) {
      throw new BadRequestException('This invite link has been revoked');
    }

    if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
      throw new BadRequestException('This invite link has expired');
    }

    if (invite.maxUses && invite.usedCount >= invite.maxUses) {
      throw new BadRequestException(
        'This invite link has reached its maximum number of uses',
      );
    }

    // Check if user is already on this team
    const alreadyOnTeam = invite.participant.players.some(
      (p) => p.userId === userId,
    );
    if (alreadyOnTeam) {
      throw new BadRequestException('You are already a member of this team');
    }

    // 2. Determine initial status based on tournament settings
    const status = invite.tournament.autoApprove ? 'APPROVED' : 'PENDING';

    // 3. Create the player and increment the usedCount in a transaction
    const [player] = await this.db.$transaction([
      this.db.player.create({
        data: {
          participantId: invite.participant_id,
          userId,
          name: dto.name,
          number: dto.number,
          position: dto.position,
          avatarUrl: dto.avatarUrl,
          status: status as any,
        },
        include: {
          participant: {
            select: { id: true, customName: true, logoUrl: true },
          },
        },
      }),
      this.db.teamInvite.update({
        where: { id: invite.id },
        data: { usedCount: { increment: 1 } },
      }),
    ]);

    // 4. Send notification if status is PENDING
    if (status === 'PENDING' && invite.tournament.organizer) {
      this.eventEmitter.emit(EmailEvents.TEAM_JOIN_REQUEST, {
        organizerEmail: invite.tournament.organizer.email,
        organizerName: invite.tournament.organizer.name,
        playerName: dto.name,
        teamName: invite.participant.customName || 'the team',
        tournamentName: invite.tournament.name,
      });
    }

    return ResponseUtil.success({
      player,
      tournament: invite.tournament,
      status,
      message: status === 'PENDING' 
        ? `Request sent! Waiting for approval to join ${invite.participant.customName || 'the team'}`
        : `Successfully joined ${invite.participant.customName || 'the team'}`,
    });
  }

  async revokeInvite(inviteId: string, userId: string) {
    const invite = await this.db.teamInvite.findUnique({
      where: { id: inviteId },
      include: {
        tournament: {
          include: { admins: { select: { id: true } } },
        },
      },
    });

    if (!invite) {
      throw new NotFoundException('Invite not found');
    }

    const isOrganizer = invite.tournament.organizer_id === userId;
    const isAdmin = invite.tournament.admins.some((a) => a.id === userId);
    const isCreator = invite.createdById === userId;

    if (!isOrganizer && !isAdmin && !isCreator) {
      throw new ForbiddenException('You do not have permission to revoke this invite');
    }

    await this.db.teamInvite.update({
      where: { id: inviteId },
      data: { isActive: false },
    });

    return ResponseUtil.success({ message: 'Invite revoked successfully' });
  }

  async getInvitesForParticipant(participantId: string) {
    const invites = await this.db.teamInvite.findMany({
      where: { participant_id: participantId },
      include: {
        createdBy: { select: { id: true, name: true } },
      },
      orderBy: { created_at: 'desc' },
    });

    return ResponseUtil.success(invites);
  }
}
