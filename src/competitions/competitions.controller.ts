import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  BadRequestException,
} from '@nestjs/common';
import { CompetitionsService } from './competitions.service';
import { CreateCompetitionDto } from './dto/create-competition.dto';
import { UpdateCompetitionDto } from './dto/update-competition.dto';
import { Public } from 'src/auth/decorators/public.decorator';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

@ApiTags('competitions')
@Controller('competitions')
export class CompetitionsController {
  constructor(private readonly competitionsService: CompetitionsService) {}

  @Public()
  @Get('public')
  @ApiOperation({ summary: 'Browse public competitions with public editions' })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getPublic(
    @Query('search') search?: string,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '12',
  ) {
    return this.competitionsService.findAllPublic(
      Math.max(1, parseInt(page, 10) || 1),
      Math.min(50, Math.max(1, parseInt(limit, 10) || 12)),
      search,
    );
  }

  @Get('following/mine')
  @ApiOperation({ summary: 'Get competitions followed by the current user' })
  async getFollowed(@Req() req: any) {
    return this.competitionsService.findFollowedByUser(req.user.sub);
  }

  @Public()
  @Get(':slug')
  @ApiOperation({ summary: 'Get competition overview with all season editions' })
  async getBySlug(@Param('slug') slug: string) {
    return this.competitionsService.findBySlug(slug);
  }

  @Get()
  @ApiOperation({ summary: 'Get all competitions for an organization' })
  @ApiQuery({ name: 'organizationId', required: true, type: String })
  async getAllByOrg(@Query('organizationId') organizationId: string) {
    if (!organizationId) {
      throw new BadRequestException('organizationId is required');
    }
    return this.competitionsService.findAllByOrg(organizationId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new competition / league series' })
  async create(@Req() req: any, @Body() dto: CreateCompetitionDto) {
    return this.competitionsService.create(req.user.sub, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a competition' })
  async update(
    @Param('id') id: string,
    @Req() req: any,
    @Body() dto: UpdateCompetitionDto,
  ) {
    return this.competitionsService.update(id, req.user.sub, dto);
  }

  @Post(':id/seasons/attach')
  @ApiOperation({ summary: 'Attach an existing tournament as an edition of this competition' })
  async attachSeason(
    @Param('id') id: string,
    @Req() req: any,
    @Body()
    body: {
      tournamentId: string;
      seasonName?: string;
      setAsCurrent?: boolean;
    },
  ) {
    return this.competitionsService.attachSeason(id, req.user.sub, body);
  }

  @Patch(':id/seasons/:tournamentId')
  @ApiOperation({ summary: 'Update an edition season label or active status' })
  async updateSeason(
    @Param('id') id: string,
    @Param('tournamentId') tournamentId: string,
    @Req() req: any,
    @Body() body: { seasonName?: string; isCurrentSeason?: boolean },
  ) {
    return this.competitionsService.updateSeason(
      id,
      tournamentId,
      req.user.sub,
      body,
    );
  }

  @Delete(':id/seasons/:tournamentId')
  @ApiOperation({ summary: 'Detach a tournament edition from this competition' })
  async detachSeason(
    @Param('id') id: string,
    @Param('tournamentId') tournamentId: string,
    @Req() req: any,
  ) {
    return this.competitionsService.detachSeason(id, tournamentId, req.user.sub);
  }

  @Post(':id/follow')
  @ApiOperation({ summary: 'Follow a competition across all seasons' })
  async follow(@Param('id') id: string, @Req() req: any) {
    return this.competitionsService.follow(id, req.user.sub);
  }

  @Delete(':id/follow')
  @ApiOperation({ summary: 'Unfollow a competition' })
  async unfollow(@Param('id') id: string, @Req() req: any) {
    return this.competitionsService.unfollow(id, req.user.sub);
  }

  @Get(':id/follow-status')
  @ApiOperation({ summary: 'Check if current user follows this competition' })
  async followStatus(@Param('id') id: string, @Req() req: any) {
    return this.competitionsService.isFollowing(id, req.user.sub);
  }
}