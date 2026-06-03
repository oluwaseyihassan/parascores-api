import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DatabaseService } from 'src/database/database.service';
import * as webpush from 'web-push';
import {
  NotificationEvents,
  SendTournamentPushPayload,
} from './notification.events';

@Injectable()
export class NotificationListener {
  private readonly logger = new Logger(NotificationListener.name);

  constructor(private readonly db: DatabaseService) {}

  @OnEvent(NotificationEvents.SEND_TOURNAMENT_PUSH, { async: true })
  async handleSendTournamentPush(payload: SendTournamentPushPayload) {
    try {
      const followers = await this.db.tournamentFollower.findMany({
        where: { tournamentId: payload.tournamentId },
        include: {
          user: {
            include: {
              push_subscriptions: true,
            },
          },
        },
      });

      const pushPayload = JSON.stringify({
        title: payload.title,
        body: payload.body,
        url: payload.url,
        tag: payload.tag,
      });

      // Fire all push notifications concurrently instead of sequentially
      const notificationPromises = followers.flatMap((follower) =>
        follower.user.push_subscriptions.map((sub) =>
          webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: {
                p256dh: sub.p256dh,
                auth: sub.auth,
              },
            },
            pushPayload,
            {
              TTL: 24 * 60 * 60, // 24 hours (86400 seconds)
              urgency: 'high',
            },
          ).catch(async (err: any) => {
            const statusCode = err.statusCode || err.status || (err.res && err.res.statusCode);
            const responseBody = err.body || '';
            this.logger.error(
              `Failed to send push notification to sub ${sub.id}: ${err.message} (Status: ${statusCode}, Body: ${responseBody})`
            );

            if (statusCode === 410 || statusCode === 404) {
              this.logger.log(`Cleaning up expired subscription: ${sub.id}`);
              await this.db.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
            }
          }),
        ),
      );

      if (notificationPromises.length > 0) {
        const results = await Promise.allSettled(notificationPromises);
        const rejected = results.filter((r) => r.status === 'rejected');
        if (rejected.length > 0) {
          this.logger.error(`${rejected.length} push notification promises failed completely.`);
        }
      }
    } catch (err: any) {
      this.logger.error(
        `Error in background notification dispatch: ${err.message}`,
        err.stack,
      );
    }
  }
}
