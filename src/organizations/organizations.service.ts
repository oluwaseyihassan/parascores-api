import {
  Injectable,
  ConflictException,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { OrganizationRole } from 'prisma/generated/client';
import { DatabaseService } from 'src/database/database.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { ResponseUtil } from 'src/utils/api-response';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  EmailEvents,
  OrganizationMemberAddedPayload,
  OrganizationMemberRoleUpdatedPayload,
  OrganizationMemberRemovedPayload,
  OrganizationCreatedPayload,
  OrganizationDeleteCodePayload,
} from 'src/email/email.events';

// In-memory store for deletion codes (orgId -> { code, expiresAt, userId })
const deletionCodes = new Map<
  string,
  { code: string; expiresAt: Date; userId: string }
>();

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async create(userId: string, dto: CreateOrganizationDto) {
    const user = await this.db.user.findUnique({
      where: { id: userId },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    let slug = this.generateSlug(dto.name);
    let isUnique = false;

    while (!isUnique) {
      const existingOrg = await this.db.organization.findUnique({
        where: { slug },
      });

      if (existingOrg) {
        // Append a short random string to make it unique
        const suffix = Math.random().toString(36).substring(2, 6);
        slug = `${this.generateSlug(dto.name)}-${suffix}`;
      } else {
        isUnique = true;
      }
    }

    // Create organization, member (OWNER), and update user role in a transaction
    const organization = await this.db.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: {
          ...dto,
          slug,
        },
      });

      await tx.organizationMember.create({
        data: {
          organizationId: org.id,
          userId,
          role: 'OWNER',
        },
      });

      await tx.user.update({
        where: { id: userId },
        data: { role: 'ORGANIZER' },
      });

      return org;
    });

    this.eventEmitter.emit(EmailEvents.ORGANIZATION_CREATED, {
      ownerEmail: user.email,
      ownerName: user.name,
      organizationName: organization.name,
      organizationSlug: organization.slug,
      organizationPhone: dto.phone,
    } as OrganizationCreatedPayload);

    return ResponseUtil.success(
      organization,
      'Organization created successfully',
    );
  }

  async findOne(id: string) {
    const organization = await this.db.organization.findUnique({
      where: { id },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                picture: true,
              },
            },
          },
        },
      },
    });

    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    return ResponseUtil.success(
      organization,
      'Organization retrieved successfully',
    );
  }

  async listRoster(orgId: string) {
    const roster = await this.db.rosterEntry.findMany({
      where: { organizationId: orgId },
      include: {
        _count: { select: { entries: true } },
      },
      orderBy: { name: 'asc' },
    });

    return ResponseUtil.success(roster, 'Roster retrieved successfully');
  }

  private async validateRosterAccess(orgId: string, userId: string) {
    const user = await this.db.user.findUnique({ where: { id: userId } });
    if (user?.role === 'SUPER_ADMIN') return;
    await this.validateMemberRole(orgId, userId, ['OWNER', 'ADMIN']);
  }

  async addRosterEntry(
    orgId: string,
    userId: string,
    dto: { name: string; shortName?: string; logoUrl?: string },
  ) {
    const org = await this.db.organization.findUnique({ where: { id: orgId } });
    if (!org) throw new NotFoundException('Organization not found');
    await this.validateRosterAccess(orgId, userId);

    const existing = await this.db.rosterEntry.findUnique({
      where: {
        organizationId_name: { organizationId: orgId, name: dto.name },
      },
    });
    if (existing) {
      throw new ConflictException(
        `"${dto.name}" is already on this organization's roster`,
      );
    }

    const entry = await this.db.rosterEntry.create({
      data: {
        organizationId: orgId,
        name: dto.name,
        shortName: dto.shortName,
        logoUrl: dto.logoUrl,
      },
    });

    return ResponseUtil.success(entry, 'Roster entry added successfully');
  }

  async updateRosterEntry(
    orgId: string,
    entryId: string,
    userId: string,
    dto: { name?: string; shortName?: string; logoUrl?: string | null },
  ) {
    const entry = await this.db.rosterEntry.findUnique({
      where: { id: entryId },
    });
    if (!entry || entry.organizationId !== orgId) {
      throw new NotFoundException('Roster entry not found');
    }
    await this.validateRosterAccess(orgId, userId);

    if (dto.name && dto.name !== entry.name) {
      const existing = await this.db.rosterEntry.findUnique({
        where: {
          organizationId_name: { organizationId: orgId, name: dto.name },
        },
      });
      if (existing) {
        throw new ConflictException(
          `"${dto.name}" is already on this organization's roster`,
        );
      }
    }

    const updated = await this.db.rosterEntry.update({
      where: { id: entryId },
      data: {
        name: dto.name,
        shortName: dto.shortName,
        logoUrl: dto.logoUrl,
      },
    });

    return ResponseUtil.success(updated, 'Roster entry updated successfully');
  }

  async removeRosterEntry(orgId: string, entryId: string, userId: string) {
    const entry = await this.db.rosterEntry.findUnique({
      where: { id: entryId },
    });
    if (!entry || entry.organizationId !== orgId) {
      throw new NotFoundException('Roster entry not found');
    }
    await this.validateRosterAccess(orgId, userId);

    await this.db.rosterEntry.delete({ where: { id: entryId } });

    return ResponseUtil.success(null, 'Roster entry removed successfully');
  }

  async update(id: string, dto: any) {
    const org = await this.db.organization.findUnique({ where: { id } });
    if (!org) {
      throw new NotFoundException('Organization not found');
    }

    const updated = await this.db.organization.update({
      where: { id },
      data: dto,
    });

    return ResponseUtil.success(updated, 'Organization updated successfully');
  }

  async findAllMembers(organizationId: string) {
    const members = await this.db.organizationMember.findMany({
      where: { organizationId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            picture: true,
          },
        },
      },
      orderBy: { role: 'asc' },
    });

    return ResponseUtil.success(members, 'Members retrieved successfully');
  }

  async addMember(
    organizationId: string,
    email: string,
    role: OrganizationRole,
  ) {
    // Find user by email
    const user = await this.db.user.findUnique({ where: { email } });
    if (!user) {
      throw new NotFoundException(`User with email ${email} not found.`);
    }

    // Check if already a member
    const existingMember = await this.db.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId,
          userId: user.id,
        },
      },
    });

    if (existingMember) {
      throw new ConflictException(
        'User is already a member of this organization.',
      );
    }

    const member = await this.db.organizationMember.create({
      data: {
        organizationId,
        userId: user.id,
        role,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            picture: true,
          },
        },
      },
    });

    // Ensure user has ORGANIZER role
    if (user.role !== 'ORGANIZER') {
      await this.db.user.update({
        where: { id: user.id },
        data: { role: 'ORGANIZER' },
      });
    }

    // Emit event for email notification
    const organization = await this.db.organization.findUnique({
      where: { id: organizationId },
    });
    if (organization) {
      this.eventEmitter.emit(EmailEvents.ORGANIZATION_MEMBER_ADDED, {
        email: user.email,
        name: user.name,
        organizationName: organization.name,
        role: role,
      } as OrganizationMemberAddedPayload);
    }

    return ResponseUtil.success(member, 'Member added successfully');
  }

  async updateMemberRole(
    organizationId: string,
    userId: string,
    role: OrganizationRole,
  ) {
    // If demoting an owner, ensure there is at least one other owner
    if (role !== 'OWNER') {
      const owners = await this.db.organizationMember.count({
        where: { organizationId, role: 'OWNER' },
      });
      const currentMember = await this.db.organizationMember.findUnique({
        where: { organizationId_userId: { organizationId, userId } },
      });

      if (currentMember?.role === 'OWNER' && owners <= 1) {
        throw new ForbiddenException(
          'Cannot demote the last owner of the organization.',
        );
      }
    }

    const updated = await this.db.organizationMember.update({
      where: {
        organizationId_userId: {
          organizationId,
          userId,
        },
      },
      data: { role },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            picture: true,
          },
        },
      },
    });

    // Emit event for email notification
    const organization = await this.db.organization.findUnique({
      where: { id: organizationId },
    });
    if (organization) {
      this.eventEmitter.emit(EmailEvents.ORGANIZATION_MEMBER_ROLE_UPDATED, {
        email: updated.user.email,
        name: updated.user.name,
        organizationName: organization.name,
        newRole: role,
      } as OrganizationMemberRoleUpdatedPayload);
    }

    return ResponseUtil.success(updated, 'Member role updated successfully');
  }

  async removeMember(organizationId: string, userId: string) {
    const member = await this.db.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId,
          userId,
        },
      },
    });

    if (!member) {
      throw new NotFoundException('Member not found');
    }

    // Ensure we don't remove the last owner
    if (member.role === 'OWNER') {
      const owners = await this.db.organizationMember.count({
        where: { organizationId, role: 'OWNER' },
      });
      if (owners <= 1) {
        throw new ForbiddenException(
          'Cannot remove the last owner of the organization.',
        );
      }
    }

    const organization = await this.db.organization.findUnique({
      where: { id: organizationId },
    });
    const user = await this.db.user.findUnique({ where: { id: userId } });

    await this.db.organizationMember.delete({
      where: {
        organizationId_userId: {
          organizationId,
          userId,
        },
      },
    });

    // Emit event for email notification
    if (organization && user) {
      this.eventEmitter.emit(EmailEvents.ORGANIZATION_MEMBER_REMOVED, {
        email: user.email,
        name: user.name,
        organizationName: organization.name,
      } as OrganizationMemberRemovedPayload);
    }

    return ResponseUtil.success(null, 'Member removed successfully');
  }

  /**
   * Validates that a user has one of the required roles in an organization.
   * Throws ForbiddenException if not authorized.
   */
  async validateMemberRole(
    organizationId: string,
    userId: string,
    requiredRoles: OrganizationRole[],
  ) {
    const membership = await this.db.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId,
          userId,
        },
      },
    });

    if (!membership || !requiredRoles.includes(membership.role)) {
      throw new ForbiddenException(
        'You do not have the required permissions to perform this action.',
      );
    }

    return membership;
  }

  async getPublicProfile(slug: string) {
    const organization = await this.db.organization.findUnique({
      where: { slug },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        logoUrl: true,
        color: true,
        isVerified: true,
        created_at: true,
        socials: {
          select: {
            id: true,
            platform: true,
            url: true,
            handle: true,
          },
          orderBy: { created_at: 'asc' },
        },
      },
    });

    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    return ResponseUtil.success(
      organization,
      'Organization public profile retrieved successfully',
    );
  }

  async getEventHubBySubdomain(subdomain: string) {
    const organization = await this.db.organization.findUnique({
      where: { subdomain },
      select: {
        id: true,
        name: true,
        slug: true,
        subdomain: true,
        description: true,
        logoUrl: true,
        color: true,
        brandConfig: true,
        isVerified: true,
        socials: {
          select: {
            id: true,
            platform: true,
            url: true,
            handle: true,
          },
          orderBy: { created_at: 'asc' },
        },
        tournaments: {
          where: { visibility: 'PUBLIC' },
          select: {
            id: true,
            name: true,
            customName: true,
            sport: true,
            type: true,
            start_date: true,
            end_date: true,
            logoUrl: true,
            location: true,
          },
          orderBy: { start_date: 'asc' },
        },
      },
    });

    if (!organization) {
      throw new NotFoundException('Event hub not found');
    }

    return ResponseUtil.success(
      organization,
      'Event hub retrieved successfully',
    );
  }

  async getEventHubLive(subdomain: string) {
    const organization = await this.db.organization.findUnique({
      where: { subdomain },
      select: {
        id: true,
        tournaments: {
          where: { visibility: 'PUBLIC' },
          select: {
            id: true,
            name: true,
            customName: true,
            sport: true,
            logoUrl: true,
          },
        },
      },
    });

    if (!organization) {
      throw new NotFoundException('Event hub not found');
    }

    const tournamentIds = organization.tournaments.map((t) => t.id);

    const fixtureSelect = {
      id: true,
      tournament_id: true,
      round: true,
      roundName: true,
      stage: true,
      status: true,
      startTime: true,
      venue: true,
      homeScore: true,
      awayScore: true,
      homePenaltyScore: true,
      awayPenaltyScore: true,
      homeTeamPlaceholder: true,
      awayTeamPlaceholder: true,
      timerStartedAt: true,
      timerElapsedSeconds: true,
      timerIsRunning: true,
      matchDuration: true,
      half: true,
      updated_at: true,
      matchEvents: {
        orderBy: { created_at: 'desc' as const },
        take: 15,
        select: {
          id: true,
          type: true,
          minute: true,
          description: true,
          metadata: true,
          created_at: true,
          participant: {
            select: { customName: true, customShortName: true },
          },
          player: { select: { name: true } },
        },
      },
      homeTeam: {
        select: {
          customName: true,
          customShortName: true,
          logoUrl: true,
          team: { select: { name: true } },
        },
      },
      awayTeam: {
        select: {
          customName: true,
          customShortName: true,
          logoUrl: true,
          team: { select: { name: true } },
        },
      },
      tournament: {
        select: { id: true, name: true, customName: true, sport: true },
      },
    } as const;

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [live, upcoming, results] = await Promise.all([
      this.db.fixture.findMany({
        where: {
          tournament_id: { in: tournamentIds },
          status: { in: ['LIVE', 'EXTRATIME', 'NORMAL_TIME_ENDED'] },
        },
        select: fixtureSelect,
        orderBy: { updated_at: 'desc' },
      }),
      this.db.fixture.findMany({
        where: {
          tournament_id: { in: tournamentIds },
          status: 'SCHEDULED',
          OR: [{ startTime: { gte: startOfToday } }, { startTime: null }],
        },
        select: fixtureSelect,
        orderBy: { startTime: { sort: 'asc', nulls: 'last' } },
        take: 30,
      }),
      this.db.fixture.findMany({
        where: {
          tournament_id: { in: tournamentIds },
          status: 'COMPLETED',
        },
        select: fixtureSelect,
        orderBy: { updated_at: 'desc' },
        take: 20,
      }),
    ]);

    const sports = organization.tournaments.map((t) => {
      const liveCount = live.filter((f) => f.tournament_id === t.id).length;
      const next = upcoming.find((f) => f.tournament_id === t.id);
      const hasResults = results.some((f) => f.tournament_id === t.id);
      return {
        tournamentId: t.id,
        name: t.name,
        customName: t.customName,
        sport: t.sport,
        logoUrl: t.logoUrl,
        liveCount,
        nextStart: next?.startTime ?? null,
        hasResults,
      };
    });

    return ResponseUtil.success(
      { live, upcoming, results, sports },
      'Event hub live data retrieved successfully',
    );
  }

  async getEventHubMedalTable(subdomain: string) {
    const organization = await this.db.organization.findUnique({
      where: { subdomain },
      select: { id: true },
    });

    if (!organization) {
      throw new NotFoundException('Event hub not found');
    }

    // Medal-deciding fixtures: finals (gold/silver) + third-place matches (bronze)
    // across all the org's PUBLIC tournaments.
    const medalFixtures = await this.db.fixture.findMany({
      where: {
        tournament: { organization_id: organization.id, visibility: 'PUBLIC' },
        status: 'COMPLETED',
        roundName: { in: ['Final', 'Third Place Match'] },
      },
      select: {
        roundName: true,
        homeTeamId: true,
        awayTeamId: true,
        homeScore: true,
        awayScore: true,
        homePenaltyScore: true,
        awayPenaltyScore: true,
      },
    });

    const participantIds = [
      ...new Set(
        medalFixtures.flatMap((f) =>
          [f.homeTeamId, f.awayTeamId].filter((id): id is string => !!id),
        ),
      ),
    ];

    const entries = await this.db.tournamentEntry.findMany({
      where: { participantId: { in: participantIds } },
      include: {
        rosterEntry: {
          select: { id: true, name: true, shortName: true, logoUrl: true },
        },
      },
    });

    const rosterByParticipant = new Map(
      entries.map((e) => [e.participantId, e.rosterEntry]),
    );

    type RosterRef = {
      id: string;
      name: string;
      shortName: string | null;
      logoUrl: string | null;
    };
    const table = new Map<
      string,
      { rosterEntry: RosterRef; gold: number; silver: number; bronze: number }
    >();

    // Seed with every roster entry at zero — the table lists all
    // institutions from day one and fills in as medals are won.
    const roster = await this.db.rosterEntry.findMany({
      where: { organizationId: organization.id },
      select: { id: true, name: true, shortName: true, logoUrl: true },
    });
    for (const rosterEntry of roster) {
      table.set(rosterEntry.id, { rosterEntry, gold: 0, silver: 0, bronze: 0 });
    }

    const award = (participantId: string | null, medal: 'gold' | 'silver' | 'bronze') => {
      if (!participantId) return;
      const rosterEntry = rosterByParticipant.get(participantId);
      if (!rosterEntry) return; // not roster-linked: excluded from aggregation
      const row = table.get(rosterEntry.id) ?? {
        rosterEntry,
        gold: 0,
        silver: 0,
        bronze: 0,
      };
      row[medal]++;
      table.set(rosterEntry.id, row);
    };

    const decideWinner = (f: {
      homeTeamId: string | null;
      awayTeamId: string | null;
      homeScore: number | null;
      awayScore: number | null;
      homePenaltyScore: number | null;
      awayPenaltyScore: number | null;
    }): { winnerId: string | null; loserId: string | null } => {
      const { homeTeamId, awayTeamId, homeScore, awayScore } = f;
      if (!homeTeamId || !awayTeamId || homeScore == null || awayScore == null) {
        return { winnerId: null, loserId: null };
      }
      if (homeScore !== awayScore) {
        return homeScore > awayScore
          ? { winnerId: homeTeamId, loserId: awayTeamId }
          : { winnerId: awayTeamId, loserId: homeTeamId };
      }
      const hp = f.homePenaltyScore;
      const ap = f.awayPenaltyScore;
      if (hp != null && ap != null && hp !== ap) {
        return hp > ap
          ? { winnerId: homeTeamId, loserId: awayTeamId }
          : { winnerId: awayTeamId, loserId: homeTeamId };
      }
      return { winnerId: null, loserId: null }; // unresolved draw: skip
    };

    for (const fixture of medalFixtures) {
      const { winnerId, loserId } = decideWinner(fixture);
      if (fixture.roundName === 'Final') {
        award(winnerId, 'gold');
        award(loserId, 'silver');
      } else {
        // Third Place Match
        award(winnerId, 'bronze');
      }
    }

    const rows = [...table.values()]
      .map((r) => ({
        rosterEntryId: r.rosterEntry.id,
        name: r.rosterEntry.name,
        shortName: r.rosterEntry.shortName,
        logoUrl: r.rosterEntry.logoUrl,
        gold: r.gold,
        silver: r.silver,
        bronze: r.bronze,
        total: r.gold + r.silver + r.bronze,
      }))
      .sort(
        (a, b) =>
          b.gold - a.gold || b.silver - a.silver || b.bronze - a.bronze ||
          a.name.localeCompare(b.name),
      );

    return ResponseUtil.success(
      rows,
      'Event hub medal table retrieved successfully',
    );
  }

  async requestDeleteCode(orgId: string, userId: string) {
    const org = await this.db.organization.findUnique({ where: { id: orgId } });
    if (!org) throw new NotFoundException('Organization not found');

    // Only OWNER can delete
    await this.validateMemberRole(orgId, userId, ['OWNER']);

    // Get user info for the email
    const user = await this.db.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    // Count tournaments that will be deleted
    const tournamentCount = await this.db.tournament.count({
      where: { organization_id: orgId },
    });

    // Generate 6-digit code
    const code = Math.floor(100000 + Math.random() * 900000).toString();

    // Store with 10-minute TTL
    deletionCodes.set(orgId, {
      code,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      userId,
    });

    // Auto-cleanup after 10 minutes
    setTimeout(
      () => {
        deletionCodes.delete(orgId);
      },
      10 * 60 * 1000,
    );

    // Emit email event
    this.eventEmitter.emit(EmailEvents.ORGANIZATION_DELETE_CODE, {
      email: user.email,
      name: user.name,
      organizationName: org.name,
      code,
      tournamentCount,
    } as OrganizationDeleteCodePayload);

    return ResponseUtil.success(
      {
        tournamentCount,
        memberCount: await this.db.organizationMember.count({
          where: { organizationId: orgId },
        }),
      },
      'Verification code sent to your email',
    );
  }

  async confirmDelete(orgId: string, userId: string, code: string) {
    const org = await this.db.organization.findUnique({ where: { id: orgId } });
    if (!org) throw new NotFoundException('Organization not found');

    // Only OWNER can delete
    await this.validateMemberRole(orgId, userId, ['OWNER']);

    // Validate code
    const stored = deletionCodes.get(orgId);
    if (!stored) {
      throw new BadRequestException(
        'No deletion code found. Please request a new code.',
      );
    }

    if (stored.userId !== userId) {
      throw new ForbiddenException('This deletion code was not issued to you.');
    }

    if (new Date() > stored.expiresAt) {
      deletionCodes.delete(orgId);
      throw new BadRequestException(
        'Verification code has expired. Please request a new one.',
      );
    }

    if (stored.code !== code) {
      throw new BadRequestException('Invalid verification code.');
    }

    // Code is valid — delete everything in a transaction
    await this.db.$transaction(async (tx) => {
      // Get all tournament IDs under this org
      const tournaments = await tx.tournament.findMany({
        where: { organization_id: orgId },
        select: { id: true },
      });

      const tournamentIds = tournaments.map((t) => t.id);

      if (tournamentIds.length > 0) {
        // Delete all tournament-related data
        await tx.matchEvent.deleteMany({
          where: { fixture: { tournament_id: { in: tournamentIds } } },
        });
        await tx.fixture.deleteMany({
          where: { tournament_id: { in: tournamentIds } },
        });
        await tx.standing.deleteMany({
          where: { tournament_id: { in: tournamentIds } },
        });
        await tx.player.deleteMany({
          where: { participant: { tournament_id: { in: tournamentIds } } },
        });
        await tx.teamInvite.deleteMany({
          where: { tournament_id: { in: tournamentIds } },
        });
        await tx.participant.deleteMany({
          where: { tournament_id: { in: tournamentIds } },
        });
        await tx.group.deleteMany({
          where: { tournament_id: { in: tournamentIds } },
        });
        await tx.sponsor.deleteMany({
          where: { tournament_id: { in: tournamentIds } },
        });
        await tx.social.deleteMany({
          where: { tournament_id: { in: tournamentIds } },
        });
        await tx.venue.deleteMany({
          where: { tournament_id: { in: tournamentIds } },
        });
        await tx.tournamentFollower.deleteMany({
          where: { tournamentId: { in: tournamentIds } },
        });
        await tx.tournament.deleteMany({ where: { organization_id: orgId } });
      }

      // Delete org-level socials and members, then the org itself
      await tx.social.deleteMany({ where: { organization_id: orgId } });
      await tx.organizationMember.deleteMany({
        where: { organizationId: orgId },
      });
      await tx.organization.delete({ where: { id: orgId } });
    });

    // Clean up the code
    deletionCodes.delete(orgId);

    return ResponseUtil.success(null, 'Organization deleted successfully');
  }

  private generateSlug(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
}
