import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import * as os from 'os';
import * as fs from 'fs';
import { DatabaseService } from 'src/database/database.service';
import { RedisService } from 'src/redis/redis.service';
import { ResponseUtil } from 'src/utils/api-response';
import {
  Prisma,
  SubscriptionPlan,
  SubscriptionStatus,
  Visibility,
  TournamentType,
} from 'prisma/generated/client';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly redisService: RedisService,
  ) {}

  // ─── Platform Stats ────────────────────────────────────────

  async getStats() {
    const [
      totalUsers,
      totalTournaments,
      totalOrganizations,
      totalPayments,
      totalPlayers,
      totalFixtures,
      pendingPlayers,
      recentUsers,
      recentPayments,
      revenueResult,
      monthlyRevenueResult,
      botCallsResult,
    ] = await Promise.all([
      this.db.user.count(),
      this.db.tournament.count(),
      this.db.organization.count(),
      this.db.payment.count({ where: { status: 'SUCCESS' } }),
      this.db.player.count(),
      this.db.fixture.count(),
      this.db.player.count({ where: { status: 'PENDING' } }),
      this.db.user.findMany({
        take: 10,
        orderBy: { created_at: 'desc' },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          picture: true,
          isEmailVerified: true,
          created_at: true,
        },
      }),
      this.db.payment.findMany({
        take: 10,
        orderBy: { created_at: 'desc' },
        select: {
          id: true,
          amount: true,
          currency: true,
          status: true,
          type: true,
          paystackReference: true,
          created_at: true,
          user: { select: { id: true, name: true, email: true } },
        },
      }),
      this.db.payment.aggregate({
        where: { status: 'SUCCESS' },
        _sum: { amount: true },
      }),
      this.db.payment.aggregate({
        where: {
          status: 'SUCCESS',
          created_at: {
            gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
          },
        },
        _sum: { amount: true },
      }),
      // Paragee (AI bot) calls answered across all tournaments
      this.db.tournament.aggregate({
        _sum: { botCalls: true },
      }),
    ]);

    return ResponseUtil.success({
      counts: {
        users: totalUsers,
        tournaments: totalTournaments,
        organizations: totalOrganizations,
        payments: totalPayments,
        players: totalPlayers,
        fixtures: totalFixtures,
        pendingPlayers,
        botCalls: botCallsResult._sum.botCalls || 0,
      },
      revenue: {
        total: revenueResult._sum.amount || 0,
        thisMonth: monthlyRevenueResult._sum.amount || 0,
      },
      recentUsers,
      recentPayments,
    });
  }

  // ─── Users ─────────────────────────────────────────────────

  async getUsers(
    page: number = 1,
    limit: number = 20,
    search?: string,
    role?: string,
  ) {
    const skip = (page - 1) * limit;
    const where: any = {};

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (role) {
      where.role = role;
    }

    const [users, total] = await Promise.all([
      this.db.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { created_at: 'desc' },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          picture: true,
          isEmailVerified: true,
          created_at: true,
          updated_at: true,
          _count: {
            select: {
              organizations: true,
              player_profiles: true,
              payments: true,
            },
          },
        },
      }),
      this.db.user.count({ where }),
    ]);

    return ResponseUtil.paginated(users, page, limit, total);
  }

  async getUser(id: string) {
    const user = await this.db.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        picture: true,
        isEmailVerified: true,
        created_at: true,
        updated_at: true,
        organizations: {
          include: { organization: true },
        },
        player_profiles: {
          include: {
            participant: {
              include: {
                tournament: {
                  select: { id: true, name: true, customName: true },
                },
              },
            },
          },
        },
        payments: {
          take: 20,
          orderBy: { created_at: 'desc' },
          select: {
            id: true,
            amount: true,
            currency: true,
            status: true,
            type: true,
            created_at: true,
          },
        },
      },
    });

    if (!user) throw new NotFoundException('User not found');
    return ResponseUtil.success(user);
  }

  async deleteUser(id: string) {
    const user = await this.db.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    if (user.role === 'SUPER_ADMIN') {
      throw new BadRequestException('Cannot delete a Super Admin user');
    }

    await this.db.user.delete({ where: { id } });
    return ResponseUtil.success(null, 'User deleted successfully');
  }

  async updateUserRole(id: string, role: string) {
    const user = await this.db.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');

    if (role === 'SUPER_ADMIN' && !user.email.endsWith('@parascores.com')) {
      throw new BadRequestException(
        'Only @parascores.com emails can be promoted to Super Admin',
      );
    }

    const updated = await this.db.user.update({
      where: { id },
      data: { role: role as any },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
      },
    });

    return ResponseUtil.success(updated, 'User role updated');
  }

  // ─── Tournaments ───────────────────────────────────────────

  async getTournaments(
    page: number = 1,
    limit: number = 20,
    search?: string,
    sport?: string,
  ) {
    const skip = (page - 1) * limit;
    const where: any = {};

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { customName: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (sport) {
      where.sport = { equals: sport, mode: 'insensitive' };
    }

    const [tournaments, total] = await Promise.all([
      this.db.tournament.findMany({
        where,
        skip,
        take: limit,
        orderBy: { created_at: 'desc' },
        select: {
          id: true,
          name: true,
          customName: true,
          sport: true,
          type: true,
          visibility: true,
          isPremium: true,
          logoUrl: true,
          start_date: true,
          end_date: true,
          created_at: true,
          tournamentPrice: true,
          paymentPerTeam: true,
          organization: { select: { id: true, name: true, slug: true } },
          _count: {
            select: {
              participants: true,
              fixtures: true,
              followers: true,
            },
          },
        },
      }),
      this.db.tournament.count({ where }),
    ]);

    return ResponseUtil.paginated(tournaments, page, limit, total);
  }

  async getTournament(id: string) {
    const tournament = await this.db.tournament.findUnique({
      where: { id },
      include: {
        organization: {
          select: {
            id: true,
            name: true,
            slug: true,
            isVerified: true,
          },
        },
        participants: {
          orderBy: { created_at: 'desc' },
          select: {
            id: true,
            customName: true,
            customShortName: true,
            status: true,
            seed: true,
            logoUrl: true,
            created_at: true,
            team: { select: { id: true, name: true, shortName: true } },
            user: { select: { id: true, name: true, email: true } },
          },
        },
        fixtures: {
          orderBy: [
            { round: 'asc' },
            { matchNumber: 'asc' },
          ],
          include: {
            homeTeam: {
              select: {
                id: true,
                customName: true,
                customShortName: true,
                logoUrl: true,
              },
            },
            awayTeam: {
              select: {
                id: true,
                customName: true,
                customShortName: true,
                logoUrl: true,
              },
            },
          },
        },
        standings: {
          orderBy: [
            { group: 'asc' },
            { points: 'desc' },
          ],
          include: {
            participant: {
              select: {
                id: true,
                customName: true,
                customShortName: true,
                logoUrl: true,
              },
            },
          },
        },
        groups: {
          orderBy: { created_at: 'asc' },
          select: { id: true, name: true },
        },
        socials: {
          select: { id: true, platform: true, url: true },
        },
        sponsors: {
          select: { id: true, name: true, logoUrl: true, description: true },
        },
        payments: {
          take: 20,
          orderBy: { created_at: 'desc' },
          select: {
            id: true,
            amount: true,
            currency: true,
            status: true,
            type: true,
            created_at: true,
          },
        },
        _count: {
          select: {
            participants: true,
            fixtures: true,
            followers: true,
          },
        },
      },
    });

    if (!tournament) throw new NotFoundException('Tournament not found');

    const normalized = {
      ...tournament,
      payments: tournament.payments.map((p: any) => ({
        ...p,
        amount: p.amount / 100,
      })),
    };

    return ResponseUtil.success(normalized);
  }

  async deleteTournament(id: string) {
    const tournament = await this.db.tournament.findUnique({ where: { id } });
    if (!tournament) throw new NotFoundException('Tournament not found');

    await this.db.tournament.delete({ where: { id } });
    return ResponseUtil.success(null, 'Tournament deleted successfully');
  }

  async updateTournamentPricing(
    id: string,
    data: { tournamentPrice?: number | null; paymentPerTeam?: number | null },
  ) {
    const tournament = await this.db.tournament.findUnique({ where: { id } });
    if (!tournament) throw new NotFoundException('Tournament not found');

    const updateData: any = {};
    if (data.tournamentPrice !== undefined) {
      updateData.tournamentPrice = data.tournamentPrice ?? 0;
    }
    if (data.paymentPerTeam !== undefined) {
      updateData.paymentPerTeam = data.paymentPerTeam ?? 0;
    }

    const updated = await this.db.tournament.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        name: true,
        tournamentPrice: true,
        paymentPerTeam: true,
      },
    });

    return ResponseUtil.success(updated, 'Tournament pricing updated');
  }

  async updateTournament(
    id: string,
    data: {
      name?: string;
      customName?: string | null;
      description?: string | null;
      visibility?: 'PUBLIC' | 'PRIVATE' | 'UNLISTED';
      isPremium?: boolean;
      isPinned?: boolean;
      isPaidRegistration?: boolean;
      registrationFee?: number;
      tournamentPrice?: number;
      paymentPerTeam?: number;
      startDate?: string;
      endDate?: string;
      location?: string | null;
      timezone?: string;
      maxParticipants?: number | null;
      sport?: string;
      type?: 'LEAGUE' | 'KNOCKOUT' | 'ROUND_ROBIN' | 'GROUP' | 'HYBRID' | 'FRIENDLY';
      autoApprove?: boolean;
      thirdPlaceMatch?: boolean;
      twoLegsKnockout?: boolean;
      doubleRoundRobin?: boolean;
    },
  ) {
    const tournament = await this.db.tournament.findUnique({ where: { id } });
    if (!tournament) throw new NotFoundException('Tournament not found');

    const updateData: any = {};

    if (data.name !== undefined) updateData.name = data.name;
    if (data.customName !== undefined) updateData.customName = data.customName;
    if (data.description !== undefined)
      updateData.description = data.description;
    if (data.visibility !== undefined) {
      const validVisibilities = Object.values(Visibility);
      if (!validVisibilities.includes(data.visibility)) {
        throw new BadRequestException(
          `Invalid visibility. Valid values: ${validVisibilities.join(', ')}`,
        );
      }
      updateData.visibility = data.visibility;
    }
    if (data.isPremium !== undefined) updateData.isPremium = data.isPremium;
    if (data.isPinned !== undefined) updateData.isPinned = data.isPinned;
    if (data.isPaidRegistration !== undefined)
      updateData.isPaidRegistration = data.isPaidRegistration;
    if (data.registrationFee !== undefined)
      updateData.registrationFee = Math.round(data.registrationFee * 100);
    if (data.tournamentPrice !== undefined)
      updateData.tournamentPrice = Math.round(data.tournamentPrice * 100);
    if (data.paymentPerTeam !== undefined)
      updateData.paymentPerTeam = Math.round(data.paymentPerTeam * 100);
    if (data.startDate !== undefined) {
      const startDate = new Date(data.startDate);
      if (isNaN(startDate.getTime())) {
        throw new BadRequestException('Invalid startDate');
      }
      updateData.start_date = startDate;
    }
    if (data.endDate !== undefined) {
      const endDate = new Date(data.endDate);
      if (isNaN(endDate.getTime())) {
        throw new BadRequestException('Invalid endDate');
      }
      updateData.end_date = endDate;
    }
    if (data.location !== undefined) updateData.location = data.location;
    if (data.timezone !== undefined) updateData.timezone = data.timezone;
    if (data.maxParticipants !== undefined)
      updateData.maxParticipants = data.maxParticipants;
    if (data.sport !== undefined) updateData.sport = data.sport;
    if (data.type !== undefined) {
      const validTypes = Object.values(TournamentType);
      if (!validTypes.includes(data.type)) {
        throw new BadRequestException(
          `Invalid tournament type. Valid values: ${validTypes.join(', ')}`,
        );
      }
      updateData.type = data.type;
    }
    if (data.autoApprove !== undefined)
      updateData.autoApprove = data.autoApprove;
    if (data.thirdPlaceMatch !== undefined)
      updateData.thirdPlaceMatch = data.thirdPlaceMatch;
    if (data.twoLegsKnockout !== undefined)
      updateData.twoLegsKnockout = data.twoLegsKnockout;
    if (data.doubleRoundRobin !== undefined)
      updateData.doubleRoundRobin = data.doubleRoundRobin;

    const updated = await this.db.tournament.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        name: true,
        customName: true,
        description: true,
        visibility: true,
        isPremium: true,
        isPinned: true,
        isPaidRegistration: true,
        registrationFee: true,
        tournamentPrice: true,
        paymentPerTeam: true,
        start_date: true,
        end_date: true,
        location: true,
        timezone: true,
        maxParticipants: true,
        sport: true,
        type: true,
        autoApprove: true,
        thirdPlaceMatch: true,
        twoLegsKnockout: true,
        doubleRoundRobin: true,
        updated_at: true,
      },
    });

    return ResponseUtil.success(updated, 'Tournament updated successfully');
  }

  // ─── Organizations ─────────────────────────────────────────

  async getOrganizations(
    page: number = 1,
    limit: number = 20,
    search?: string,
  ) {
    const skip = (page - 1) * limit;
    const where: any = {};

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { slug: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [organizations, total] = await Promise.all([
      this.db.organization.findMany({
        where,
        skip,
        take: limit,
        orderBy: { created_at: 'desc' },
        select: {
          id: true,
          name: true,
          slug: true,
          logoUrl: true,
          isVerified: true,
          created_at: true,
          _count: {
            select: {
              members: true,
              tournaments: true,
            },
          },
          subscription: {
            select: {
              plan: true,
              status: true,
            },
          },
        },
      }),
      this.db.organization.count({ where }),
    ]);

    return ResponseUtil.paginated(organizations, page, limit, total);
  }

  async getOrganization(id: string) {
    const org = await this.db.organization.findUnique({
      where: { id },
      include: {
        members: {
          include: {
            user: {
              select: { id: true, name: true, email: true, picture: true },
            },
          },
        },
        tournaments: {
          select: {
            id: true,
            name: true,
            customName: true,
            sport: true,
            type: true,
            created_at: true,
            isPremium: true,
            _count: { select: { participants: true } },
          },
          orderBy: { created_at: 'desc' },
        },
        subscription: true,
        payments: {
          take: 20,
          orderBy: { created_at: 'desc' },
          select: {
            id: true,
            amount: true,
            currency: true,
            status: true,
            type: true,
            created_at: true,
          },
        },
      },
    });

    if (!org) throw new NotFoundException('Organization not found');
    return ResponseUtil.success(org);
  }

  async updateOrganizationVerification(id: string, isVerified: boolean) {
    const org = await this.db.organization.findUnique({ where: { id } });
    if (!org) throw new NotFoundException('Organization not found');

    const updated = await this.db.organization.update({
      where: { id },
      data: { isVerified },
      select: {
        id: true,
        name: true,
        slug: true,
        isVerified: true,
      },
    });

    this.logger.log(
      `Organization ${id} verification set to ${isVerified} by admin`,
    );

    return ResponseUtil.success(
      updated,
      `Organization ${isVerified ? 'verified' : 'unverified'} successfully`,
    );
  }

  async updateOrganizationSubscription(
    id: string,
    data: {
      plan?: SubscriptionPlan;
      status?: SubscriptionStatus;
      currentPeriodEnd?: string;
    },
  ) {
    const org = await this.db.organization.findUnique({
      where: { id },
      include: { subscription: true },
    });
    if (!org) throw new NotFoundException('Organization not found');

    const updateData: Prisma.SubscriptionUpdateInput = {};
    if (data.plan !== undefined) {
      const validPlans = Object.values(SubscriptionPlan);
      if (!validPlans.includes(data.plan)) {
        throw new BadRequestException(
          `Invalid plan. Valid plans: ${validPlans.join(', ')}`,
        );
      }
      updateData.plan = data.plan;
    }
    if (data.status !== undefined) {
      const validStatuses = Object.values(SubscriptionStatus);
      if (!validStatuses.includes(data.status)) {
        throw new BadRequestException(
          `Invalid status. Valid statuses: ${validStatuses.join(', ')}`,
        );
      }
      updateData.status = data.status;
    }
    if (data.currentPeriodEnd !== undefined) {
      const date = new Date(data.currentPeriodEnd);
      if (isNaN(date.getTime())) {
        throw new BadRequestException('Invalid currentPeriodEnd date');
      }
      updateData.currentPeriodEnd = date;
    }

    let subscription;
    if (org.subscription) {
      subscription = await this.db.subscription.update({
        where: { organizationId: id },
        data: updateData,
      });
    } else {
      subscription = await this.db.subscription.create({
        data: {
          organizationId: id,
          plan: data.plan || SubscriptionPlan.FREE,
          status: data.status || SubscriptionStatus.ACTIVE,
          ...(data.currentPeriodEnd
            ? { currentPeriodEnd: new Date(data.currentPeriodEnd) }
            : {}),
        },
      });
    }

    this.logger.log(
      `Organization ${id} subscription updated by admin: ${JSON.stringify(updateData)}`,
    );

    return ResponseUtil.success(
      subscription,
      'Organization subscription updated successfully',
    );
  }

  // ─── Payments ──────────────────────────────────────────────

  async getPayments(
    page: number = 1,
    limit: number = 20,
    status?: string,
    type?: string,
  ) {
    const skip = (page - 1) * limit;
    const where: any = {};

    if (status) where.status = status;
    if (type) where.type = type;

    const [payments, total] = await Promise.all([
      this.db.payment.findMany({
        where,
        skip,
        take: limit,
        orderBy: { created_at: 'desc' },
        select: {
          id: true,
          amount: true,
          currency: true,
          status: true,
          type: true,
          paystackReference: true,
          created_at: true,
          user: { select: { id: true, name: true, email: true } },
          organization: { select: { id: true, name: true } },
          tournament: { select: { id: true, name: true } },
        },
      }),
      this.db.payment.count({ where }),
    ]);

    return ResponseUtil.paginated(payments, page, limit, total);
  }

  async getPaymentsSummary() {
    const [totalRevenue, monthlyRevenue, revenueByType] = await Promise.all([
      this.db.payment.aggregate({
        where: { status: 'SUCCESS' },
        _sum: { amount: true },
        _count: true,
      }),
      this.db.payment.aggregate({
        where: {
          status: 'SUCCESS',
          created_at: {
            gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
          },
        },
        _sum: { amount: true },
        _count: true,
      }),
      this.db.payment.groupBy({
        by: ['type'],
        where: { status: 'SUCCESS' },
        _sum: { amount: true },
        _count: true,
      }),
    ]);

    return ResponseUtil.success({
      total: {
        amount: totalRevenue._sum.amount || 0,
        count: totalRevenue._count,
      },
      thisMonth: {
        amount: monthlyRevenue._sum.amount || 0,
        count: monthlyRevenue._count,
      },
      byType: revenueByType.map((r) => ({
        type: r.type,
        amount: r._sum.amount || 0,
        count: r._count,
      })),
    });
  }

  // ─── Pending Players ───────────────────────────────────────

  async getPendingPlayers(page: number = 1, limit: number = 20) {
    const skip = (page - 1) * limit;
    const where = { status: 'PENDING' as const };

    const [players, total] = await Promise.all([
      this.db.player.findMany({
        where,
        skip,
        take: limit,
        orderBy: { created_at: 'desc' },
        include: {
          user: {
            select: { id: true, name: true, email: true, picture: true },
          },
          participant: {
            select: {
              id: true,
              customName: true,
              tournament: {
                select: { id: true, name: true, customName: true },
              },
            },
          },
        },
      }),
      this.db.player.count({ where }),
    ]);

    return ResponseUtil.paginated(players, page, limit, total);
  }

  async updatePlayerStatus(id: string, status: 'APPROVED' | 'REJECTED') {
    const player = await this.db.player.findUnique({ where: { id } });
    if (!player) throw new NotFoundException('Player not found');

    const updated = await this.db.player.update({
      where: { id },
      data: { status },
      include: {
        user: { select: { id: true, name: true } },
        participant: {
          select: {
            customName: true,
            tournament: { select: { name: true } },
          },
        },
      },
    });

    return ResponseUtil.success(updated, `Player ${status.toLowerCase()}`);
  }

  // ─── Health ────────────────────────────────────────────────

  async getHealth() {
    const checks = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
      this.checkPaystack(),
      this.checkResend(),
    ]);

    const [database, redis, paystack, resend] = checks;

    const overallStatus = checks.every((c) => c.status === 'up')
      ? 'healthy'
      : checks.some((c) => c.status === 'up')
        ? 'degraded'
        : 'down';

    const nodeMemory = process.memoryUsage();
    const systemMemory = {
      free: os.freemem(),
      total: os.totalmem(),
    };

    let disk = null as { free: number; total: number; usedPercent: number } | null;
    try {
      const stats = (fs as any).statfsSync(process.cwd());
      if (stats) {
        const total = stats.blocks * stats.bsize;
        const free = stats.bfree * stats.bsize;
        disk = {
          free,
          total,
          usedPercent: total > 0 ? Math.round(((total - free) / total) * 100) : 0,
        };
      }
    } catch {
      disk = null;
    }

    return ResponseUtil.success({
      status: overallStatus,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      node: process.version,
      environment: process.env.NODE_ENV || 'development',
      platform: `${os.platform()} ${os.arch()}`,
      loadAverage: os.loadavg(),
      cpuCount: os.cpus().length,
      memory: {
        rss: nodeMemory.rss,
        heapUsed: nodeMemory.heapUsed,
        heapTotal: nodeMemory.heapTotal,
        external: nodeMemory.external || 0,
        systemFree: systemMemory.free,
        systemTotal: systemMemory.total,
        systemUsedPercent:
          systemMemory.total > 0
            ? Math.round(
                ((systemMemory.total - systemMemory.free) / systemMemory.total) *
                  100,
              )
            : 0,
      },
      disk,
      dependencies: {
        database,
        redis,
        paystack,
        resend,
      },
    });
  }

  private async checkDatabase() {
    const start = Date.now();
    try {
      await this.db.$queryRaw`SELECT 1`;
      return { status: 'up' as const, latency: Date.now() - start };
    } catch (err) {
      this.logger.error('Health check database failed:', err);
      return { status: 'down' as const, latency: Date.now() - start };
    }
  }

  private async checkRedis() {
    return this.redisService.ping();
  }

  private async checkPaystack() {
    const start = Date.now();
    const secretKey = process.env.PAYSTACK_SECRET_KEY;
    if (!secretKey) {
      return { status: 'down' as const, message: 'PAYSTACK_SECRET_KEY not set' };
    }
    try {
      const res = await fetch('https://api.paystack.co/bank', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${secretKey}`,
        },
      });
      if (res.ok) {
        return { status: 'up' as const, latency: Date.now() - start };
      }
      return {
        status: 'down' as const,
        latency: Date.now() - start,
        message: `Paystack returned ${res.status}`,
      };
    } catch (err) {
      this.logger.error('Health check Paystack failed:', err);
      return { status: 'down' as const, latency: Date.now() - start };
    }
  }

  private async checkResend() {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      return { status: 'down' as const, message: 'RESEND_API_KEY not set' };
    }
    return { status: 'up' as const, message: 'API key configured' };
  }
}
