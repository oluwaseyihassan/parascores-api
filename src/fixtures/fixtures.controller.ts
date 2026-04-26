import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Sse,
  MessageEvent,
  Req,
  Query,
} from '@nestjs/common';
import { FixturesService } from './fixtures.service';
import { FixtureGeneratorService } from './fixture-generator/fixture-generator.service';
import { UpdateFixtureDto } from './dto/update-fixture.dto';
import { CreateFixtureDto } from './dto/create-fixture.dto';
import { GenerateFixturesDto } from 'src/fixtures/dto/generate-fixtures.dto';
import { AdvanceGroupStageDto } from 'src/fixtures/dto/advance-group-stage.dto';
import { Public } from 'src/auth/decorators/public.decorator';
import { ApiOperation, ApiTags, ApiQuery } from '@nestjs/swagger';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

@ApiTags('fixtures')
@Controller('fixtures')
export class FixturesController {
  constructor(
    private readonly fixturesService: FixturesService,
    private readonly fixtureGeneratorService: FixtureGeneratorService,
  ) {}

  // Get all fixtures for a specific tournament
  @Public()
  @Get('tournaments/:tournamentId')
  @ApiOperation({ summary: 'Get fixtures of a tournament' })
  @ApiQuery({
    name: 'round',
    required: false,
    type: Number,
    description: 'Filter by round number',
  })
  @ApiQuery({
    name: 'stage',
    required: false,
    type: String,
    description: 'Filter by stage (GROUP_STAGE or KNOCKOUT)',
  })
  async getTournamentFixtures(
    @Param('tournamentId') tournamentId: string,
    @Query('round') round?: string,
    @Query('stage') stage?: string,
  ) {
    return this.fixturesService.getTournamentFixtures(
      tournamentId,
      round ? parseInt(round, 10) : undefined,
      stage,
    );
  }

  // Create a single fixture manually
  @Post()
  @ApiOperation({ summary: 'Create a single fixture manually' })
  async create(
    @Body() createFixtureDto: CreateFixtureDto,
    @Req() req,
  ) {
    return this.fixturesService.create(createFixtureDto, req.user.sub);
  }

  // Generate fixtures for a tournament
  @Post('tournaments/:tournamentId/generate')
  @ApiOperation({ summary: 'Generate fixtures for a tournament' })
  async generateFixtures(
    @Param('tournamentId') tournamentId: string,
    @Body() generateFixturesDto: GenerateFixturesDto,
    @Req() req,
  ) {
    return this.fixtureGeneratorService.generateFixtures(
      tournamentId,
      generateFixturesDto,
      req.user.sub,
    );
  }

  // Advance group stage to knockout
  @Post('tournaments/:tournamentId/groups/advance')
  @ApiOperation({ summary: 'Advance group stage to knockout stage' })
  async advanceGroupStage(
    @Param('tournamentId') tournamentId: string,
    @Body() dto: AdvanceGroupStageDto,
    @Req() req,
  ) {
    return this.fixtureGeneratorService.advanceGroupStage(
      tournamentId,
      req.user.sub,
      dto,
    );
  }

  // SSE stream for live match updates
  @Public()
  @Sse('live/stream')
  @ApiOperation({ summary: 'SSE stream for live fixtures' })
  streamLiveFixtures(): Observable<MessageEvent> {
    return this.fixturesService.liveFixturesSubject
      .asObservable()
      .pipe(map((payload) => ({ data: payload }) as MessageEvent));
  }

  // Get all live fixtures
  @Public()
  @Get('live')
  @ApiOperation({ summary: 'Get all live fixtures' })
  async findLive() {
    return this.fixturesService.findLive();
  }

  // Get recent completed fixtures
  @Public()
  @Get('recent')
  @ApiOperation({ summary: 'Get recently completed fixtures' })
  async findRecent(@Query('limit') limit?: string) {
    return this.fixturesService.findRecentResults(
      limit ? parseInt(limit, 10) : 10,
    );
  }

  // Get upcoming scheduled fixtures
  @Public()
  @Get('upcoming')
  @ApiOperation({ summary: 'Get upcoming scheduled fixtures' })
  async findUpcoming(@Query('limit') limit?: string) {
    return this.fixturesService.findUpcoming(
      limit ? parseInt(limit, 10) : 10,
    );
  }

  // Get a single fixture by ID
  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Get a fixture by ID' })
  async findOne(@Param('id') id: string) {
    return this.fixturesService.findOne(id);
  }

  // Update a fixture
  @Patch(':id')
  @ApiOperation({ summary: 'Update a fixture (status, scores, teams)' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateFixtureDto,
    @Req() req,
  ) {
    return this.fixturesService.update(id, req.user.sub, dto);
  }

  // Delete a single fixture
  @Delete(':id')
  @ApiOperation({ summary: 'Delete a single fixture' })
  async delete(@Param('id') id: string, @Req() req) {
    return this.fixturesService.delete(id, req.user.sub);
  }

  // Delete all fixtures for a tournament
  @Delete('tournaments/:tournamentId')
  @ApiOperation({ summary: 'Delete all fixtures for a specific tournament' })
  @ApiQuery({ name: 'stage', required: false, type: String, description: 'Filter by stage (GROUP_STAGE or KNOCKOUT)' })
  async deleteTournamentFixtures(
    @Param('tournamentId') tournamentId: string,
    @Req() req,
    @Query('stage') stage?: string,
  ) {
    return this.fixturesService.deleteAllTournamentFixtures(
      tournamentId,
      req.user.sub,
      stage,
    );
  }
}
