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
import { TournamentsService } from './tournaments.service';
import { CreateTournamentDto } from './dto/create-tournament.dto';
import { UpdateTournamentDto } from './dto/update-tournament.dto';
import { StartSeasonDto } from './dto/start-season.dto';
import { Public } from 'src/auth/decorators/public.decorator';
import { PaginationQueryDto } from 'src/common/dto/pagination-query.dto';
import { ResponseUtil } from 'src/utils/api-response';
import { ApiOperation, ApiQuery } from '@nestjs/swagger';

@Controller('tournaments')
export class TournamentsController {
  constructor(private readonly tournamentsService: TournamentsService) {}

  @Public()
  @Get('public')
  @ApiOperation({ summary: 'Get all public tournaments (paginated)' })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Page number',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Items per page',
  })
  @ApiQuery({
    name: 'organizationSlug',
    required: false,
    type: String,
    description: 'Filter by organization slug',
  })
  @ApiQuery({
    name: 'search',
    required: false,
    type: String,
    description: 'Search by name, description, sport, or location',
  })
  @ApiQuery({
    name: 'type',
    required: false,
    type: String,
    description: 'Filter by tournament type',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    type: String,
    description: 'Filter by status (ongoing, past, upcoming)',
  })
  async findAll(
    @Query() paginationQuery: PaginationQueryDto,
    @Query('organizationSlug') organizationSlug?: string,
    @Query('search') search?: string,
    @Query('type') type?: string,
    @Query('status') status?: string,
  ) {
    const { page, limit } = paginationQuery;
    return this.tournamentsService.findAllPublic(
      page,
      limit,
      organizationSlug,
      search,
      type,
      status,
    );
  }

  @Get('mine')
  @ApiOperation({ summary: 'Get my tournaments (paginated)' })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Page number',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Items per page',
  })
  @ApiQuery({
    name: 'organizationId',
    required: false,
    type: String,
    description: 'Filter by organization ID',
  })
  async findAllMine(
    @Req() req: any,
    @Query() paginationQuery: PaginationQueryDto,
    @Query('organizationId') organizationId?: string,
  ) {
    const { page, limit } = paginationQuery;
    return this.tournamentsService.findAllMine(
      req.user.sub,
      page,
      limit,
      organizationId,
    );
  }

  // create tournament
  @Post()
  @ApiOperation({ summary: 'Create a new tournament' })
  async create(
    @Body() createTournamentDto: CreateTournamentDto,
    @Req() req: any,
  ) {
    return this.tournamentsService.create(req.user.sub, createTournamentDto);
  }

  @Post('practice')
  @ApiOperation({
    summary: 'Create a practice (sandbox) tournament for training',
  })
  async createPractice(
    @Body('organizationId') organizationId: string,
    @Req() req: any,
  ) {
    if (!organizationId) {
      throw new BadRequestException('organizationId is required');
    }
    return this.tournamentsService.createPractice(req.user.sub, organizationId);
  }

  @Post(':id/practice-reset')
  @ApiOperation({ summary: 'Reset a practice tournament to its initial state' })
  async resetPractice(@Param('id') id: string, @Req() req: any) {
    return this.tournamentsService.resetPractice(req.user.sub, id);
  }

  @Post(':id/practice-autofill')
  @ApiOperation({
    summary: 'Fill a practice tournament with sample results',
  })
  async autofillPractice(@Param('id') id: string, @Req() req: any) {
    return this.tournamentsService.autofillPractice(req.user.sub, id);
  }

  @Post(':id/season')
  @ApiOperation({ summary: 'Start a new season from an existing tournament' })
  async startSeason(
    @Param('id') id: string,
    @Body() dto: StartSeasonDto,
    @Req() req: any,
  ) {
    return this.tournamentsService.startSeason(id, req.user.sub, dto);
  }

  @Patch(':id/set-active-season')
  @ApiOperation({ summary: 'Set this tournament as the primary active season in its series' })
  async setActiveSeason(@Param('id') id: string, @Req() req: any) {
    return this.tournamentsService.setActiveSeason(id, req.user.sub);
  }

  @Get('following/mine')
  @ApiOperation({ summary: 'Get followed tournaments' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getFollowedTournaments(
    @Req() req: any,
    @Query() paginationQuery: PaginationQueryDto,
  ) {
    const { page, limit } = paginationQuery;
    return this.tournamentsService.getFollowedTournaments(
      req.user.sub,
      page,
      limit,
    );
  }

  @Post(':id/follow')
  @ApiOperation({ summary: 'Follow a tournament' })
  async followTournament(@Param('id') id: string, @Req() req: any) {
    return this.tournamentsService.followTournament(req.user.sub, id);
  }

  @Delete(':id/unfollow')
  @ApiOperation({ summary: 'Unfollow a tournament' })
  async unfollowTournament(@Param('id') id: string, @Req() req: any) {
    return this.tournamentsService.unfollowTournament(req.user.sub, id);
  }

  // Check if a custom name is available
  @Public()
  @Get('check-name/:customName')
  @ApiOperation({ summary: 'Check if a tournament custom name is available' })
  async checkName(@Param('customName') customName: string) {
    return this.tournamentsService.checkCustomName(customName);
  }

  @Public()
  @Get('nearby')
  @ApiOperation({ summary: 'Get public tournaments near a location' })
  @ApiQuery({ name: 'lat', required: true, type: Number })
  @ApiQuery({ name: 'lon', required: true, type: Number })
  @ApiQuery({ name: 'radius', required: false, type: Number, description: 'Radius in km (default 50)' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async findNearby(
    @Query('lat') lat: string,
    @Query('lon') lon: string,
    @Query('radius') radius?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const parsedLat = Number(lat);
    const parsedLon = Number(lon);
    if (Number.isNaN(parsedLat) || Number.isNaN(parsedLon)) {
      throw new BadRequestException('lat and lon must be valid numbers');
    }
    return this.tournamentsService.findNearby(
      parsedLat,
      parsedLon,
      radius ? Number(radius) : 50,
      page ? Number(page) : 1,
      limit ? Number(limit) : 12,
    );
  }

  @Public()
  @Get(':id/seasons')
  @ApiOperation({ summary: 'Get all seasons in this tournament series' })
  async getSeasons(@Param('id') id: string) {
    return this.tournamentsService.getSeasons(id);
  }

  @Public()
  @Get(':id/overview')
  @ApiOperation({ summary: 'Get full tournament overview data' })
  async getOverviewData(@Param('id') id: string) {
    return this.tournamentsService.getOverviewData(id);
  }

  @Public()
  @Get(':id/player-stats')
  @ApiOperation({ summary: 'Get player statistics for a tournament' })
  async getPlayerStats(@Param('id') id: string) {
    return this.tournamentsService.getPlayerStats(id);
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Get a tournament by ID' })
  async findOne(@Param('id') id: string) {
    return this.tournamentsService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a tournament' })
  async update(
    @Param('id') id: string,
    @Body() updateTournamentDto: UpdateTournamentDto,
    @Req() req: any,
  ) {
    return this.tournamentsService.update(
      id,
      req.user.sub,
      updateTournamentDto,
    );
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a tournament' })
  async remove(@Param('id') id: string, @Req() req: any) {
    return this.tournamentsService.remove(id, req.user.sub);
  }
}
