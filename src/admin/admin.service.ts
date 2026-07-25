import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import { ResponseUtil } from 'src/utils/api-response';
import {
  Prisma,
  SubscriptionPlan,
  SubscriptionStatus,
} from 'prisma/generated/client';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(private readonly db: DatabaseService) {}

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
    const startTime = Date.now();
    let dbStatus = 'up';
    let dbLatency = 0;

    try {
      const dbStart = Date.now();
      await this.db.$queryRaw`SELECT 1`;
      dbLatency = Date.now() - dbStart;
    } catch {
      dbStatus = 'down';
    }

    return ResponseUtil.success({
      status: dbStatus === 'up' ? 'healthy' : 'degraded',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      database: {
        status: dbStatus,
        latency: `${dbLatency}ms`,
      },
      memory: {
        rss: `${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB`,
        heapUsed: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
        heapTotal: `${Math.round(process.memoryUsage().heapTotal / 1024 / 1024)}MB`,
      },
      node: process.version,
      environment: process.env.NODE_ENV || 'development',
    });
  }
}
