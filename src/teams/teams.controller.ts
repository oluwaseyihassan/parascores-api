import { Controller, Get, Post, Body, Param, Patch, Delete, Req } from '@nestjs/common';
import { TeamsService } from './teams.service';
import { CreateTeamDto } from './dto/create-team.dto';
import { UpdateTeamDto } from './dto/update-team.dto';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Public } from 'src/auth/decorators/public.decorator';


@ApiTags('teams')
@Controller('teams')
export class TeamsController {
  constructor(private readonly teamsService: TeamsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a persistent team profile' })
  create(@Body() dto: CreateTeamDto, @Req() req: any) {
    return this.teamsService.createTeam(dto, req.user.sub);
  }

  @Get('test')
  test() {
    return { status: 'ok' };
  }

  @Get('mine')
  @ApiOperation({ summary: 'Get all team profiles owned by the current user' })
  getMyTeams(@Req() req: any) {
    return this.teamsService.getMyTeams(req.user.sub);
  }

  @Public()
  @Get('public/:id')
  @ApiOperation({ summary: 'Get a public team profile' })
  getPublicProfile(@Param('id') id: string) {
    return this.teamsService.getPublicTeamProfile(id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a team profile by ID (Owner only)' })
  getTeam(@Param('id') id: string, @Req() req: any) {
    return this.teamsService.getTeamById(id, req.user.sub);
  }



  @Patch(':id')
  @ApiOperation({ summary: 'Update a team profile' })
  update(@Param('id') id: string, @Body() dto: UpdateTeamDto, @Req() req: any) {
    return this.teamsService.updateTeam(id, dto, req.user.sub);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a team profile' })
  remove(@Param('id') id: string, @Req() req: any) {
    return this.teamsService.deleteTeam(id, req.user.sub);
  }
}
