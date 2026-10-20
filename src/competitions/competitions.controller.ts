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
  BadRequestException,
} from '@nestjs/common';
import { CompetitionsService } from './competitions.service';
import { CreateCompetitionDto } from './dto/create-competition.dto';
import { UpdateCompetitionDto } from './dto/update-competition.dto';
import { Public } from 'src/auth/decorators/public.decorator';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

@ApiTags('competitions')
@Controller('competitions')
export class CompetitionsController {
  constructor(private readonly competitionsService: CompetitionsService) {}

  @Public()
  @Get(':slug')
  @ApiOperation({ summary: 'Get competition overview with all season editions' })
  async getBySlug(@Param('slug') slug: string) {
    return this.competitionsService.findBySlug(slug);
  }

  @Get()
  @ApiOperation({ summary: 'Get all competitions for an organization' })
  @ApiQuery({ name: 'organizationId', required: true, type: String })
  async getAllByOrg(@Query('organizationId') organizationId: string) {
    if (!organizationId) {
      throw new BadRequestException('organizationId is required');
    }
    return this.competitionsService.findAllByOrg(organizationId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new competition / league series' })
  async create(@Req() req: any, @Body() dto: CreateCompetitionDto) {
    return this.competitionsService.create(req.user.sub, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a competition' })
  async update(
    @Param('id') id: string,
    @Req() req: any,
    @Body() dto: UpdateCompetitionDto,
  ) {
    return this.competitionsService.update(id, req.user.sub, dto);
  }

  @Post(':id/follow')
  @ApiOperation({ summary: 'Follow a competition across all seasons' })
  async follow(@Param('id') id: string, @Req() req: any) {
    return this.competitionsService.follow(id, req.user.sub);
  }

  @Delete(':id/follow')
  @ApiOperation({ summary: 'Unfollow a competition' })
  async unfollow(@Param('id') id: string, @Req() req: any) {
    return this.competitionsService.unfollow(id, req.user.sub);
  }

  @Get(':id/follow-status')
  @ApiOperation({ summary: 'Check if current user follows this competition' })
  async followStatus(@Param('id') id: string, @Req() req: any) {
    return this.competitionsService.isFollowing(id, req.user.sub);
  }
}