import { Controller, Post, Body, Req, UseGuards, Patch, Param, Get, Delete } from '@nestjs/common';
import { Public } from 'src/auth/decorators/public.decorator';
import { OrganizationsService } from './organizations.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { AddMemberDto } from './dto/add-member.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('organizations')
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new organization' })
  @ApiResponse({ status: 201, description: 'Organization created successfully' })
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
  async addMember(
    @Param('id') id: string,
    @Body() dto: AddMemberDto,
  ) {
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
  async removeMember(
    @Param('id') id: string,
    @Param('userId') userId: string,
  ) {
    return this.organizationsService.removeMember(id, userId);
  }

  // Public Routes
  @Public()
  @Get('public/:slug')
  @ApiOperation({ summary: 'Get a public organization profile by slug' })
  @ApiResponse({ status: 200, description: 'Organization public profile retrieved successfully' })
  async getPublicProfile(@Param('slug') slug: string) {
    return this.organizationsService.getPublicProfile(slug);
  }

  // Entity Management Routes
  @Get(':id')
  @ApiOperation({ summary: 'Get an organization' })
  @ApiResponse({ status: 200, description: 'Organization retrieved successfully' })
  async findOne(@Param('id') id: string) {
    return this.organizationsService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an organization' })
  @ApiResponse({ status: 200, description: 'Organization updated successfully' })
  async update(@Param('id') id: string, @Body() dto: UpdateOrganizationDto) {
    return this.organizationsService.update(id, dto);
  }
}
