import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
} from '@nestjs/common';
import { StandingsService } from './standings.service';
import { CreateStandingDto } from './dto/create-standing.dto';
import { UpdateStandingDto } from './dto/update-standing.dto';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Public } from 'src/auth/decorators/public.decorator';

@ApiTags('standings')
@Controller('standings')
export class StandingsController {
  constructor(private readonly standingsService: StandingsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new standing record' })
  create(@Body() createStandingDto: CreateStandingDto) {
    return this.standingsService.create(createStandingDto);
  }

  @Public()
  @Get('tournament/:tournamentId')
  @ApiOperation({ summary: 'Get standings for a tournament' })
  getStandings(@Param('tournamentId') tournamentId: string) {
    return this.standingsService.getStandings(tournamentId);
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Get a specific standing record' })
  findOne(@Param('id') id: string) {
    return this.standingsService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a specific standing record' })
  update(
    @Param('id') id: string,
    @Body() updateStandingDto: UpdateStandingDto,
  ) {
    return this.standingsService.update(id, updateStandingDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a standing record' })
  remove(@Param('id') id: string) {
    return this.standingsService.remove(id);
  }
}
