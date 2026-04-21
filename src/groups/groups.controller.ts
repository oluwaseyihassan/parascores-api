import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
} from '@nestjs/common';
import { GroupsService } from './groups.service';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('groups')
@Controller('groups')
export class GroupsController {
  constructor(private readonly groupsService: GroupsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new group' })
  async create(@Body() createGroupDto: CreateGroupDto) {
    return this.groupsService.create(createGroupDto);
  }

  @Get('tournaments/:tournamentId')
  @ApiOperation({ summary: 'Get all groups for a tournament' })
  async findAllByTournament(@Param('tournamentId') tournamentId: string) {
    return this.groupsService.findAllByTournament(tournamentId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a group' })
  async update(
    @Param('id') id: string,
    @Body() updateGroupDto: UpdateGroupDto,
  ) {
    return this.groupsService.update(id, updateGroupDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a group' })
  async remove(@Param('id') id: string) {
    return this.groupsService.remove(id);
  }
}
