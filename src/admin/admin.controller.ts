import {
  Controller,
  Get,
  Delete,
  Patch,
  Param,
  Query,
  Body,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { Role } from 'src/auth/enums/role.enum';

@ApiTags('admin')
@Controller('admin')
@Roles(Role.SUPER_ADMIN)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

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
  deleteUser(@Param('id') id: string) {
    return this.adminService.deleteUser(id);
  }

  @Patch('users/:id/role')
  @ApiOperation({ summary: 'Update user role' })
  updateUserRole(
    @Param('id') id: string,
    @Body('role') role: string,
  ) {
    return this.adminService.updateUserRole(id, role);
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
  deleteTournament(@Param('id') id: string) {
    return this.adminService.deleteTournament(id);
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
  updatePlayerStatus(
    @Param('id') id: string,
    @Body('status') status: 'APPROVED' | 'REJECTED',
  ) {
    return this.adminService.updatePlayerStatus(id, status);
  }

  // ─── Health ────────────────────────────────────────────────

  @Get('health')
  @ApiOperation({ summary: 'Get system health status' })
  getHealth() {
    return this.adminService.getHealth();
  }
}
