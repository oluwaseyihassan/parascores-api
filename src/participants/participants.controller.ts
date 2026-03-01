import { Controller, Get, Post, Body, Param, Req } from '@nestjs/common';
import { ParticipantsService } from './participants.service';
import { AddParticipantDto } from 'src/participants/dto/add-participant.dto';
import { AddPlayerDto } from 'src/participants/dto/add-player.dto';
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

  @Post(':participantId/players')
  @ApiOperation({ summary: 'Add a player to a participant' })
  async addPlayer(
    @Param('participantId') participantId: string,
    @Body() dto: AddPlayerDto,
  ) {
    // Note: The original route included :tournamentId, but it isn't strictly necessary since participantId is globally unique.
    return this.participantsService.addPlayer(participantId, dto);
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
}
