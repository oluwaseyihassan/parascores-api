import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  Req,
} from '@nestjs/common';
import { TournamentInvitesService } from './tournament-invites.service';
import { CreateTournamentInviteDto } from './dto/create-tournament-invite.dto';
import { AcceptTournamentInviteDto } from './dto/accept-tournament-invite.dto';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Public } from 'src/auth/decorators/public.decorator';

@ApiTags('tournament-invites')
@Controller('tournament-invites')
export class TournamentInvitesController {
  constructor(private readonly tournamentInvitesService: TournamentInvitesService) {}

  @Post()
  @ApiOperation({ summary: 'Create a tournament invite link' })
  create(@Body() dto: CreateTournamentInviteDto, @Req() req: any) {
    return this.tournamentInvitesService.createInvite(dto, req.user.sub);
  }

  @Public()
  @Get('token/:token')
  @ApiOperation({ summary: 'Get invite details by token (public)' })
  getByToken(@Param('token') token: string) {
    return this.tournamentInvitesService.getInviteByToken(token);
  }

  @Post('token/:token/accept')
  @ApiOperation({ summary: 'Accept an invite and join the tournament' })
  accept(
    @Param('token') token: string,
    @Body() dto: AcceptTournamentInviteDto,
    @Req() req: any,
  ) {
    return this.tournamentInvitesService.acceptInvite(token, req.user.sub, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Revoke an invite' })
  revoke(@Param('id') id: string, @Req() req: any) {
    return this.tournamentInvitesService.revokeInvite(id, req.user.sub);
  }

  @Get('tournament/:tournamentId')
  @ApiOperation({ summary: 'Get all invites for a tournament' })
  getByTournament(@Param('tournamentId') tournamentId: string) {
    return this.tournamentInvitesService.getInvitesForTournament(tournamentId);
  }
}
