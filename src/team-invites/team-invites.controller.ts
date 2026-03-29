import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  Req,
} from '@nestjs/common';
import { TeamInvitesService } from './team-invites.service';
import { CreateTeamInviteDto } from './dto/create-team-invite.dto';
import { AcceptTeamInviteDto } from './dto/accept-team-invite.dto';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Public } from 'src/auth/decorators/public.decorator';

@ApiTags('team-invites')
@Controller('team-invites')
export class TeamInvitesController {
  constructor(private readonly teamInvitesService: TeamInvitesService) {}

  @Post()
  @ApiOperation({ summary: 'Create a team invite link' })
  create(@Body() dto: CreateTeamInviteDto, @Req() req: any) {
    return this.teamInvitesService.createInvite(dto, req.user.sub);
  }

  @Public()
  @Get('token/:token')
  @ApiOperation({ summary: 'Get invite details by token (public)' })
  getByToken(@Param('token') token: string) {
    return this.teamInvitesService.getInviteByToken(token);
  }

  @Post('token/:token/accept')
  @ApiOperation({ summary: 'Accept an invite and join the team' })
  accept(
    @Param('token') token: string,
    @Body() dto: AcceptTeamInviteDto,
    @Req() req: any,
  ) {
    return this.teamInvitesService.acceptInvite(token, req.user.sub, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Revoke an invite' })
  revoke(@Param('id') id: string, @Req() req: any) {
    return this.teamInvitesService.revokeInvite(id, req.user.sub);
  }

  @Get('participant/:participantId')
  @ApiOperation({ summary: 'Get all invites for a participant (team)' })
  getByParticipant(@Param('participantId') participantId: string) {
    return this.teamInvitesService.getInvitesForParticipant(participantId);
  }
}
