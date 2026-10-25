import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import { PayoutsService } from './payouts.service';
import { SubscriptionsService } from './subscriptions.service';
import { PaymentsHistoryService } from './payments-history.service';
import { PaymentsCheckoutService } from './payments-checkout.service';
import { PlanType } from '../dto/initialize-payment.dto';
import {
  PaymentStatus,
  SubscriptionPlan,
  SubscriptionStatus,
} from 'prisma/generated/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EmailEvents } from 'src/email/email.events';

@Injectable()
export class PaymentsWebhookService {
  private readonly logger = new Logger(PaymentsWebhookService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly eventEmitter: EventEmitter2,
    private readonly payoutsService: PayoutsService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly paymentsHistoryService: PaymentsHistoryService,
    private readonly checkoutService: PaymentsCheckoutService,
  ) {}

  /**
   * Process Paystack webhook events.
   */
  async handleWebhook(event: any) {
    const eventType = event.event;
    this.logger.log(`Webhook received: ${eventType}`);

    switch (eventType) {
      case 'charge.success':
        await this.handleChargeSuccess(event.data);
        break;

      case 'subscription.create':
        await this.subscriptionsService.handleSubscriptionCreate(event.data);
        break;

      case 'subscription.not_renew':
      case 'subscription.disable':
        await this.subscriptionsService.handleSubscriptionDisabled(event.data);
        break;

      case 'invoice.payment_failed':
        await this.subscriptionsService.handlePaymentFailed(event.data);
        break;

      case 'refund.processed':
        await this.paymentsHistoryService.handleRefundProcessed(event.data);
        break;

      case 'refund.failed':
        await this.paymentsHistoryService.handleRefundFailed(event.data);
        break;

      case 'transfer.success':
      case 'transfer.failed':
      case 'transfer.reversed':
        await this.payoutsService.handleTransferUpdate(eventType, event.data);
        break;

      default:
        this.logger.debug(`Unhandled webhook event: ${eventType}`);
    }
  }

