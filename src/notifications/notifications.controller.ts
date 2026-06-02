import { Controller, Get, Post, Body, Req } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { Public } from 'src/auth/decorators/public.decorator';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Public()
  @Get('vapid-key')
  @ApiOperation({ summary: 'Get VAPID public key' })
  getVapidKey() {
    const key = this.notificationsService.getVapidPublicKey();
    return { key };
  }

  @Post('subscribe')
  @ApiOperation({ summary: 'Subscribe to web push notifications' })
  async subscribe(
    @Req() req: any,
    @Body() dto: CreateSubscriptionDto,
  ) {
    const subscription = await this.notificationsService.subscribe(req.user.sub, dto);
    return { success: true, data: subscription };
  }

  @Post('unsubscribe')
  @ApiOperation({ summary: 'Unsubscribe from web push notifications' })
  async unsubscribe(
    @Req() req: any,
    @Body('endpoint') endpoint: string,
  ) {
    await this.notificationsService.unsubscribe(req.user.sub, endpoint);
    return { success: true };
  }
}
