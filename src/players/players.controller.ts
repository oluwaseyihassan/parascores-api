import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Req,
} from '@nestjs/common';
import { PlayersService } from './players.service';
import { CreatePlayerDto } from './dto/create-player.dto';
import { UpdatePlayerDto } from './dto/update-player.dto';
import { LinkPlayerDto } from './dto/link-player.dto';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Public } from 'src/auth/decorators/public.decorator';

@ApiTags('players')
@Controller('players')
export class PlayersController {
  constructor(private readonly playersService: PlayersService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new player' })
  create(@Body() createPlayerDto: CreatePlayerDto) {
    return this.playersService.create(createPlayerDto);
  }

  @Get('me')
  @ApiOperation({ summary: 'Get player profiles for the logged-in user' })
  findMyProfiles(@Req() req: any) {
    return this.playersService.findByUserId(req.user.sub);
  }

  @Public()
  @Get()
  @ApiOperation({ summary: 'Get all players' })
  findAll() {
    return this.playersService.findAll();
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Get a player by ID' })
  findOne(@Param('id') id: string) {
    return this.playersService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a player by ID' })
  update(@Param('id') id: string, @Body() updatePlayerDto: UpdatePlayerDto) {
    return this.playersService.update(id, updatePlayerDto);
  }

  @Patch(':id/link')
  @ApiOperation({ summary: 'Link a player to a user account' })
  linkToUser(@Param('id') id: string, @Body() linkPlayerDto: LinkPlayerDto) {
    return this.playersService.linkToUser(id, linkPlayerDto.userId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a player by ID' })
  remove(@Param('id') id: string) {
    return this.playersService.remove(id);
  }

  @Public()
  @Get('participant/:participantId')
  @ApiOperation({ summary: 'Get players by participant ID' })
  findByParticipant(@Param('participantId') participantId: string) {
    return this.playersService.findByParticipant(participantId);
  }

  @Public()
  @Get('user/:userId')
  @ApiOperation({ summary: 'Get player profiles by user ID' })
  findByUser(@Param('userId') userId: string) {
    return this.playersService.findByUserId(userId);
  }
}
