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
} from '@nestjs/common';
import { TournamentsService } from './tournaments.service';
import { CreateTournamentDto } from './dto/create-tournament.dto';
import { UpdateTournamentDto } from './dto/update-tournament.dto';
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
  async findAll(@Query() paginationQuery: PaginationQueryDto) {
    const { page, limit } = paginationQuery;
    return this.tournamentsService.findAllPublic(page, limit);
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

  // Check if a custom name is available
  @Public()
  @Get('check-name/:customName')
  @ApiOperation({ summary: 'Check if a tournament custom name is available' })
  async checkName(@Param('customName') customName: string) {
    return this.tournamentsService.checkCustomName(customName);
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
    @Req() req,
  ) {
    return this.tournamentsService.update(
      id,
      req.user.sub,
      updateTournamentDto,
    );
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a tournament' })
  async remove(@Param('id') id: string, @Req() req) {
    return this.tournamentsService.remove(id, req.user.sub);
  }
}
