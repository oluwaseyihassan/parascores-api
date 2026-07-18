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

    // Verify user is a member of the organization that owns this tournament
    const tournament = await this.db.tournament.findUnique({
      where: { id: dto.tournamentId },
      include: {
        organization: {
          include: {
            members: {
              where: { userId },
              select: { role: true },
            },
          },
        },
      },
    });

    if (!tournament) {
      throw new NotFoundException('Tournament not found');
    }

    if (!tournament.organization) {
      throw new BadRequestException(
        'Tournament is not linked to any organization',
      );
    }

    const membership = tournament.organization.members[0];
    const isAuthorized =
      membership &&
      (membership.role === 'OWNER' || membership.role === 'ADMIN');

    if (!isAuthorized) {
      throw new ForbiddenException(
        'Only organization owners and admins can create invite links',
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
              select: {
                id: true,
                name: true,
                number: true,
                position: true,
                avatarUrl: true,
                status: true,
              },
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
            organization: {
              select: {
                name: true,
                logoUrl: true,
                isVerified: true,
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
    const isExpired =
      invite.expiresAt && new Date(invite.expiresAt) < new Date();
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
            players: { select: { userId: true, status: true } },
          },
        },
        tournament: {
          include: {
            organization: {
              include: {
                members: {
                  where: { role: { in: ['OWNER', 'ADMIN'] } },
                  include: {
                    user: { select: { id: true, email: true, name: true } },
                  },
                },
              },
            },
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

    // Identify the primary contact for notifications (OWNER or first ADMIN)
    const organization = invite.tournament.organization;
    const primaryContact =
      organization?.members.find((m) => m.role === 'OWNER')?.user ||
      organization?.members[0]?.user;

    // 1b. Check if user is already registered for ANY team in this same tournament
    const alreadyInTournament = await this.db.player.findFirst({
      where: {
        userId,
        status: { in: ['APPROVED', 'PENDING'] },
        participant: {
          tournament_id: invite.tournament_id,
        },
      },
      include: {
        participant: { select: { customName: true } },
      },
    });

    if (alreadyInTournament) {
      const teamName =
        alreadyInTournament.participant?.customName || 'another team';
      if (alreadyInTournament.status === 'APPROVED') {
        throw new BadRequestException(
          `You are already a member of ${teamName} in this tournament.`,
        );
      } else {
        throw new BadRequestException(
          `You already have a pending request to join ${teamName} in this tournament.`,
        );
      }
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
    if (status === 'PENDING' && primaryContact) {
      this.eventEmitter.emit(EmailEvents.TEAM_JOIN_REQUEST, {
        organizerEmail: primaryContact.email,
        organizerName: primaryContact.name,
        playerName: dto.name,
        teamName: invite.participant.customName || 'the team',
        tournamentName: invite.tournament.name,
        tournamentLogoUrl: invite.tournament.logoUrl || undefined,
      });
    }

    return ResponseUtil.success({
      player,
      tournament: invite.tournament,
      status,
      message:
        status === 'PENDING'
          ? `Request sent! Waiting for approval to join ${invite.participant.customName || 'the team'}`
          : `Successfully joined ${invite.participant.customName || 'the team'}`,
    });
  }

  async revokeInvite(inviteId: string, userId: string) {
    const invite = await this.db.teamInvite.findUnique({
      where: { id: inviteId },
      include: {
        tournament: true,
      },
    });

    if (!invite) {
      throw new NotFoundException('Invite not found');
    }

    if (!invite.tournament.organization_id) {
      throw new BadRequestException(
        'Tournament is not linked to any organization',
      );
    }

    // Verify user is a member of the organization that owns this tournament
    const membership = await this.db.organizationMember.findFirst({
      where: {
        organizationId: invite.tournament.organization_id,
        userId: userId,
      },
    });

    const isAdmin =
      membership &&
      (membership.role === 'OWNER' || membership.role === 'ADMIN');
    const isCreator = invite.createdById === userId;

    if (!isAdmin && !isCreator) {
      throw new ForbiddenException(
        'You do not have permission to revoke this invite',
      );
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