  private async handleChargeSuccess(data: any) {
    const reference = data.reference;
    if (!reference) return;

    const payment = await this.db.payment.findUnique({
      where: { paystackReference: reference },
    });

    if (!payment) {
      this.logger.warn(`No payment found for reference: ${reference}`);
      return;
    }

    // Already processed — skip
    if (payment.status === PaymentStatus.SUCCESS) return;

    let notifyPayload: any = null;
    let didTransition = false;

    // Atomic transaction: update payment + activate subscription/tournament
    await this.db.$transaction(async (tx) => {
      // Conditional update: only transitions PENDING → SUCCESS (race-safe)
      const updateResult = await tx.payment.updateMany({
        where: {
          id: payment.id,
          status: PaymentStatus.PENDING,
        },
        data: {
          status: PaymentStatus.SUCCESS,
          amount: data.amount,
          currency: data.currency,
          paystackTransactionId: String(data.id),
        },
      });

      // Another process already handled this
      if (updateResult.count === 0) return;
      didTransition = true;

      // Handle player claim payment
      if (payment.type === 'PLAYER_CLAIM') {
        const metadata = payment.metadata as any;
        const { playerId, userId } = metadata;

        await tx.player.update({
          where: { id: playerId },
          data: {
            userId,
            status: 'PENDING',
            linkCode: null,
            linkCodeExpires: null,
          },
        });
        return;
      }

      // Handle team join payment
      if (payment.type === 'TEAM_JOIN') {
        const metadata = payment.metadata as any;
        const { token, userId, name, number, position, avatarUrl } = metadata;

        const invite = await tx.teamInvite.findUnique({
          where: { token },
          include: { tournament: true },
        });

        if (!invite) throw new NotFoundException('Invite link not found');

        const status = invite.tournament.autoApprove ? 'APPROVED' : 'PENDING';

        const player = await tx.player.create({
          data: {
            participantId: invite.participant_id,
            userId,
            name,
            number,
            position,
            avatarUrl,
            status: status as any,
          },
        });

        const updatedMetadata = {
          ...(payment.metadata as any),
          playerId: player.id,
        };

        await tx.payment.update({
          where: { id: payment.id },
          data: { metadata: updatedMetadata },
        });

        await tx.teamInvite.update({
          where: { id: invite.id },
          data: { usedCount: { increment: 1 } },
        });
        return;
      }

      // Handle tournament registration payment
      if (payment.type === 'TOURNAMENT_REGISTRATION') {
        const metadata = payment.metadata as any;
        const { tournamentId, userId, teamId, customName, logoUrl, token } =
          metadata;

        let participant = await tx.participant.findFirst({
          where: {
            tournament_id: tournamentId,
            ...(teamId ? { team_id: teamId } : { user_id: userId }),
          },
          include: {
            user: true,
            team: true,
          },
        });

        if (!participant) {
          let teamName = customName;
          let teamLogo = logoUrl;

          if (teamId) {
            const team = await tx.team.findUnique({ where: { id: teamId } });
            if (team) {
              teamName = teamName || team.name;
              teamLogo = teamLogo || team.logoUrl || undefined;
            }
          }

          participant = await tx.participant.create({
            data: {
              tournament_id: tournamentId,
              user_id: userId,
              team_id: teamId || null,
              customName: teamName,
              logoUrl: teamLogo,
              status: 'CONFIRMED',
            },
            include: {
              user: true,
              team: true,
            },
          });

          await tx.tournamentInvite.update({
            where: { token },
            data: { usedCount: { increment: 1 } },
          });

          const discountCodeId = (payment.metadata as any)?.discountCodeId;
          if (discountCodeId) {
            await tx.discountCode.updateMany({
              where: { id: discountCodeId },
              data: { usedCount: { increment: 1 } },
            });
          }

          const fullTournament = await tx.tournament.findUnique({
            where: { id: tournamentId },
          });
          if (participant.user?.email && fullTournament) {
            notifyPayload = {
              userEmail: participant.user.email,
              userName: participant.user.name,
              teamName:
                participant.customName || participant.team?.name || 'your team',
              tournamentName: fullTournament.name,
              tournamentUrl: `${process.env.CLIENT_URL || 'http://lvh.me:3001'}/t/${fullTournament.customName || fullTournament.id}`,
              tournamentLogoUrl: fullTournament.logoUrl || undefined,
            };
          }
        }
        return;
      }

      // Handle per-tournament upgrade
      if (
        payment.plan === SubscriptionPlan.PER_TOURNAMENT &&
        payment.tournamentId
      ) {
        await tx.tournament.update({
          where: { id: payment.tournamentId },
          data: { isPremium: true },
        });
        this.logger.log(
          `Tournament ${payment.tournamentId} upgraded via webhook`,
        );
        return;
      }

      // Activate org subscription with period calculation
      if (!payment.organizationId) {
        this.logger.warn(
          `Organization ID is missing for charge success callback ${reference}`,
        );
        return;
      }
      const now = new Date();
      const periodEnd = new Date(now);
      const interval = data.plan_object?.interval;
      const planType = (payment.metadata as any)?.planType;

      if (interval === 'annually' || planType === PlanType.PRO_YEARLY) {
        periodEnd.setFullYear(periodEnd.getFullYear() + 1);
      } else {
        // Default to monthly for PRO_MONTHLY or when interval is 'monthly'
        periodEnd.setMonth(periodEnd.getMonth() + 1);
      }

      await tx.subscription.upsert({
        where: { organizationId: payment.organizationId },
        create: {
          organizationId: payment.organizationId,
          plan: payment.plan || SubscriptionPlan.PRO,
          status: SubscriptionStatus.ACTIVE,
          paystackCustomerCode: data.customer?.customer_code,
          paystackPlanCode:
            data.plan_object?.plan_code || (payment.metadata as any)?.planCode,
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
        },
        update: {
          plan: payment.plan || SubscriptionPlan.PRO,
          status: SubscriptionStatus.ACTIVE,
          paystackCustomerCode: data.customer?.customer_code,
          paystackPlanCode:
            data.plan_object?.plan_code || (payment.metadata as any)?.planCode,
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
          cancelledAt: null,
        },
      });

      this.logger.log(
        `Subscription activated via webhook for org: ${payment.organizationId}`,
      );
    });

    // Instant payout (opt-in orgs): push the organizer's share out now
    if (didTransition) {
      await this.payoutsService.maybeInitiateInstantPayout(payment.id);
    }

    if (notifyPayload) {
      try {
        this.eventEmitter.emit(
          EmailEvents.TOURNAMENT_JOIN_APPROVAL,
          notifyPayload,
        );
      } catch (err) {
        this.logger.error(
          'Failed to emit tournament join approval event via webhook:',
          err,
        );
      }
    }

    if (payment.type === 'PLAYER_CLAIM') {
      const metadata = payment.metadata as any;
      await this.checkoutService.notifyOrganizersOfClaim(
        this.db,
        metadata.playerId,
        metadata.userId,
      );
    }

    if (payment.type === 'TEAM_JOIN') {
      const metadata = payment.metadata as any;
      const invite = await this.db.teamInvite.findUnique({
        where: { token: metadata.token },
      });
      const player = await this.db.player.findFirst({
        where: {
          userId: metadata.userId,
          participantId: invite?.participant_id,
        },
      });
      if (player && player.status === 'PENDING') {
        await this.checkoutService.notifyOrganizersOfClaim(
          this.db,
          player.id,
          metadata.userId,
        );
      }
    }
  }
}
