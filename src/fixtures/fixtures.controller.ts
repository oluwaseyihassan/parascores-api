import { Controller, Get, Post, Patch, Delete, Body, Param } from '@nestjs/common';
import { FixturesService } from './fixtures.service';
import { UpdateFixtureDto } from './dto/update-fixture.dto';
import { AddMatchEventDto } from './dto/add-match-event.dto';
import { Public } from 'src/auth/decorators/public.decorator';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('fixtures')
@Controller('fixtures')
export class FixturesController {
  constructor(private readonly fixturesService: FixturesService) {}

  // Get all live fixtures
  @Public()
  @Get('live')
  @ApiOperation({ summary: 'Get all live fixtures' })
  async findLive() {
    return this.fixturesService.findLive();
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
    @Body() dto: UpdateFixtureDto
  ) {
    return this.fixturesService.update(id, dto);
  }

  // Get events for a fixture
  @Public()
  @Get(':id/events')
  @ApiOperation({ summary: 'Get all events for a fixture' })
  async getEvents(@Param('id') id: string) {
    return this.fixturesService.getEvents(id);
  }

  // Add an event to a fixture
  @Post(':id/events')
  @ApiOperation({ summary: 'Add an event to a fixture (goal, card, etc.)' })
  async addEvent(
    @Param('id') id: string,
    @Body() dto: AddMatchEventDto
  ) {
    return this.fixturesService.addEvent(id, dto);
  }

  // Delete an event
  @Delete('events/:eventId')
  @ApiOperation({ summary: 'Delete a match event' })
  async deleteEvent(@Param('eventId') eventId: string) {
    return this.fixturesService.deleteEvent(eventId);
  }
}
