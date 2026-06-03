import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import * as webpush from 'web-push';

@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly db: DatabaseService) {}

  onModuleInit() {
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    const mailto = process.env.VAPID_MAILTO || 'mailto:admin@parascores.com';

    if (!publicKey || !privateKey) {
      this.logger.warn('VAPID keys are not configured. Web Push notifications will not be sent.');
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
  ) {
    const followers = await this.db.tournamentFollower.findMany({
      where: { tournamentId },
      include: {
        user: {
          include: {
            push_subscriptions: true,
          },
        },
      },
    });

    const payload = JSON.stringify({
      title,
      body,
      url,
      tag,
    });

    const promises = followers.flatMap((follower) =>
      follower.user.push_subscriptions.map(async (sub) => {
        const pushSubscription = {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.p256dh,
            auth: sub.auth,
          },
        };

        try {
          await webpush.sendNotification(pushSubscription, payload);
        } catch (err: any) {
          this.logger.error(`Failed to send push notification to sub ${sub.id}: ${err.message}`);
          
          // FIX 2: Check for explicit status code property or fallbacks
          const statusCode = err.statusCode || err.status || (err.res && err.res.statusCode);
          if (statusCode === 410 || statusCode === 404) {
            this.logger.log(`Cleaning up expired subscription: ${sub.id}`);
            // Use catch block to prevent an unhandled rejection breaking the flatMap array context
            await this.db.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
          }
        }
      }),
    );

    // FIX 1: Safely handle individual failures using Promise.allSettled
    if (promises.length > 0) {
      Promise.allSettled(promises).then((results) => {
        const rejected = results.filter((r) => r.status === 'rejected');
        if (rejected.length > 0) {
          this.logger.error(`${rejected.length} push notification promises failed completely.`);
        }
      });
    }
  }
}