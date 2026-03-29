import { Controller, Get, Post, Patch, Delete, Body, Param, Req } from '@nestjs/common';
import { ParticipantsService } from './participants.service';
import { AddParticipantDto, BulkAddParticipantDto } from 'src/participants/dto/add-participant.dto';
import { AddPlayerDto, BulkAddPlayerDto } from 'src/participants/dto/add-player.dto';
import { UpdateParticipantDto } from 'src/participants/dto/update-participant.dto';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from 'src/auth/decorators/public.decorator';

@ApiTags('participants')
@Controller('participants')
export class ParticipantsController {
  constructor(private readonly participantsService: ParticipantsService) {}

  @Public()
  @Get('/tournaments/:tournamentId')
  @ApiOperation({ summary: 'Get participants of a tournament' })
  async getParticipants(@Param('tournamentId') tournamentId: string) {
    return this.participantsService.getParticipants(tournamentId);
  }

  @Post('/tournaments/:tournamentId')
  @ApiOperation({ summary: 'Add a participant to a tournament' })
  async addParticipant(
    @Param('tournamentId') tournamentId: string,
    @Body() addParticipantDto: AddParticipantDto,
    @Req() req,
  ) {
    return this.participantsService.addParticipant(
      tournamentId,
      addParticipantDto,
      req.user.sub,
    );
  }

  @Post('/tournaments/:tournamentId/bulk')
  @ApiOperation({ summary: 'Add multiple participants to a tournament' })
  async addParticipantsBulk(
    @Param('tournamentId') tournamentId: string,
    @Body() dto: BulkAddParticipantDto,
    @Req() req,
  ) {
    return this.participantsService.addParticipantsBulk(
      tournamentId,
      dto,
      req.user.sub,
    );
  }

  @Post(':participantId/players')
  @ApiOperation({ summary: 'Add a player to a participant' })
  async addPlayer(
    @Param('participantId') participantId: string,
    @Body() dto: AddPlayerDto,
  ) {
    // Note: The original route included :tournamentId, but it isn't strictly necessary since participantId is globally unique.
    return this.participantsService.addPlayer(participantId, dto);
  }

  @Post(':participantId/players/bulk')
  @ApiOperation({ summary: 'Add multiple players to a participant' })
  async addPlayersBulk(
    @Param('participantId') participantId: string,
    @Body() dto: BulkAddPlayerDto,
  ) {
    return this.participantsService.addPlayersBulk(participantId, dto);
  }

  @Public()
  @Get(':participantId/players')
  @ApiOperation({ summary: 'Get players of a participant' })
  async getPlayers(@Param('participantId') participantId: string) {
    return this.participantsService.getPlayers(participantId);
  }

  @Public()
  @Get(':participantId')
  @ApiOperation({ summary: 'Get a participant by id' })
  async getParticipantById(@Param('participantId') participantId: string) {
    return this.participantsService.getParticipantById(participantId);
  }

  @Patch(':participantId')
  @ApiOperation({ summary: 'Update a participant' })
  async updateParticipant(
    @Param('participantId') participantId: string,
    @Body() dto: UpdateParticipantDto,
  ) {
    return this.participantsService.updateParticipant(participantId, dto);
  }

  @Patch(':participantId/players/:playerId/status')
  @ApiOperation({ summary: 'Update player status (approve/reject)' })
  async updatePlayerStatus(
    @Param('participantId') participantId: string,
    @Param('playerId') playerId: string,
    @Body('status') status: string,
  ) {
    return this.participantsService.updatePlayerStatus(participantId, playerId, status);
  }

  @Delete(':participantId/players/:playerId')
  @ApiOperation({ summary: 'Remove a player' })
  async removePlayer(
    @Param('participantId') participantId: string,
    @Param('playerId') playerId: string,
  ) {
    return this.participantsService.removePlayer(participantId, playerId);
  }

  @Delete(':participantId')
  @ApiOperation({ summary: 'Remove a participant' })
  async removeParticipant(@Param('participantId') participantId: string) {
    return this.participantsService.removeParticipant(participantId);
  }
}
