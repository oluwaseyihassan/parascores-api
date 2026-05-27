import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import { OrganizationsService } from 'src/organizations/organizations.service';
import { PaystackService } from './paystack.service';
import { InitializePaymentDto, PlanType } from './dto/initialize-payment.dto';
import { InitializeRegistrationDto } from './dto/initialize-registration.dto';
import { InitializePlayerClaimDto } from './dto/initialize-player-claim.dto';
import { ResponseUtil } from 'src/utils/api-response';
import {
  PaymentStatus,
  SubscriptionPlan,
  SubscriptionStatus,
} from 'prisma/generated/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EmailEvents } from 'src/email/email.events';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly paystack: PaystackService,
    private readonly organizationsService: OrganizationsService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ─── Initialize ──────────────────────────────────────────

  /**
   * Initialize a Paystack transaction for a subscription plan.
   * Creates a PENDING Payment record and returns the Paystack checkout URL.
   */
  async initializeSubscription(userId: string, dto: InitializePaymentDto) {
    const { organizationId, planType, callbackUrl, amount, tournamentId } = dto;

    // 1. Validate user is OWNER or ADMIN of the org
    await this.organizationsService.validateMemberRole(
      organizationId,
      userId,
      ['OWNER', 'ADMIN'],
    );

    // 2. Fetch org details and user email
    const [org, user] = await Promise.all([
      this.db.organization.findUnique({ where: { id: organizationId } }),
      this.db.user.findUnique({ where: { id: userId } }),
    ]);

    if (!org) throw new NotFoundException('Organization not found');
    if (!user) throw new NotFoundException('User not found');

    // 3. If per-tournament, validate the tournament exists
    if (tournamentId) {
      const tournament = await this.db.tournament.findUnique({
        where: { id: tournamentId },
      });
      if (!tournament) throw new NotFoundException('Tournament not found');
      if (tournament.isPremium) {
        throw new BadRequestException('Tournament is already upgraded');
      }
    }

    // 4. Resolve the Paystack plan code and subscription plan from the planType
    const { paystackPlanCode, subscriptionPlan } = this.resolvePlanType(planType);

    // 5. Initialize Paystack transaction
    const paystackResponse = await this.paystack.initializeTransaction({
      email: user.email,
      amount,
      ...(paystackPlanCode && { plan: paystackPlanCode }),
      metadata: {
        organizationId,
        userId,
        ...(tournamentId && { tournamentId }),
        organizationName: org.name,
        custom_fields: [
          {
            display_name: 'Organization',
            variable_name: 'organization',
            value: org.name,
          },
          ...(tournamentId
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
        tournamentId: tournamentId || null,
        amount,
        currency: 'NGN',
        status: PaymentStatus.PENDING,
        paystackReference: paystackResponse.data.reference,
        plan: subscriptionPlan,
        metadata: {
          planType,
          paystackPlanCode: paystackPlanCode || null,
          tournamentId: tournamentId || null,
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

  /**
   * Initialize a Paystack transaction for a tournament registration fee.
   * Creates a PENDING Payment record and returns the Paystack checkout URL.
   */
  async initializeRegistration(userId: string, dto: InitializeRegistrationDto) {
    const { tournamentId, teamId, customName, logoUrl, token, callbackUrl } = dto;

    // 1. Fetch details and validate
    const [tournament, user, invite] = await Promise.all([
      this.db.tournament.findUnique({
        where: { id: tournamentId },
      }),
      this.db.user.findUnique({ where: { id: userId } }),
      this.db.tournamentInvite.findUnique({
        where: { token },
      }),
    ]);

    if (!tournament) throw new NotFoundException('Tournament not found');
    if (!user) throw new NotFoundException('User not found');
    if (!invite || !invite.isActive) {
      throw new BadRequestException('Invalid or inactive invite token');
    }

    if (invite.tournament_id !== tournamentId) {
      throw new BadRequestException('Invite token does not match tournament');
    }

    if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
      throw new BadRequestException('Invite token has expired');
    }

    if (invite.maxUses && invite.usedCount >= invite.maxUses) {
      throw new BadRequestException('Invite token has reached its maximum uses');
    }

    if (!tournament.isPaidRegistration) {
      throw new BadRequestException('This tournament does not require a registration fee');
    }

    if (!tournament.organization_id) {
      throw new BadRequestException('Tournament organization is missing');
    }

    // Check participant limit
    const currentParticipantCount = await this.db.participant.count({
      where: { tournament_id: tournamentId },
    });

    const subscription = await this.db.subscription.findUnique({
      where: { organizationId: tournament.organization_id },
    });
    const isPremium = tournament.isPremium || (
      subscription &&
      (subscription.status === 'ACTIVE' || subscription.status === 'TRIALING') &&
      (subscription.plan === 'PRO' || subscription.plan === 'ENTERPRISE')
    );

    if (!isPremium && currentParticipantCount >= 32) {
      throw new BadRequestException(
        'This tournament is on a Free plan and has reached its maximum limit of 32 participants.',
      );
    }

    const feeAmount = tournament.registrationFee;
    if (feeAmount <= 0) {
      throw new BadRequestException('Invalid registration fee amount');
    }

    // 2. Initialize Paystack transaction
    const paystackResponse = await this.paystack.initializeTransaction({
      email: user.email,
      amount: feeAmount,
      metadata: {
        type: 'TOURNAMENT_REGISTRATION',
        userId,
        tournamentId,
        teamId,
        customName,
        logoUrl,
        token,
        custom_fields: [
          {
            display_name: 'Tournament Name',
            variable_name: 'tournament_name',
            value: tournament.name,
          },
          {
            display_name: 'Payment Type',
            variable_name: 'payment_type',
            value: 'Tournament Registration Fee',
          },
        ],
      },
      callback_url: callbackUrl,
    });

    // 3. Create a PENDING payment record associated with the tournament's organization
    await this.db.payment.create({
      data: {
        organizationId: tournament.organization_id,
        tournamentId: tournament.id,
        amount: feeAmount,
        currency: 'NGN',
        status: PaymentStatus.PENDING,
        paystackReference: paystackResponse.data.reference,
        type: 'TOURNAMENT_REGISTRATION',
        userId,
        metadata: {
          type: 'TOURNAMENT_REGISTRATION',
          userId,
          tournamentId,
          teamId,
          customName,
          logoUrl,
          token,
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

  /**
   * Initialize a Paystack transaction for claiming a player profile.
   * Creates a PENDING Payment record and returns the Paystack checkout URL.
   */
  async initializePlayerClaim(userId: string, dto: InitializePlayerClaimDto) {
    const { playerId, code, callbackUrl } = dto;

    // 1. Fetch user and player details
    const [user, player] = await Promise.all([
      this.db.user.findUnique({ where: { id: userId } }),
      this.db.player.findUnique({
        where: { id: playerId },
        include: {
          participant: {
            include: { tournament: true },
          },
        },
      }),
    ]);

    if (!user) throw new NotFoundException('User not found');
    if (!player) throw new NotFoundException('Player not found');

    // 2. Validate claim code if provided
    if (code) {
      if (!player.linkCode || player.linkCode.toUpperCase() !== code.toUpperCase()) {
        throw new BadRequestException('Invalid claim code');
      }

      if (player.linkCodeExpires && player.linkCodeExpires < new Date()) {
        throw new BadRequestException('Claim code has expired');
      }
    }

    if (player.userId) {
      throw new BadRequestException('This player profile is already linked to a user');
    }

    // Check if user already has a claimed player profile in this tournament
    const existingPlayerInTournament = await this.db.player.findFirst({
      where: {
        userId,
        participant: {
          tournament_id: player.participant.tournament_id,
        },
      },
    });

    if (existingPlayerInTournament) {
      throw new BadRequestException('You already have a linked player profile in this tournament');
    }

    const feeAmount = 50000; // 500 Naira (50000 kobo)

    // 3. Initialize Paystack transaction
    const paystackResponse = await this.paystack.initializeTransaction({
      email: user.email,
      amount: feeAmount,
      metadata: {
        type: 'PLAYER_CLAIM',
        userId,
        playerId,
        ...(code && { code }),
        custom_fields: [
          {
            display_name: 'Player Name',
            variable_name: 'player_name',
            value: player.name,
          },
          {
            display_name: 'Tournament Name',
            variable_name: 'tournament_name',
            value: player.participant.tournament.name,
          },
          {
            display_name: 'Payment Type',
            variable_name: 'payment_type',
            value: 'Player Profile Claim Fee',
          },
        ],
      },
      callback_url: callbackUrl,
    });

    // 4. Create a PENDING payment record
    await this.db.payment.create({
      data: {
        amount: feeAmount,
        currency: 'NGN',
        status: PaymentStatus.PENDING,
        paystackReference: paystackResponse.data.reference,
        type: 'PLAYER_CLAIM',
        userId,
        metadata: {
          type: 'PLAYER_CLAIM',
          userId,
          playerId,
          ...(code && { code }),
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

  // ─── Verify ──────────────────────────────────────────────

  /**
   * Verify a payment after Paystack redirect.
   * Updates the Payment record and activates the Subscription.
   * Uses an atomic transaction with conditional update for race-safety.
   */
  async verifyPayment(reference: string) {
    // 1. Find the payment record
    const payment = await this.db.payment.findUnique({
      where: { paystackReference: reference },
    });
    if (!payment) throw new NotFoundException('Payment not found');

    // Already processed — idempotent return
    if (payment.status === PaymentStatus.SUCCESS) {
      if (payment.type === 'PLAYER_CLAIM') {
        const metadata = payment.metadata as any;
        return ResponseUtil.success({
          payment,
          player: { id: metadata?.playerId },
        });
      }

      if (payment.type === 'TOURNAMENT_REGISTRATION') {
        const metadata = payment.metadata as any;
        const participant = await this.db.participant.findFirst({
          where: {
            tournament_id: payment.tournamentId!,
            ...(metadata.teamId ? { team_id: metadata.teamId } : { user_id: payment.userId! }),
          },
          include: {
            user: true,
            team: true,
          }
        });
        return ResponseUtil.success({
          payment,
          participant,
          tournament: { id: payment.tournamentId },
        });
      }

      const subscription = payment.organizationId
        ? await this.db.subscription.findUnique({
            where: { organizationId: payment.organizationId },
          })
        : null;

      // Include tournament info for per-tournament upgrades
      if (payment.tournamentId) {
        return ResponseUtil.success({
          payment,
          subscription,
          tournament: { id: payment.tournamentId, isPremium: true },
        });
      }

      return ResponseUtil.success({ payment, subscription });
    }

    // 2. Verify with Paystack
    const verification = await this.paystack.verifyTransaction(reference);
    const txData = verification.data;

    let notifyPayload: any = null;

    if (txData.status === 'success') {
      // 3. Atomic transaction: update payment + activate subscription/tournament
      const result = await this.db.$transaction(async (tx) => {
        // Conditional update: only transitions PENDING → SUCCESS (race-safe)
        const updateResult = await tx.payment.updateMany({
          where: {
            id: payment.id,
            status: PaymentStatus.PENDING,
          },
          data: {
            status: PaymentStatus.SUCCESS,
            amount: txData.amount,
            currency: txData.currency,
            paystackTransactionId: String(txData.id),
          },
        });

        // Another process (webhook) already handled this — return current state
        if (updateResult.count === 0) {
          const currentPayment = await tx.payment.findUnique({ where: { id: payment.id } });
          if (payment.type === 'PLAYER_CLAIM') {
            const metadata = payment.metadata as any;
            return ResponseUtil.success({
              payment: currentPayment,
              player: { id: metadata?.playerId },
            });
          }

          if (payment.type === 'TOURNAMENT_REGISTRATION') {
            const metadata = payment.metadata as any;
            const participant = await tx.participant.findFirst({
              where: {
                tournament_id: payment.tournamentId!,
                ...(metadata.teamId ? { team_id: metadata.teamId } : { user_id: payment.userId! }),
              },
              include: {
                user: true,
                team: true,
              }
            });
            return ResponseUtil.success({
              payment: currentPayment,
              participant,
              tournament: { id: payment.tournamentId },
            });
          }

          const subscription = payment.organizationId
            ? await tx.subscription.findUnique({
                where: { organizationId: payment.organizationId },
              })
            : null;

          // Include tournament info for per-tournament upgrades
          if (payment.tournamentId) {
            return ResponseUtil.success({
              payment: currentPayment,
              subscription,
              tournament: { id: payment.tournamentId, isPremium: true },
            });
          }

          return ResponseUtil.success({ payment: currentPayment, subscription });
        }

        const updatedPayment = await tx.payment.findUnique({ where: { id: payment.id } });

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

          return ResponseUtil.success({
            payment: updatedPayment,
            player: { id: playerId },
          });
        }

        // Handle tournament registration payment
        if (payment.type === 'TOURNAMENT_REGISTRATION') {
          const metadata = payment.metadata as any;
          const { tournamentId, userId, teamId, customName, logoUrl, token } = metadata;

          let participant = await tx.participant.findFirst({
            where: {
              tournament_id: tournamentId,
              ...(teamId ? { team_id: teamId } : { user_id: userId }),
            },
            include: {
              user: true,
              team: true,
            }
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
              }
            });

            await tx.tournamentInvite.update({
              where: { token },
              data: { usedCount: { increment: 1 } },
            });

            const fullTournament = await tx.tournament.findUnique({
              where: { id: tournamentId }
            });
            if (participant.user?.email && fullTournament) {
              notifyPayload = {
                userEmail: participant.user.email,
                userName: participant.user.name,
                teamName: participant.customName || participant.team?.name || 'your team',
                tournamentName: fullTournament.name,
                tournamentUrl: `${process.env.CLIENT_URL || 'http://lvh.me:3001'}/t/${fullTournament.customName || fullTournament.id}`,
                tournamentLogoUrl: fullTournament.logoUrl || undefined,
              };
            }
          }

          return ResponseUtil.success({
            payment: updatedPayment,
            participant,
            tournament: { id: tournamentId },
          });
        }

        // 4. Handle per-tournament upgrade (no subscription period needed)
        if (payment.plan === SubscriptionPlan.PER_TOURNAMENT && payment.tournamentId) {
          await tx.tournament.update({
            where: { id: payment.tournamentId },
            data: { isPremium: true },
          });
          return ResponseUtil.success({
            payment: updatedPayment,
            tournament: { id: payment.tournamentId, isPremium: true },
          });
        }

        // 5. Activate org subscription with period calculation
        if (!payment.organizationId) {
          throw new BadRequestException('Organization ID is missing for subscription activation');
        }
        const now = new Date();
        const periodEnd = new Date(now);
        const interval = txData.plan_object?.interval;
        const planType = (payment.metadata as any)?.planType;

        if (interval === 'annually' || planType === PlanType.PRO_YEARLY) {
          periodEnd.setFullYear(periodEnd.getFullYear() + 1);
        } else {
          // Default to monthly for PRO_MONTHLY or when interval is 'monthly'
          periodEnd.setMonth(periodEnd.getMonth() + 1);
        }

        const subscription = await tx.subscription.upsert({
          where: { organizationId: payment.organizationId },
          create: {
            organizationId: payment.organizationId,
            plan: payment.plan || SubscriptionPlan.PRO,
            status: SubscriptionStatus.ACTIVE,
            paystackCustomerCode: txData.customer.customer_code,
            paystackPlanCode: txData.plan_object?.plan_code || (payment.metadata as any)?.planCode,
            currentPeriodStart: now,
            currentPeriodEnd: periodEnd,
          },
          update: {
            plan: payment.plan || SubscriptionPlan.PRO,
            status: SubscriptionStatus.ACTIVE,
            paystackCustomerCode: txData.customer.customer_code,
            paystackPlanCode: txData.plan_object?.plan_code || (payment.metadata as any)?.planCode,
            currentPeriodStart: now,
            currentPeriodEnd: periodEnd,
            cancelledAt: null,
          },
        });

        return ResponseUtil.success({ payment: updatedPayment, subscription });
      });

      if (notifyPayload) {
        try {
          this.eventEmitter.emit(EmailEvents.TOURNAMENT_JOIN_APPROVAL, notifyPayload);
        } catch (err) {
          this.logger.error('Failed to emit tournament join approval event via callback:', err);
        }
      }

      if (payment.type === 'PLAYER_CLAIM' && result.success) {
        const metadata = payment.metadata as any;
        await this.notifyOrganizersOfClaim(this.db, metadata.playerId, metadata.userId);
      }

      return result;
    } else {
      // Mark as failed
      await this.db.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.FAILED,
          paystackTransactionId: String(txData.id),
        },
      });

      throw new BadRequestException(
        `Payment verification failed: ${txData.status}`,
      );
    }
  }

  // ─── Webhook ─────────────────────────────────────────────

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
        await this.handleSubscriptionCreate(event.data);
        break;

      case 'subscription.not_renew':
      case 'subscription.disable':
        await this.handleSubscriptionDisabled(event.data);
        break;

      case 'invoice.payment_failed':
        await this.handlePaymentFailed(event.data);
        break;

      default:
        this.logger.debug(`Unhandled webhook event: ${eventType}`);
    }
  }

  // ─── Get Subscription ────────────────────────────────────

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

  // ─── Cancel Subscription ─────────────────────────────────

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

  // ─── Private Helpers ─────────────────────────────────────

  private async notifyOrganizersOfClaim(db: DatabaseService, playerId: string, userId: string) {
    try {
      const playerWithTourney = await db.player.findUnique({
        where: { id: playerId },
        include: {
          participant: {
            include: {
              tournament: {
                include: {
                  organization: {
                    include: {
                      members: {
                        where: {
                          role: { in: ['OWNER', 'ADMIN'] }
                        },
                        include: {
                          user: true
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      });

      if (playerWithTourney?.participant?.tournament?.organization?.members) {
        const playerUser = await db.user.findUnique({ where: { id: userId } });
        for (const member of playerWithTourney.participant.tournament.organization.members) {
          if (member.user?.email) {
            const notifyPayload = {
              organizerEmail: member.user.email,
              organizerName: member.user.name,
              playerName: playerUser?.name || playerWithTourney.name,
              teamName: playerWithTourney.participant.customName || 'Individual',
              tournamentName: playerWithTourney.participant.tournament.name,
              tournamentLogoUrl: playerWithTourney.participant.tournament.logoUrl || undefined,
            };
            this.eventEmitter.emit(EmailEvents.TEAM_JOIN_REQUEST, notifyPayload);
          }
        }
      }
    } catch (err) {
      this.logger.error('Failed to notify organizers of player claim:', err);
    }
  }

  private resolvePlanType(planType: PlanType): {
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


  // ─── Webhook Handlers ────────────────────────────────────

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

      // Handle tournament registration payment
      if (payment.type === 'TOURNAMENT_REGISTRATION') {
        const metadata = payment.metadata as any;
        const { tournamentId, userId, teamId, customName, logoUrl, token } = metadata;

        let participant = await tx.participant.findFirst({
          where: {
            tournament_id: tournamentId,
            ...(teamId ? { team_id: teamId } : { user_id: userId }),
          },
          include: {
            user: true,
            team: true,
          }
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
            }
          });

          await tx.tournamentInvite.update({
            where: { token },
            data: { usedCount: { increment: 1 } },
          });

          const fullTournament = await tx.tournament.findUnique({
            where: { id: tournamentId }
          });
          if (participant.user?.email && fullTournament) {
            notifyPayload = {
              userEmail: participant.user.email,
              userName: participant.user.name,
              teamName: participant.customName || participant.team?.name || 'your team',
              tournamentName: fullTournament.name,
              tournamentUrl: `${process.env.CLIENT_URL || 'http://lvh.me:3001'}/t/${fullTournament.customName || fullTournament.id}`,
              tournamentLogoUrl: fullTournament.logoUrl || undefined,
            };
          }
        }
        return;
      }

      // Handle per-tournament upgrade
      if (payment.plan === SubscriptionPlan.PER_TOURNAMENT && payment.tournamentId) {
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
        this.logger.warn(`Organization ID is missing for charge success callback ${reference}`);
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
          paystackPlanCode: data.plan_object?.plan_code || (payment.metadata as any)?.planCode,
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
        },
        update: {
          plan: payment.plan || SubscriptionPlan.PRO,
          status: SubscriptionStatus.ACTIVE,
          paystackCustomerCode: data.customer?.customer_code,
          paystackPlanCode: data.plan_object?.plan_code || (payment.metadata as any)?.planCode,
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
          cancelledAt: null,
        },
      });

      this.logger.log(
        `Subscription activated via webhook for org: ${payment.organizationId}`,
      );
    });

    if (notifyPayload) {
      try {
        this.eventEmitter.emit(EmailEvents.TOURNAMENT_JOIN_APPROVAL, notifyPayload);
      } catch (err) {
        this.logger.error('Failed to emit tournament join approval event via webhook:', err);
      }
    }

    if (payment.type === 'PLAYER_CLAIM') {
      const metadata = payment.metadata as any;
      await this.notifyOrganizersOfClaim(this.db, metadata.playerId, metadata.userId);
    }
  }

  private async handleSubscriptionCreate(data: any) {
    const customerCode = data.customer?.customer_code;
    if (!customerCode) return;

    // Find subscription by customer code
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

  private async handleSubscriptionDisabled(data: any) {
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

  private async handlePaymentFailed(data: any) {
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

  async getPaymentHistory(orgId: string) {
    const payments = await this.db.payment.findMany({
      where: { organizationId: orgId },
      orderBy: { created_at: 'desc' },
      include: {
        tournament: {
          select: { id: true, name: true },
        },
      },
    });

    return ResponseUtil.success(payments, 'Payment history retrieved');
  }
}
