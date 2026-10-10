import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { LocationsService } from './locations.service';

@ApiTags('Locations')
@Controller('locations')
export class LocationsController {
  constructor(private readonly locationsService: LocationsService) {}

  @Get('search')
  @ApiOperation({ summary: 'Search locations (Nigeria) via Nominatim' })
  async search(@Query('query') query: string) {
    return this.locationsService.search(query);
  }
}
