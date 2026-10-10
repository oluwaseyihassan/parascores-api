import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from 'src/auth/decorators/public.decorator';
import { PulseService } from './pulse.service';
import { CreateAnnouncementDto, PulseReactionDto } from './dto/pulse.dto';

@ApiTags('event-hub-pulse')
@Controller('organizations/event-hub/:subdomain/pulse')
export class PulseController {
  constructor(private readonly pulseService: PulseService) {}

  @Public()
  @Get()
  @ApiOperation({
    summary:
      'List pulse feed cards for an event hub (auto-generated from scoring activity + organizer announcements)',
  })
  @ApiResponse({ status: 200, description: 'Pulse feed retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Event hub not found' })
  async list(
    @Param('subdomain') subdomain: string,
    @Query('limit') limit?: string,
    @Query('deviceId') deviceId?: string,
  ) {
    return this.pulseService.list(subdomain, {
      limit: limit ? parseInt(limit, 10) : undefined,
      deviceId,
    });
  }

  @Public()
  @Post(':itemId/react')
  @ApiOperation({
    summary:
      'Toggle an anonymous emoji reaction on a pulse card (one per device per emoji)',
  })
  @ApiResponse({ status: 200, description: 'Reaction toggled' })
  @ApiResponse({ status: 404, description: 'Pulse item not found' })
  async react(
    @Param('subdomain') subdomain: string,
    @Param('itemId') itemId: string,
    @Body() dto: PulseReactionDto,
  ) {
    return this.pulseService.toggleReaction(
      subdomain,
      itemId,
      dto.deviceId,
      dto.emoji,
    );
  }

  @Post()
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Post an announcement card to the feed (org OWNER/ADMIN)',
  })
  @ApiResponse({ status: 201, description: 'Announcement posted' })
  async announce(
    @Param('subdomain') subdomain: string,
    @Body() dto: CreateAnnouncementDto,
    @Req() req: any,
  ) {
    return this.pulseService.createAnnouncement(subdomain, req.user.sub, dto);
  }
}
