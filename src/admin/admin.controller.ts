import {
  Controller,
  Get,
  Delete,
  Patch,
  Param,
  Query,
  Body,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { Role } from 'src/auth/enums/role.enum';
import { User } from 'src/auth/decorators/user.decorator';
import { SubscriptionPlan, SubscriptionStatus } from 'prisma/generated/client';
import {
  AuditLogsService,
  AuditAction,
  AuditEntityType,
} from 'src/audit-logs/audit-logs.service';

@ApiTags('admin')
@Controller('admin')
@Roles(Role.SUPER_ADMIN)
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  // ─── Stats ─────────────────────────────────────────────────

  @Get('stats')
  @ApiOperation({ summary: 'Get platform overview stats' })
  getStats() {
    return this.adminService.getStats();
  }

  // ─── Users ─────────────────────────────────────────────────

  @Get('users')
  @ApiOperation({ summary: 'Get all users (paginated)' })
  getUsers(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('role') role?: string,
  ) {
    return this.adminService.getUsers(
      Number(page) || 1,
      Number(limit) || 20,
      search,
      role,
    );
  }

  @Get('users/:id')
  @ApiOperation({ summary: 'Get user details' })
  getUser(@Param('id') id: string) {
    return this.adminService.getUser(id);
  }

  @Delete('users/:id')
  @ApiOperation({ summary: 'Delete a user' })
  async deleteUser(
    @Param('id') id: string,
    @User() user: { id: string },
    @Req() req: { ip?: string },
  ) {
    const result = await this.adminService.deleteUser(id);
    await this.auditLogsService.create({
      actorId: user.id,
      action: AuditAction.USER_DELETE,
      entityType: AuditEntityType.USER,
      entityId: id,
      ipAddress: req?.ip,
    });
    return result;
  }

  @Patch('users/:id/role')
  @ApiOperation({ summary: 'Update user role' })
  async updateUserRole(
    @Param('id') id: string,
    @Body('role') role: string,
    @User() user: { id: string },
    @Req() req: { ip?: string },
  ) {
    const result = await this.adminService.updateUserRole(id, role);
    await this.auditLogsService.create({
      actorId: user.id,
      action: AuditAction.USER_ROLE_UPDATE,
      entityType: AuditEntityType.USER,
      entityId: id,
      metadata: { role },
      ipAddress: req?.ip,
    });
    return result;
  }

  // ─── Tournaments ───────────────────────────────────────────

  @Get('tournaments')
  @ApiOperation({ summary: 'Get all tournaments (paginated)' })
  getTournaments(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('sport') sport?: string,
  ) {
    return this.adminService.getTournaments(
      Number(page) || 1,
      Number(limit) || 20,
      search,
      sport,
    );
  }

  @Delete('tournaments/:id')
  @ApiOperation({ summary: 'Delete a tournament' })
  async deleteTournament(
    @Param('id') id: string,
    @User() user: { id: string },
    @Req() req: { ip?: string },
  ) {
    const result = await this.adminService.deleteTournament(id);
    await this.auditLogsService.create({
      actorId: user.id,
      action: AuditAction.TOURNAMENT_DELETE,
      entityType: AuditEntityType.TOURNAMENT,
      entityId: id,
      ipAddress: req?.ip,
    });
    return result;
  }

  @Patch('tournaments/:id/pricing')
  @ApiOperation({ summary: 'Update tournament pricing' })
  async updateTournamentPricing(
    @Param('id') id: string,
    @Body()
    body: { tournamentPrice?: number | null; paymentPerTeam?: number | null },
    @User() user: { id: string },
    @Req() req: { ip?: string },
  ) {
    const result = await this.adminService.updateTournamentPricing(id, body);
    await this.auditLogsService.create({
      actorId: user.id,
      action: AuditAction.TOURNAMENT_PRICING_UPDATE,
      entityType: AuditEntityType.TOURNAMENT,
      entityId: id,
      metadata: { ...body },
      ipAddress: req?.ip,
    });
    return result;
  }

  // ─── Organizations ─────────────────────────────────────────

  @Get('organizations')
  @ApiOperation({ summary: 'Get all organizations (paginated)' })
  getOrganizations(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    return this.adminService.getOrganizations(
      Number(page) || 1,
      Number(limit) || 20,
      search,
    );
  }

  @Get('organizations/:id')
  @ApiOperation({ summary: 'Get organization details' })
  getOrganization(@Param('id') id: string) {
    return this.adminService.getOrganization(id);
  }

  @Patch('organizations/:id/verify')
  @ApiOperation({ summary: 'Verify or unverify an organization' })
  async updateOrganizationVerification(
    @Param('id') id: string,
    @Body('isVerified') isVerified: boolean,
    @User() user: { id: string },
    @Req() req: { ip?: string },
  ) {
    const result = await this.adminService.updateOrganizationVerification(
      id,
      isVerified,
    );
    await this.auditLogsService.create({
      actorId: user.id,
      action: AuditAction.ORGANIZATION_VERIFY,
      entityType: AuditEntityType.ORGANIZATION,
      entityId: id,
      metadata: { isVerified },
      ipAddress: req?.ip,
    });
    return result;
  }

  @Patch('organizations/:id/subscription')
  @ApiOperation({ summary: 'Update organization subscription' })
  async updateOrganizationSubscription(
    @Param('id') id: string,
    @Body()
    body: {
      plan?: SubscriptionPlan;
      status?: SubscriptionStatus;
      currentPeriodEnd?: string;
    },
    @User() user: { id: string },
    @Req() req: { ip?: string },
  ) {
    const result = await this.adminService.updateOrganizationSubscription(
      id,
      body,
    );
    await this.auditLogsService.create({
      actorId: user.id,
      action: AuditAction.ORGANIZATION_SUBSCRIPTION_UPDATE,
      entityType: AuditEntityType.ORGANIZATION,
      entityId: id,
      metadata: { ...body },
      ipAddress: req?.ip,
    });
    return result;
  }

  // ─── Payments ──────────────────────────────────────────────

  @Get('payments')
  @ApiOperation({ summary: 'Get all payments (paginated)' })
  getPayments(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('type') type?: string,
  ) {
    return this.adminService.getPayments(
      Number(page) || 1,
      Number(limit) || 20,
      status,
      type,
    );
  }

  @Get('payments/summary')
  @ApiOperation({ summary: 'Get revenue summary' })
  getPaymentsSummary() {
    return this.adminService.getPaymentsSummary();
  }

  // ─── Players ───────────────────────────────────────────────

  @Get('players/pending')
  @ApiOperation({ summary: 'Get all pending player requests' })
  getPendingPlayers(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adminService.getPendingPlayers(
      Number(page) || 1,
      Number(limit) || 20,
    );
  }

  @Patch('players/:id/status')
  @ApiOperation({ summary: 'Approve or reject a player' })
  async updatePlayerStatus(
    @Param('id') id: string,
    @Body('status') status: 'APPROVED' | 'REJECTED',
    @User() user: { id: string },
    @Req() req: { ip?: string },
  ) {
    const result = await this.adminService.updatePlayerStatus(id, status);
    await this.auditLogsService.create({
      actorId: user.id,
      action: AuditAction.PLAYER_STATUS_UPDATE,
      entityType: AuditEntityType.PLAYER,
      entityId: id,
      metadata: { status },
      ipAddress: req?.ip,
    });
    return result;
  }

  // ─── Health ────────────────────────────────────────────────

  @Get('health')
  @ApiOperation({ summary: 'Get system health status' })
  getHealth() {
    return this.adminService.getHealth();
  }

  // ─── Audit Logs ────────────────────────────────────────────

  @Get('audit-logs')
  @ApiOperation({ summary: 'Get admin audit logs' })
  getAuditLogs(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('action') action?: string,
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
    @Query('actorId') actorId?: string,
  ) {
    return this.auditLogsService.findAll({
      page: Number(page) || 1,
      limit: Number(limit) || 20,
      action,
      entityType,
      entityId,
      actorId,
    });
  }

  @Get('audit-logs/recent')
  @ApiOperation({ summary: 'Get recent admin audit logs' })
  getRecentAuditLogs(@Query('limit') limit?: string) {
    return this.auditLogsService.findRecent(Number(limit) || 10);
  }
}
