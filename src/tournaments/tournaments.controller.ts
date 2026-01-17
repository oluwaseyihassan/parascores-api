import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Req } from '@nestjs/common';
import { TournamentsService } from './tournaments.service';
import { CreateTournamentDto } from './dto/create-tournament.dto';
import { AddParticipantDto } from './dto/add-participant.dto';
import { Public } from 'src/auth/decorators/public.decorator';

@Controller('tournaments')
export class TournamentsController {
  constructor(private readonly tournamentsService: TournamentsService) { }

  @Post()
  async create(@Req() req, @Body() createTournamentDto: CreateTournamentDto) {
    // userId from req.user (populated by AuthGuard)
    return this.tournamentsService.create(req.user.sub, createTournamentDto);
  }

  @Public()
  @Get()
  async findAll() {
    return this.tournamentsService.findAllPublic();
  }

  @Get('mine')
  async findAllMine(@Req() req) {
    return this.tournamentsService.findAllMine(req.user.sub);
  }

  @Post(':id/participants')
  async addParticipant(@Param('id') id: string, @Body() addParticipantDto: AddParticipantDto, @Req() req) {
    return this.tournamentsService.addParticipant(id, addParticipantDto, req.user.sub);
  }
}
