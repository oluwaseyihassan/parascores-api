import {
  Controller,
  Post,
  Body,
  Req,
  UseGuards,
  Patch,
  Param,
  Get,
  Delete,
} from '@nestjs/common';
import { Public } from 'src/auth/decorators/public.decorator';
import { OrganizationsService } from './organizations.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { AddMemberDto } from './dto/add-member.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';

@ApiTags('organizations')
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new organization' })
  @ApiResponse({
    status: 201,
    description: 'Organization created successfully',
  })
  @ApiResponse({ status: 409, description: 'Organization slug already exists' })
  async create(@Req() req: any, @Body() dto: CreateOrganizationDto) {
    // req.user.sub contains the authenticated user's ID
    return this.organizationsService.create(req.user.sub, dto);
  }

  // Member Management Routes (More specific routes first)
  @Get(':id/members')
  @ApiOperation({ summary: 'Get all members of an organization' })
  async findAllMembers(@Param('id') id: string) {
    return this.organizationsService.findAllMembers(id);
  }

  @Post(':id/members')
  @ApiOperation({ summary: 'Add a member to an organization' })
  async addMember(@Param('id') id: string, @Body() dto: AddMemberDto) {
    return this.organizationsService.addMember(id, dto.email, dto.role);
  }

  @Patch(':id/members/:userId')
  @ApiOperation({ summary: 'Update a member role' })
  async updateMemberRole(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Body() dto: UpdateMemberRoleDto,
  ) {
    return this.organizationsService.updateMemberRole(id, userId, dto.role);
  }

  @Delete(':id/members/:userId')
  @ApiOperation({ summary: 'Remove a member from an organization' })
  async removeMember(@Param('id') id: string, @Param('userId') userId: string) {
    return this.organizationsService.removeMember(id, userId);
  }

  // Roster Routes
  @Get(':id/roster')
  @ApiOperation({ summary: 'List the organization roster' })
  async listRoster(@Param('id') id: string) {
    return this.organizationsService.listRoster(id);
  }

  @Post(':id/roster')
  @ApiOperation({ summary: 'Add an entry to the organization roster' })
  @ApiResponse({ status: 201, description: 'Roster entry added successfully' })
  @ApiResponse({ status: 409, description: 'Entry already on roster' })
  async addRosterEntry(
    @Param('id') id: string,
    @Req() req: any,
    @Body() dto: { name: string; shortName?: string; logoUrl?: string },
  ) {
    return this.organizationsService.addRosterEntry(id, req.user.sub, dto);
  }

  @Patch(':id/roster/:entryId')
  @ApiOperation({ summary: 'Update an organization roster entry' })
  @ApiResponse({ status: 200, description: 'Roster entry updated successfully' })
  @ApiResponse({ status: 409, description: 'Name already on roster' })
  async updateRosterEntry(
    @Param('id') id: string,
    @Param('entryId') entryId: string,
    @Req() req: any,
    @Body() dto: { name?: string; shortName?: string; logoUrl?: string | null },
  ) {
    return this.organizationsService.updateRosterEntry(id, entryId, req.user.sub, dto);
  }

  @Delete(':id/roster/:entryId')
  @ApiOperation({ summary: 'Remove an entry from the organization roster' })
  async removeRosterEntry(
    @Param('id') id: string,
    @Param('entryId') entryId: string,
    @Req() req: any,
  ) {
    return this.organizationsService.removeRosterEntry(id, entryId, req.user.sub);
  }

  // Public Routes
  @Public()
  @Get('public/:slug')
  @ApiOperation({ summary: 'Get a public organization profile by slug' })
  @ApiResponse({
    status: 200,
    description: 'Organization public profile retrieved successfully',
  })
  async getPublicProfile(@Param('slug') slug: string) {
    return this.organizationsService.getPublicProfile(slug);
  }

  @Public()
  @Get('event-hub/:subdomain')
  @ApiOperation({ summary: 'Get an event hub organization by its subdomain' })
  @ApiResponse({
    status: 200,
    description: 'Event hub retrieved successfully',
  })
  @ApiResponse({ status: 404, description: 'Event hub not found' })
  async getEventHubBySubdomain(@Param('subdomain') subdomain: string) {
    return this.organizationsService.getEventHubBySubdomain(subdomain);
  }

  @Public()
  @Get('event-hub/:subdomain/live')
  @ApiOperation({
    summary:
      'Get live hub data for an event organization (live/upcoming/recent fixtures + per-sport status)',
  })
  @ApiResponse({
    status: 200,
    description: 'Event hub live data retrieved successfully',
  })
  @ApiResponse({ status: 404, description: 'Event hub not found' })
  async getEventHubLive(@Param('subdomain') subdomain: string) {
    return this.organizationsService.getEventHubLive(subdomain);
  }

  @Public()
  @Get('event-hub/:subdomain/medals')
  @ApiOperation({
    summary:
      'Get the medal table for an event organization (aggregated from finals and third-place matches across its tournaments)',
  })
  @ApiResponse({
    status: 200,
    description: 'Medal table retrieved successfully',
  })
  @ApiResponse({ status: 404, description: 'Event hub not found' })
  async getEventHubMedalTable(@Param('subdomain') subdomain: string) {
    return this.organizationsService.getEventHubMedalTable(subdomain);
  }

  // Entity Management Routes
  @Get(':id')
  @ApiOperation({ summary: 'Get an organization' })
  @ApiResponse({
    status: 200,
    description: 'Organization retrieved successfully',
  })
  async findOne(@Param('id') id: string) {
    return this.organizationsService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an organization' })
  @ApiResponse({
    status: 200,
    description: 'Organization updated successfully',
  })
  async update(@Param('id') id: string, @Body() dto: UpdateOrganizationDto) {
    return this.organizationsService.update(id, dto);
  }

  @Post(':id/request-delete')
  @ApiOperation({
    summary: 'Request a deletion verification code for an organization',
  })
  @ApiResponse({
    status: 200,
    description: 'Verification code sent to owner email',
  })
  async requestDeleteCode(@Param('id') id: string, @Req() req: any) {
    return this.organizationsService.requestDeleteCode(id, req.user.sub);
  }

  @Post(':id/confirm-delete')
  @ApiOperation({
    summary: 'Confirm organization deletion with the verification code',
  })
  @ApiResponse({
    status: 200,
    description: 'Organization deleted successfully',
  })
  async confirmDelete(
    @Param('id') id: string,
    @Req() req: any,
    @Body() body: { code: string },
  ) {
    return this.organizationsService.confirmDelete(id, req.user.sub, body.code);
  }
}
