import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DatabaseService } from 'src/database/database.service';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import * as webpush from 'web-push';
import {
  NotificationEvents,
  SendTournamentPushPayload,
} from './notification.events';

@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  onModuleInit() {
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    const mailto = process.env.VAPID_MAILTO || 'mailto:admin@parascores.com';

    if (!publicKey || !privateKey) {
      this.logger.warn(
        'VAPID keys are not configured. Web Push notifications will not be sent.',
      );
      return;
    }

    webpush.setVapidDetails(mailto, publicKey, privateKey);
    this.logger.log('VAPID details set successfully.');
  }

  getVapidPublicKey(): string {
    return process.env.VAPID_PUBLIC_KEY || '';
  }

  async subscribe(userId: string, dto: CreateSubscriptionDto) {
    return this.db.pushSubscription.upsert({
      where: { endpoint: dto.endpoint },
      create: {
        userId,
        endpoint: dto.endpoint,
        p256dh: dto.p256dh,
        auth: dto.auth,
      },
      update: {
        userId,
        p256dh: dto.p256dh,
        auth: dto.auth,
      },
    });
  }

  async unsubscribe(userId: string, endpoint: string) {
    try {
      return await this.db.pushSubscription.delete({
        where: { endpoint },
      });
    } catch (err: any) {
      // Ignore if already deleted
      this.logger.warn(`Failed to unsubscribe: ${err.message}`);
    }
  }

  async sendNotificationToTournamentFollowers(
    tournamentId: string,
    title: string,
    body: string,
    url: string,
    tag: string,
    icon?: string,
  ) {
    // Emit event and return immediately — the NotificationListener
    // handles the actual DB query + push sending asynchronously
    this.eventEmitter.emit(NotificationEvents.SEND_TOURNAMENT_PUSH, {
      tournamentId,
      title,
      body,
      url,
      tag,
      icon,
    } as SendTournamentPushPayload);
  }
}
