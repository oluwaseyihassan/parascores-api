import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Req,
} from '@nestjs/common';
import { VenuesService } from './venues.service';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from 'src/auth/decorators/public.decorator';

@ApiTags('venues')
@Controller('venues')
export class VenuesController {
  constructor(private readonly venuesService: VenuesService) {}

  @Public()
  @Get('tournaments/:tournamentId')
  @ApiOperation({ summary: 'Get venues of a tournament' })
  async getVenues(@Param('tournamentId') tournamentId: string) {
    return this.venuesService.getVenues(tournamentId);
  }

  @Post('tournaments/:tournamentId')
  @ApiOperation({ summary: 'Add a venue to a tournament' })
  async addVenue(
    @Param('tournamentId') tournamentId: string,
    @Body('name') name: string,
  ) {
    return this.venuesService.addVenue(tournamentId, name);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove a venue' })
  async removeVenue(@Param('id') id: string) {
    return this.venuesService.removeVenue(id);
  }
}
