import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import { ResponseUtil } from 'src/utils/api-response';
import { CreateTournamentInviteDto } from './dto/create-tournament-invite.dto';
import { AcceptTournamentInviteDto } from './dto/accept-tournament-invite.dto';

import { EventEmitter2 } from '@nestjs/event-emitter';
import { EmailEvents } from 'src/email/email.events';

@Injectable()
export class TournamentInvitesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async createInvite(dto: CreateTournamentInviteDto, userId: string) {
    // Find tournament by ID or slug
    const tournament = await this.db.tournament.findFirst({
      where: { OR: [{ id: dto.tournamentId }, { customName: dto.tournamentId }] },
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
      throw new BadRequestException('Tournament is not linked to any organization');
    }

    const membership = tournament.organization.members[0];
    const isAuthorized = membership && (membership.role === 'OWNER' || membership.role === 'ADMIN');

    if (!isAuthorized) {
      throw new ForbiddenException(
        'Only organization owners and admins can create invite links',
      );
    }

    const invite = await this.db.tournamentInvite.create({
      data: {
        tournament_id: tournament.id, // Use the real UUID
        createdById: userId,
        maxUses: dto.maxUses,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      },
      include: {
        tournament: { select: { id: true, name: true, logoUrl: true } },
      },
    });

    return ResponseUtil.success(invite);
  }

  async getInviteByToken(token: string) {
    const invite = await this.db.tournamentInvite.findUnique({
      where: { token },
      include: {
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
            isPaidRegistration: true,
            registrationFee: true,
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
    const isExpired = invite.expiresAt && new Date(invite.expiresAt) < new Date();
    const isMaxedOut = invite.maxUses && invite.usedCount >= invite.maxUses;

    return ResponseUtil.success({
      ...invite,
      isValid: invite.isActive && !isExpired && !isMaxedOut,
      isExpired: !!isExpired,
      isMaxedOut: !!isMaxedOut,
    });
  }

  async acceptInvite(token: string, userId: string, dto: AcceptTournamentInviteDto) {
    const invite = await this.db.tournamentInvite.findUnique({
      where: { token },
      include: {
        tournament: true,
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

    // Check if already in tournament
    const existingParticipant = await this.db.participant.findFirst({
      where: {
        tournament_id: invite.tournament_id,
        ...(dto.teamId ? { team_id: dto.teamId } : { user_id: userId }),
      },
    });

    if (existingParticipant) {
      if (existingParticipant.status === 'PENDING') {
        throw new BadRequestException('You have already sent a request to join this tournament. Please wait for the organizer to approve it.');
      }
      throw new BadRequestException('You/Your team is already a participant in this tournament');
    }

    // Check participant limit if not premium
    const count = await this.db.participant.count({
      where: { tournament_id: invite.tournament_id },
    });

    let isPremium = invite.tournament.isPremium;
    if (!isPremium && invite.tournament.organization_id) {
      const subscription = await this.db.subscription.findUnique({
        where: { organizationId: invite.tournament.organization_id },
      });
      isPremium = !!(
        subscription &&
        (subscription.status === 'ACTIVE' || subscription.status === 'TRIALING') &&
        (subscription.plan === 'PRO' || subscription.plan === 'ENTERPRISE')
      );
    }

    if (!isPremium && count >= 32) {
      throw new BadRequestException(
        'This tournament is on a Free plan and has reached its maximum limit of 32 participants. Please ask the organizer to upgrade.',
      );
    }

    // Determine initial status based on tournament settings
    const status = invite.tournament.autoApprove ? 'CONFIRMED' : 'PENDING';

    let teamName = dto.customName;
    let teamLogo = dto.logoUrl;

    // If teamId is provided, we can fetch its data if needed, or just link it
    if (dto.teamId) {
      const team = await this.db.team.findUnique({ where: { id: dto.teamId } });
      if (team) {
        teamName = teamName || team.name;
        teamLogo = teamLogo || team.logoUrl || undefined;
      }
    }

    // Create the participant and increment the usedCount in a transaction
    const [participant] = await this.db.$transaction([
      this.db.participant.create({
        data: {
          tournament_id: invite.tournament_id,
          user_id: userId,
          team_id: dto.teamId, // Link to persistent team profile
          customName: teamName,
          customShortName: dto.customShortName,
          logoUrl: teamLogo,
          status: status as any,
        },
      }),
      this.db.tournamentInvite.update({
        where: { id: invite.id },
        data: { usedCount: { increment: 1 } },
      }),
    ]);

    // Notify organizers if pending
    if (status === 'PENDING') {
      try {
        const fullTournament = await this.db.tournament.findUnique({
          where: { id: invite.tournament_id },
          include: {
            organization: {
              include: {
                members: {
                  where: { role: { in: ['OWNER', 'ADMIN'] } },
                  include: { user: true },
                },
              },
            },
          },
        });

        if (fullTournament?.organization?.members) {
          for (const member of fullTournament.organization.members) {
            if (member.user.email) {
              this.eventEmitter.emit(EmailEvents.TOURNAMENT_JOIN_REQUEST, {
                organizerEmail: member.user.email,
                organizerName: member.user.name,
                teamName: teamName || 'A new team',
                tournamentName: fullTournament.name,
                tournamentLogoUrl: fullTournament.logoUrl || undefined,
                dashboardUrl: `${process.env.CLIENT_DASHBOARD_URL || 'http://manage.lvh.me:3001'}/tournaments/${fullTournament.id}`,
              });
            }
          }
        }
      } catch (error) {
        console.error('Failed to emit tournament join request event:', error);
      }
    }

    return ResponseUtil.success({
      participant,
      tournament: invite.tournament,
      status,
      message: status === 'PENDING' 
        ? `Request sent! Waiting for approval to join ${invite.tournament.name}`
        : `Successfully joined ${invite.tournament.name}`,
    });
  }

  async revokeInvite(inviteId: string, userId: string) {
    const invite = await this.db.tournamentInvite.findUnique({
      where: { id: inviteId },
      include: {
        tournament: true,
      },
    });

    if (!invite) {
      throw new NotFoundException('Invite not found');
    }

    if (!invite.tournament.organization_id) {
      throw new BadRequestException('Tournament is not linked to any organization');
    }

    // Verify user is a member of the organization that owns this tournament
    const membership = await this.db.organizationMember.findFirst({
      where: {
        organizationId: invite.tournament.organization_id,
        userId: userId,
      },
    });

    const isAdmin = membership && (membership.role === 'OWNER' || membership.role === 'ADMIN');
    const isCreator = invite.createdById === userId;

    if (!isAdmin && !isCreator) {
      throw new ForbiddenException('You do not have permission to revoke this invite');
    }

    await this.db.tournamentInvite.update({
      where: { id: inviteId },
      data: { isActive: false },
    });

    return ResponseUtil.success({ message: 'Invite revoked successfully' });
  }

  async getInvitesForTournament(tournamentId: string) {
    // Find real tournament ID first if slug is provided
    const tournament = await this.db.tournament.findFirst({
      where: { OR: [{ id: tournamentId }, { customName: tournamentId }] },
      select: { id: true },
    });

    if (!tournament) {
      return ResponseUtil.success([]);
    }

    const invites = await this.db.tournamentInvite.findMany({
      where: { tournament_id: tournament.id },
      include: {
        createdBy: { select: { id: true, name: true } },
      },
      orderBy: { created_at: 'desc' },
    });

    return ResponseUtil.success(invites);
  }
}
