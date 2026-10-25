import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import { OrganizationsService } from 'src/organizations/organizations.service';
import { PaystackService } from '../paystack.service';
import { InitializePaymentDto, PlanType } from '../dto/initialize-payment.dto';
import { ResponseUtil } from 'src/utils/api-response';
import {
  PaymentStatus,
  SubscriptionPlan,
  SubscriptionStatus,
} from 'prisma/generated/client';

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly paystack: PaystackService,
    private readonly organizationsService: OrganizationsService,
  ) {}

  resolvePlanType(planType: PlanType): {
    paystackPlanCode: string | null;
    subscriptionPlan: SubscriptionPlan;
  } {
    switch (planType) {
      case PlanType.PRO_MONTHLY:
        return {
          paystackPlanCode: process.env.PAYSTACK_PRO_MONTHLY_PLAN || null,
          subscriptionPlan: SubscriptionPlan.PRO,
        };
      case PlanType.PRO_YEARLY:
        return {
          paystackPlanCode: process.env.PAYSTACK_PRO_YEARLY_PLAN || null,
          subscriptionPlan: SubscriptionPlan.PRO,
        };
      case PlanType.PER_TOURNAMENT:
        return {
          paystackPlanCode: null, // One-time payment, no Paystack plan
          subscriptionPlan: SubscriptionPlan.PER_TOURNAMENT,
        };
      default:
        throw new BadRequestException(`Unknown plan type: ${planType}`);
    }
  }

  /**
   * Initialize a Paystack transaction for a subscription plan.
   * Creates a PENDING Payment record and returns the Paystack checkout URL.
   */
  async initializeSubscription(userId: string, dto: InitializePaymentDto) {
    const { organizationId, planType, callbackUrl, amount, tournamentId } = dto;

    // 1. Validate user is OWNER or ADMIN of the org
    await this.organizationsService.validateMemberRole(organizationId, userId, [
      'OWNER',
      'ADMIN',
    ]);

    // 2. Fetch org details and user email
    const [org, user] = await Promise.all([
      this.db.organization.findUnique({ where: { id: organizationId } }),
      this.db.user.findUnique({ where: { id: userId } }),
    ]);

    if (!org) throw new NotFoundException('Organization not found');
    if (!user) throw new NotFoundException('User not found');

    // 3. If per-tournament, validate the tournament exists and calculate the upgrade fee
    let resolvedTournamentId = tournamentId;
    let resolvedAmount = amount; // default to client-passed value (e.g. for Pro plans)
    if (tournamentId) {
      const tournament = await this.db.tournament.findFirst({
        where: {
          OR: [{ id: tournamentId }, { customName: tournamentId }],
        },
      });
      if (!tournament) throw new NotFoundException('Tournament not found');
      if (tournament.isPremium) {
        throw new BadRequestException('Tournament is already upgraded');
      }
      resolvedTournamentId = tournament.id;

      // Calculate dynamic pricing based on maxParticipants (₦1,000 per team)
      if (planType === 'PER_TOURNAMENT') {
        const max = tournament.maxParticipants;
        if (max === null) {
          resolvedAmount = 25000 * 100; // ₦25,000 in kobo for unlimited
        } else {
          resolvedAmount = max * 1000 * 100; // ₦1,000 per team in kobo
        }
      }
    }

    // 4. Resolve the Paystack plan code and subscription plan from the planType
    const { paystackPlanCode, subscriptionPlan } =
      this.resolvePlanType(planType);

    // 5. Initialize Paystack transaction
    const paystackResponse = await this.paystack.initializeTransaction({
      email: user.email,
      amount: resolvedAmount,
      ...(paystackPlanCode && { plan: paystackPlanCode }),
      metadata: {
        organizationId,
        userId,
        ...(resolvedTournamentId && { tournamentId: resolvedTournamentId }),
        organizationName: org.name,
        custom_fields: [
          {
            display_name: 'Organization',
            variable_name: 'organization',
            value: org.name,
          },
          ...(resolvedTournamentId
            ? [
                {
                  display_name: 'Payment Type',
                  variable_name: 'payment_type',
                  value: 'Tournament Upgrade',
                },
              ]
            : []),
        ],
      },
      ...(callbackUrl && { callback_url: callbackUrl }),
    });

    // 6. Create a PENDING payment record
    await this.db.payment.create({
      data: {
        organizationId,
        tournamentId: resolvedTournamentId || null,
        amount: resolvedAmount,
        currency: 'NGN',
        status: PaymentStatus.PENDING,
        paystackReference: paystackResponse.data.reference,
        plan: subscriptionPlan,
        userId,
        metadata: {
          planType,
          paystackPlanCode: paystackPlanCode || null,
          tournamentId: resolvedTournamentId || null,
          userId,
          accessCode: paystackResponse.data.access_code,
        },
      },
    });

    return ResponseUtil.success({
      authorization_url: paystackResponse.data.authorization_url,
      access_code: paystackResponse.data.access_code,
      reference: paystackResponse.data.reference,
    });
  }

  async getSubscription(orgId: string) {
    const subscription = await this.db.subscription.findUnique({
      where: { organizationId: orgId },
    });

    if (!subscription) {
      // Return a "virtual" FREE subscription
      return ResponseUtil.success({
        organizationId: orgId,
        plan: SubscriptionPlan.FREE,
        status: SubscriptionStatus.ACTIVE,
      });
    }

    return ResponseUtil.success(subscription);
  }

  async cancelSubscription(userId: string, orgId: string) {
    // Validate user is OWNER of the org
    await this.organizationsService.validateMemberRole(orgId, userId, [
      'OWNER',
    ]);

    const subscription = await this.db.subscription.findUnique({
      where: { organizationId: orgId },
    });

    if (!subscription || subscription.plan === SubscriptionPlan.FREE) {
      throw new BadRequestException('No active paid subscription to cancel');
    }

    // Cancel on Paystack if we have the subscription code
    if (subscription.paystackSubscriptionCode) {
      try {
        // Fetch the subscription to get the email_token
        const paystackSub = await this.paystack.fetchSubscription(
          subscription.paystackSubscriptionCode,
        );

        await this.paystack.disableSubscription({
          code: subscription.paystackSubscriptionCode,
          token: paystackSub.data.email_token,
        });
      } catch (err) {
        this.logger.error('Failed to cancel on Paystack', err);
        // Continue — still update locally
      }
    }

    // Update local record
    const updated = await this.db.subscription.update({
      where: { id: subscription.id },
      data: {
        status: SubscriptionStatus.CANCELLED,
        cancelledAt: new Date(),
      },
    });

    return ResponseUtil.success(updated);
  }

  async handleSubscriptionCreate(data: any) {
    const customerCode = data.customer?.customer_code;
    if (!customerCode) return;

    const subscription = await this.db.subscription.findFirst({
      where: { paystackCustomerCode: customerCode },
    });

    if (subscription) {
      await this.db.subscription.update({
        where: { id: subscription.id },
        data: {
          paystackSubscriptionCode: data.subscription_code,
          status: SubscriptionStatus.ACTIVE,
          currentPeriodStart: data.createdAt
            ? new Date(data.createdAt)
            : new Date(),
          currentPeriodEnd: data.next_payment_date
            ? new Date(data.next_payment_date)
            : null,
        },
      });

      this.logger.log(
        `Subscription code updated for org: ${subscription.organizationId}`,
      );
    }
  }

  async handleSubscriptionDisabled(data: any) {
    const subscriptionCode = data.subscription_code;
    if (!subscriptionCode) return;

    const subscription = await this.db.subscription.findFirst({
      where: { paystackSubscriptionCode: subscriptionCode },
    });

    if (subscription) {
      await this.db.subscription.update({
        where: { id: subscription.id },
        data: {
          status: SubscriptionStatus.CANCELLED,
          cancelledAt: new Date(),
        },
      });

      this.logger.log(
        `Subscription cancelled via webhook for org: ${subscription.organizationId}`,
      );
    }
  }

  async handlePaymentFailed(data: any) {
    const customerCode = data.customer?.customer_code;
    if (!customerCode) return;

    const subscription = await this.db.subscription.findFirst({
      where: { paystackCustomerCode: customerCode },
    });

    if (subscription) {
      await this.db.subscription.update({
        where: { id: subscription.id },
        data: {
          status: SubscriptionStatus.PAST_DUE,
        },
      });

      this.logger.log(
        `Subscription marked PAST_DUE via webhook for org: ${subscription.organizationId}`,
      );
    }
  }
}
