import { Controller, Get, Post, Patch, Delete, Body, Param } from '@nestjs/common';
import { SponsorsService } from './sponsors.service';
import { AddSponsorDto, UpdateSponsorDto } from 'src/sponsors/dto/add-sponsor.dto';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from 'src/auth/decorators/public.decorator';

@ApiTags('sponsors')
@Controller('sponsors')
export class SponsorsController {
  constructor(private readonly sponsorsService: SponsorsService) {}

  // Add a sponsor to a tournament
  // Kept under /tournaments/:id/sponsors in Tournaments controller ideally, 
  // but if we move it here, we'd need a route that makes sense, or adjust the path. 
  // For backwards compatibility we map the same paths.
  
  // NOTE: The implementation plan said: "Will handle POST, GET, PATCH, DELETE at /tournaments/:tournamentId/sponsors and /sponsors/:id."
  // So we will replicate those paths here to ensure the frontend doesn't break.

  @Post('/tournaments/:tournamentId')
  @ApiOperation({ summary: 'Add a sponsor to a tournament' })
  async addSponsor(
    @Param('tournamentId') tournamentId: string,
    @Body() dto: AddSponsorDto
  ) {
    return this.sponsorsService.addSponsor(tournamentId, dto);
  }

  @Public()
  @Get('/tournaments/:tournamentId')
  @ApiOperation({ summary: 'Get sponsors of a tournament' })
  async getSponsors(@Param('tournamentId') tournamentId: string) {
    return this.sponsorsService.getSponsors(tournamentId);
  }

  @Patch(':sponsorId')
  @ApiOperation({ summary: 'Update a sponsor' })
  async updateSponsor(
    @Param('sponsorId') sponsorId: string,
    @Body() dto: UpdateSponsorDto
  ) {
    return this.sponsorsService.updateSponsor(sponsorId, dto);
  }

  @Delete(':sponsorId')
  @ApiOperation({ summary: 'Remove a sponsor from a tournament' })
  async removeSponsor(
    @Param('sponsorId') sponsorId: string
  ) {
    return this.sponsorsService.removeSponsor(sponsorId);
  }
}
