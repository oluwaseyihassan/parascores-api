import { Controller, Get, Post, Patch, Delete, Body, Param, Query, Req } from '@nestjs/common';
import { TournamentsService } from './tournaments.service';
import { CreateTournamentDto } from './dto/create-tournament.dto';
import { AddParticipantDto } from './dto/add-participant.dto';
import { GenerateFixturesDto } from './dto/generate-fixtures.dto';
import { AddPlayerDto } from './dto/add-player.dto';
import { UpdateFixtureDto } from './dto/update-fixture.dto';
import { AddSponsorDto, UpdateSponsorDto } from './dto/add-sponsor.dto';
import { AddSocialDto, UpdateSocialDto } from './dto/add-social.dto';
import { AdvanceGroupStageDto } from './dto/advance-group-stage.dto';
import { Public } from 'src/auth/decorators/public.decorator';
import { PaginationQueryDto } from 'src/common/dto/pagination-query.dto';
import { ResponseUtil } from 'src/utils/api-response';
import { ApiOperation, ApiQuery } from '@nestjs/swagger';

@Controller('tournaments')
export class TournamentsController {
  constructor(private readonly tournamentsService: TournamentsService) { }

  @Public()
  @Get('public')
  @ApiOperation({ summary: 'Get all public tournaments (paginated)' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page' })
  async findAll(@Query() paginationQuery: PaginationQueryDto) {
    const { page, limit } = paginationQuery;
    return this.tournamentsService.findAllPublic(page, limit);
  }

  @Get('mine')
  @ApiOperation({ summary: 'Get my tournaments (paginated)' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page' })
  async findAllMine(@Req() req, @Query() paginationQuery: PaginationQueryDto) {
    const { page, limit } = paginationQuery;
    return this.tournamentsService.findAllMine(req.user.sub, page, limit);
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

  // Advance group stage to knockout
  @Post(':id/groups/advance')
  @ApiOperation({ summary: 'Advance group stage to knockout stage (Hybrid/Group)' })
  async advanceGroupStage(
    @Param('id') id: string,
    @Body() dto: AdvanceGroupStageDto,
    @Req() req,
  ) {
    return this.tournamentsService.advanceGroupStage(id, req.user.sub, dto);
  }

  // Get fixtures of a tournament
  @Public()
  @Get(':id/fixtures')
  @ApiOperation({ summary: 'Get fixtures of a tournament' })
  @ApiQuery({ name: 'round', required: false, type: Number, description: 'Filter by round number' })
  @ApiQuery({ name: 'stage', required: false, type: String, description: 'Filter by stage (GROUP_STAGE or KNOCKOUT)' })
  async getFixtures(
    @Param('id') id: string,
    @Query('round') round?: string,
    @Query('stage') stage?: string,
  ) {
    return this.tournamentsService.getFixtures(id, round ? parseInt(round, 10) : undefined, stage as any);
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

  // --- Sponsor Endpoints ---

  // Add a sponsor to a tournament
  @Post(':id/sponsors')
  @ApiOperation({ summary: 'Add a sponsor to a tournament' })
  async addSponsor(
    @Param('id') tournamentId: string,
    @Body() dto: AddSponsorDto
  ) {
    return this.tournamentsService.addSponsor(tournamentId, dto);
  }

  // Get all sponsors of a tournament
  @Public()
  @Get(':id/sponsors')
  @ApiOperation({ summary: 'Get sponsors of a tournament' })
  async getSponsors(@Param('id') tournamentId: string) {
    return this.tournamentsService.getSponsors(tournamentId);
  }

  // Update a sponsor
  @Patch(':id/sponsors/:sponsorId')
  @ApiOperation({ summary: 'Update a sponsor' })
  async updateSponsor(
    @Param('id') tournamentId: string,
    @Param('sponsorId') sponsorId: string,
    @Body() dto: UpdateSponsorDto
  ) {
    return this.tournamentsService.updateSponsor(sponsorId, dto);
  }

  // Remove a sponsor
  @Delete(':id/sponsors/:sponsorId')
  @ApiOperation({ summary: 'Remove a sponsor from a tournament' })
  async removeSponsor(
    @Param('id') tournamentId: string,
    @Param('sponsorId') sponsorId: string
  ) {
    return this.tournamentsService.removeSponsor(sponsorId);
  }

  // --- Social Endpoints ---

  // Add a social link to a tournament
  @Post(':id/socials')
  @ApiOperation({ summary: 'Add a social link to a tournament' })
  async addSocial(
    @Param('id') tournamentId: string,
    @Body() dto: AddSocialDto
  ) {
    return this.tournamentsService.addSocial(tournamentId, dto);
  }

  // Get all socials of a tournament
  @Public()
  @Get(':id/socials')
  @ApiOperation({ summary: 'Get social links of a tournament' })
  async getSocials(@Param('id') tournamentId: string) {
    return this.tournamentsService.getSocials(tournamentId);
  }

  // Update a social
  @Patch(':id/socials/:socialId')
  @ApiOperation({ summary: 'Update a social link' })
  async updateSocial(
    @Param('id') tournamentId: string,
    @Param('socialId') socialId: string,
    @Body() dto: UpdateSocialDto
  ) {
    return this.tournamentsService.updateSocial(socialId, dto);
  }

  // Remove a social
  @Delete(':id/socials/:socialId')
  @ApiOperation({ summary: 'Remove a social link from a tournament' })
  async removeSocial(
    @Param('id') tournamentId: string,
    @Param('socialId') socialId: string
  ) {
    return this.tournamentsService.removeSocial(socialId);
  }
}

