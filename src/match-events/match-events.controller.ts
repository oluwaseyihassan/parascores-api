import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { MatchEventsService } from './match-events.service';
import { CreateMatchEventDto } from './dto/create-match-event.dto';
import { UpdateMatchEventDto } from './dto/update-match-event.dto';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Public } from 'src/auth/decorators/public.decorator';

@ApiTags('match-events')
@Controller('match-events')
export class MatchEventsController {
  constructor(private readonly matchEventsService: MatchEventsService) {}

  @Post('fixture/:fixtureId')
  @ApiOperation({ summary: 'Add a new match event' })
  create(
    @Param('fixtureId') fixtureId: string, 
    @Body() createMatchEventDto: CreateMatchEventDto
  ) {
    return this.matchEventsService.create(fixtureId, createMatchEventDto);
  }

  @Public()
  @Get('fixture/:fixtureId')
  @ApiOperation({ summary: 'Get all events for a specific fixture' })
  findAllByFixture(@Param('fixtureId') fixtureId: string) {
    return this.matchEventsService.findAllByFixture(fixtureId);
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Get a single match event by ID' })
  findOne(@Param('id') id: string) {
    return this.matchEventsService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a match event' })
  update(@Param('id') id: string, @Body() updateMatchEventDto: UpdateMatchEventDto) {
    return this.matchEventsService.update(id, updateMatchEventDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a match event' })
  remove(@Param('id') id: string) {
    return this.matchEventsService.remove(id);
  }
}
