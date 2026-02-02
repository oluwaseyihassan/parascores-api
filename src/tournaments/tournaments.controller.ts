import { Controller, Get, Post, Patch, Body, Param, Query, Req } from '@nestjs/common';
import { TournamentsService } from './tournaments.service';
import { CreateTournamentDto } from './dto/create-tournament.dto';
import { AddParticipantDto } from './dto/add-participant.dto';
import { GenerateFixturesDto } from './dto/generate-fixtures.dto';
import { AddPlayerDto } from './dto/add-player.dto';
import { UpdateFixtureDto } from './dto/update-fixture.dto';
import { Public } from 'src/auth/decorators/public.decorator';
import { PaginationQueryDto } from 'src/common/dto/pagination-query.dto';
import { ResponseUtil } from 'src/utils/api-response';
import { ApiOperation, ApiQuery } from '@nestjs/swagger';

@Controller('tournaments')
export class TournamentsController {
  constructor(private readonly tournamentsService: TournamentsService) { }

  @Public()
  @Get()
  @ApiOperation({ summary: 'Get all public tournaments (paginated)' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page' })
  async findAll(@Query() paginationQuery: PaginationQueryDto) {
    const { page, limit } = paginationQuery;
    const result = await this.tournamentsService.findAllPublic(page, limit);
    return ResponseUtil.paginated(result.tournaments, result.page, result.limit, result.total);
  }

  @Get('mine')
  @ApiOperation({ summary: 'Get my tournaments (paginated)' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page' })
  async findAllMine(@Req() req, @Query() paginationQuery: PaginationQueryDto) {
    const { page, limit } = paginationQuery;
    const result = await this.tournamentsService.findAllMine(req.user.sub, page, limit);
    return ResponseUtil.paginated(result.tournaments, result.page, result.limit, result.total);
  }

  // create tournament
  @Post()
  @ApiOperation({ summary: 'Create a new tournament' })
  async create(@Body() createTournamentDto: CreateTournamentDto, @Req() req) {
    return this.tournamentsService.create(req.user.sub, createTournamentDto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a tournament by ID' })
  async findOne(@Param('id') id: string) {
    return this.tournamentsService.findOne(id);
  }

  // get participants of a tournament
  @Get(':id/participants')
  @ApiOperation({ summary: 'Get participants of a tournament' })
  async getParticipants(@Param('id') id: string) {
    return this.tournamentsService.getParticipants(id);
  }

  // add participant to tournament
  @Post(':id/participants')
  @ApiOperation({ summary: 'Add a participant to a tournament' })
  async addParticipant(@Param('id') id: string, @Body() addParticipantDto: AddParticipantDto, @Req() req) {
    return this.tournamentsService.addParticipant(id, addParticipantDto, req.user.sub);
  }

  // Generate fixtures for a tournament
  @Post(':id/fixtures/generate')
  @ApiOperation({ summary: 'Generate fixtures for a tournament' })
  async generateFixtures(
    @Param('id') id: string,
    @Body() generateFixturesDto: GenerateFixturesDto,
    @Req() req,
  ) {
    return this.tournamentsService.generateFixtures(id, generateFixturesDto, req.user.sub);
  }

  // Get fixtures of a tournament
  @Public()
  @Get(':id/fixtures')
  @ApiOperation({ summary: 'Get fixtures of a tournament' })
  @ApiQuery({ name: 'round', required: false, type: Number, description: 'Filter by round number' })
  async getFixtures(
    @Param('id') id: string,
    @Query('round') round?: string,
  ) {
    return this.tournamentsService.getFixtures(id, round ? parseInt(round, 10) : undefined);
  }

  
  // Get standings of a tournament
  @Public()
  @Get(':id/standings')
  @ApiOperation({ summary: 'Get standings of a tournament' })
  async getStandings(@Param('id') id: string) {
    return this.tournamentsService.getStandings(id);
  }

  // Add player to participant
  @Post(':id/participants/:participantId/players')
  @ApiOperation({ summary: 'Add a player to a participant' })
  async addPlayer(
    @Param('id') tournamentId: string, 
    @Param('participantId') participantId: string, 
    @Body() dto: AddPlayerDto
  ) {
    return this.tournamentsService.addPlayer(participantId, dto);
  }

  // Get players of participant
  @Public()
  @Get(':id/participants/:participantId/players')
  @ApiOperation({ summary: 'Get players of a participant' })
  async getPlayers(
    @Param('id') tournamentId: string,
    @Param('participantId') participantId: string
  ) {
    return this.tournamentsService.getPlayers(participantId);
  }

  // Update a fixture
  @Patch(':id/fixtures/:fixtureId')
  @ApiOperation({ summary: 'Update a fixture (status, scores, teams)' })
  async updateFixture(
    @Param('id') tournamentId: string,
    @Param('fixtureId') fixtureId: string,
    @Body() dto: UpdateFixtureDto
  ) {
    return this.tournamentsService.updateFixture(fixtureId, dto);
  }
}

