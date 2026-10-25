import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DatabaseService } from 'src/database/database.service';
import { OrganizationsService } from 'src/organizations/organizations.service';
import { PaystackService } from '../paystack.service';
import { PayoutsService } from './payouts.service';
import { DiscountCodesService } from './discount-codes.service';
import { InitializeRegistrationDto } from '../dto/initialize-registration.dto';
import { InitializePlayerClaimDto } from '../dto/initialize-player-claim.dto';
import { InitializeTeamJoinDto } from '../dto/initialize-team-join.dto';
import { RecordOfflinePaymentDto } from '../dto/record-offline-payment.dto';
import { PlanType } from '../dto/initialize-payment.dto';
import { ResponseUtil } from 'src/utils/api-response';
import {
  DiscountCode,
  PaymentStatus,
  SubscriptionPlan,
  SubscriptionStatus,
} from 'prisma/generated/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EmailEvents } from 'src/email/email.events';

@Injectable()
export class PaymentsCheckoutService {
  private readonly logger = new Logger(PaymentsCheckoutService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly paystack: PaystackService,
    private readonly organizationsService: OrganizationsService,
    private readonly eventEmitter: EventEmitter2,
    private readonly payoutsService: PayoutsService,
    private readonly discountCodesService: DiscountCodesService,
  ) {}

  /**
   * Initialize a Paystack transaction for a tournament registration fee.
   * Creates a PENDING Payment record and returns the Paystack checkout URL.
   */
  async initializeRegistration(userId: string, dto: InitializeRegistrationDto) {
    const {
      tournamentId,
      teamId,
      customName,
      logoUrl,
      token,
      callbackUrl,
      discountCode: rawDiscountCode,
    } = dto;

    // 1. Fetch details and validate
    const [tournament, user, invite] = await Promise.all([
      this.db.tournament.findFirst({
        where: {
          OR: [{ id: tournamentId }, { customName: tournamentId }],
        },
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

    const resolvedTournamentId = tournament.id;

    if (invite.tournament_id !== resolvedTournamentId) {
      throw new BadRequestException('Invite token does not match tournament');
    }

    if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
      throw new BadRequestException('Invite token has expired');
    }

    if (invite.maxUses && invite.usedCount >= invite.maxUses) {
      throw new BadRequestException(
        'Invite token has reached its maximum uses',
      );
    }

    // Block duplicate registration BEFORE any payment is initialized —
    // mirrors the free invite flow (same team, or same user when no team).
    // A PENDING payment (abandoned checkout) has no participant yet, so
    // retries stay possible.
    const existingParticipant = await this.db.participant.findFirst({
      where: {
        tournament_id: resolvedTournamentId,
        ...(teamId ? { team_id: teamId } : { user_id: userId }),
      },
    });

    if (existingParticipant) {
      throw new BadRequestException(
        existingParticipant.status === 'PENDING'
          ? 'You have already sent a request to join this tournament. Please wait for the organizer to approve it.'
          : 'This team is already registered in this tournament',
      );
    }

    if (!tournament.isPaidRegistration) {
      throw new BadRequestException(
        'This tournament does not require a registration fee',
      );
    }

    if (!tournament.organization_id) {
      throw new BadRequestException('Tournament organization is missing');
    }

    const organization = await this.db.organization.findUnique({
      where: { id: tournament.organization_id },
    });
    if (!organization?.paystackSubaccountCode) {
      throw new BadRequestException(
        'The organizer has not set up a payout account for this tournament yet, so paid registration is unavailable. Please contact the organizer.',
      );
    }

    // Check participant limit
    const currentParticipantCount = await this.db.participant.count({
      where: { tournament_id: resolvedTournamentId },
    });

    const subscription = await this.db.subscription.findUnique({
      where: { organizationId: tournament.organization_id },
    });
    const isPremium =
      tournament.isPremium ||
      (subscription &&
        (subscription.status === 'ACTIVE' ||
          subscription.status === 'TRIALING') &&
        (subscription.plan === 'PRO' || subscription.plan === 'ENTERPRISE'));

    if (!isPremium && currentParticipantCount >= 32) {
      throw new BadRequestException(
        'This tournament is on a Free plan and has reached its maximum limit of 32 participants.',
      );
    }

    const feeAmount = tournament.registrationFee;
    if (feeAmount <= 0) {
      throw new BadRequestException('Invalid registration fee amount');
    }

    // Resolve an optional discount/waiver code
    let discountCode: DiscountCode | null = null;
    let finalAmount = feeAmount;
    if (rawDiscountCode) {
      const resolved = await this.discountCodesService.resolveDiscountCode(
        resolvedTournamentId,
        rawDiscountCode,
      );
      if (!resolved.valid) {
        throw new BadRequestException(resolved.reason);
      }
      discountCode = resolved.code;
      finalAmount = this.discountCodesService.applyDiscount(
        feeAmount,
        discountCode,
      );
    }

    // 2a. Full waiver — register immediately without a Paystack checkout
    if (finalAmount <= 0) {
      const participant = await this.db.$transaction(async (tx) => {
        let participant = await tx.participant.findFirst({
          where: {
            tournament_id: resolvedTournamentId,
            ...(teamId ? { team_id: teamId } : { user_id: userId }),
          },
          include: { user: true, team: true },
        });

        if (participant) return participant; // Already registered — nothing to charge

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
            tournament_id: resolvedTournamentId,
            user_id: userId,
            team_id: teamId || null,
            customName: teamName,
            logoUrl: teamLogo,
            status: 'CONFIRMED',
          },
          include: { user: true, team: true },
        });

        await tx.tournamentInvite.update({
          where: { token },
          data: { usedCount: { increment: 1 } },
        });

        // Zero-value audit record so the registration appears in payment history
        await tx.payment.create({
          data: {
            organizationId: tournament.organization_id,
            tournamentId: resolvedTournamentId,
            amount: 0,
            currency: 'NGN',
            status: PaymentStatus.SUCCESS,
            paystackReference: `waiver_${randomUUID()}`,
            type: 'TOURNAMENT_REGISTRATION',
            userId,
            metadata: {
              type: 'TOURNAMENT_REGISTRATION',
              userId,
              tournamentId: resolvedTournamentId,
              teamId,
              customName,
              logoUrl,
              token,
              waived: true,
              discountCode: discountCode?.code || null,
              discountCodeId: discountCode?.id || null,
            },
          },
        });

        if (discountCode) {
          await tx.discountCode.updateMany({
            where: { id: discountCode.id },
            data: { usedCount: { increment: 1 } },
          });
        }

        return participant;
      });

      // Confirmation email (same event as the paid flow)
      if (participant.user?.email) {
        try {
          this.eventEmitter.emit(EmailEvents.TOURNAMENT_JOIN_APPROVAL, {
            userEmail: participant.user.email,
            userName: participant.user.name,
            teamName:
              participant.customName || participant.team?.name || 'your team',
            tournamentName: tournament.name,
            tournamentUrl: `${process.env.CLIENT_URL || 'http://lvh.me:3001'}/t/${tournament.customName || tournament.id}`,
            tournamentLogoUrl: tournament.logoUrl || undefined,
          });
        } catch (err) {
          this.logger.error('Failed to emit join approval event:', err);
        }
      }

      return ResponseUtil.success(
        { waived: true, participant },
        'Registration fee waived — registration complete',
      );
    }

    // 2b. Initialize Paystack transaction. Default: split at settlement via
    // the organizer's subaccount (platform keeps its commission percentage).
    // Instant-payout orgs skip the split — the full amount lands in the
    // platform balance and the organizer's share is transferred out on success.
    const split = !organization.instantPayouts;

    const paystackResponse = await this.paystack.initializeTransaction({
      email: user.email,
      amount: finalAmount,
      ...(split && {
        subaccount: organization.paystackSubaccountCode!,
        bearer: 'subaccount' as const,
      }),
      metadata: {
        type: 'TOURNAMENT_REGISTRATION',
        userId,
        tournamentId: resolvedTournamentId,
        teamId,
        customName,
        logoUrl,
        token,
        instantPayout: organization.instantPayouts,
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
          ...(discountCode
            ? [
                {
                  display_name: 'Discount Code',
                  variable_name: 'discount_code',
                  value: discountCode.code,
                },
              ]
            : []),
        ],
      },
      callback_url: callbackUrl,
    });

    // 3. Create a PENDING payment record associated with the tournament's organization
    await this.db.payment.create({
      data: {
        organizationId: tournament.organization_id,
        tournamentId: resolvedTournamentId,
        amount: finalAmount,
        currency: 'NGN',
        status: PaymentStatus.PENDING,
        paystackReference: paystackResponse.data.reference,
        type: 'TOURNAMENT_REGISTRATION',
        userId,
        metadata: {
          type: 'TOURNAMENT_REGISTRATION',
          userId,
          tournamentId: resolvedTournamentId,
          teamId,
          customName,
          logoUrl,
          token,
          accessCode: paystackResponse.data.access_code,
          instantPayout: organization.instantPayouts,
          ...(discountCode && {
            discountCode: discountCode.code,
            discountCodeId: discountCode.id,
            originalFee: feeAmount,
          }),
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
      if (
        !player.linkCode ||
        player.linkCode.toUpperCase() !== code.toUpperCase()
      ) {
        throw new BadRequestException('Invalid claim code');
      }

      if (player.linkCodeExpires && player.linkCodeExpires < new Date()) {
        throw new BadRequestException('Claim code has expired');
      }
    }

    if (player.userId) {
      throw new BadRequestException(
        'This player profile is already linked to a user',
      );
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
      throw new BadRequestException(
        'You already have a linked player profile in this tournament',
      );
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

  /**
   * Initialize a Paystack transaction for registering/joining a team via invite link.
   * Creates a PENDING Payment record and returns the Paystack checkout URL.
   */
  async initializeTeamJoin(userId: string, dto: InitializeTeamJoinDto) {
    const { token, name, number, position, avatarUrl, callbackUrl } = dto;

    // 1. Fetch user and invite details
    const [user, invite] = await Promise.all([
      this.db.user.findUnique({ where: { id: userId } }),
      this.db.teamInvite.findUnique({
        where: { token },
        include: {
          participant: true,
          tournament: true,
        },
      }),
    ]);

    if (!user) throw new NotFoundException('User not found');
    if (!invite) throw new NotFoundException('Invite link not found');

    if (!invite.isActive) {
      throw new BadRequestException('This invite link has been revoked');
    }

    if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
      throw new BadRequestException('This invite link has expired');
    }

    if (invite.maxUses && invite.usedCount >= invite.maxUses) {
      throw new BadRequestException(
        'This invite link has reached its maximum number of uses',
      );
    }

    // Check if user is already registered for ANY team in this same tournament
    const alreadyInTournament = await this.db.player.findFirst({
      where: {
        userId,
        status: { in: ['APPROVED', 'PENDING'] },
        participant: {
          tournament_id: invite.tournament_id,
        },
      },
    });

    if (alreadyInTournament) {
      throw new BadRequestException(
        'You are already registered or have a pending request in this tournament',
      );
    }

    const feeAmount = 50000; // 500 Naira (50000 kobo)

    // 2. Initialize Paystack transaction
    const paystackResponse = await this.paystack.initializeTransaction({
      email: user.email,
      amount: feeAmount,
      metadata: {
        type: 'TEAM_JOIN',
        userId,
        token,
        name,
        number,
        position,
        avatarUrl,
        custom_fields: [
          {
            display_name: 'Player Name',
            variable_name: 'player_name',
            value: name,
          },
          {
            display_name: 'Tournament Name',
            variable_name: 'tournament_name',
            value: invite.tournament.name,
          },
          {
            display_name: 'Team Name',
            variable_name: 'team_name',
            value: invite.participant.customName || 'Unknown Team',
          },
          {
            display_name: 'Payment Type',
            variable_name: 'payment_type',
            value: 'Player Registration Fee',
          },
        ],
      },
      callback_url: callbackUrl,
    });

    // 3. Create a PENDING payment record
    await this.db.payment.create({
      data: {
        amount: feeAmount,
        currency: 'NGN',
        status: PaymentStatus.PENDING,
        paystackReference: paystackResponse.data.reference,
        type: 'TEAM_JOIN',
        userId,
        tournamentId: invite.tournament_id,
        metadata: {
          type: 'TEAM_JOIN',
          userId,
          token,
          name,
          number,
          position,
          avatarUrl,
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
   * Verify a payment after Paystack redirect.
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
            ...(metadata.teamId
              ? { team_id: metadata.teamId }
              : { user_id: payment.userId! }),
          },
          include: {
            user: true,
            team: true,
          },
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
      let justTransitioned = false;
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
          const currentPayment = await tx.payment.findUnique({
            where: { id: payment.id },
          });
          if (payment.type === 'PLAYER_CLAIM') {
            const metadata = payment.metadata as any;
            return ResponseUtil.success({
              payment: currentPayment,
              player: { id: metadata?.playerId },
            });
          }

          if (payment.type === 'TEAM_JOIN') {
            const metadata = payment.metadata as any;
            const invite = await tx.teamInvite.findUnique({
              where: { token: metadata.token },
            });
            const player = await tx.player.findFirst({
              where: {
                userId: metadata.userId,
                participantId: invite?.participant_id,
              },
            });
            return ResponseUtil.success({
              payment: currentPayment,
              player,
              status: player?.status,
            });
          }

          if (payment.type === 'TOURNAMENT_REGISTRATION') {
            const metadata = payment.metadata as any;
            const participant = await tx.participant.findFirst({
              where: {
                tournament_id: payment.tournamentId!,
                ...(metadata.teamId
                  ? { team_id: metadata.teamId }
                  : { user_id: payment.userId! }),
              },
              include: {
                user: true,
                team: true,
              },
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

          return ResponseUtil.success({
            payment: currentPayment,
            subscription,
          });
        }

        justTransitioned = true;
        const updatedPayment = await tx.payment.findUnique({
          where: { id: payment.id },
        });

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

          // Save the created player ID in the payment metadata
          const updatedMetadata = {
            ...(payment.metadata as any),
            playerId: player.id,
          };

          const finalPayment = await tx.payment.update({
            where: { id: payment.id },
            data: { metadata: updatedMetadata },
          });

          await tx.teamInvite.update({
            where: { id: invite.id },
            data: { usedCount: { increment: 1 } },
          });

          return ResponseUtil.success({
            payment: finalPayment,
            player,
            status,
          });
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
                  participant.customName ||
                  participant.team?.name ||
                  'your team',
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
        if (
          payment.plan === SubscriptionPlan.PER_TOURNAMENT &&
          payment.tournamentId
        ) {
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
          throw new BadRequestException(
            'Organization ID is missing for subscription activation',
          );
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
            paystackPlanCode:
              txData.plan_object?.plan_code ||
              (payment.metadata as any)?.planCode,
            currentPeriodStart: now,
            currentPeriodEnd: periodEnd,
          },
          update: {
            plan: payment.plan || SubscriptionPlan.PRO,
            status: SubscriptionStatus.ACTIVE,
            paystackCustomerCode: txData.customer.customer_code,
            paystackPlanCode:
              txData.plan_object?.plan_code ||
              (payment.metadata as any)?.planCode,
            currentPeriodStart: now,
            currentPeriodEnd: periodEnd,
            cancelledAt: null,
          },
        });

        return ResponseUtil.success({ payment: updatedPayment, subscription });
      });

      // Instant payout (opt-in orgs): push the organizer's share out now
      if (justTransitioned) {
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
            'Failed to emit tournament join approval event via callback:',
            err,
          );
        }
      }

      if (payment.type === 'PLAYER_CLAIM' && result.success) {
        const metadata = payment.metadata as any;
        await this.notifyOrganizersOfClaim(
          this.db,
          metadata.playerId,
          metadata.userId,
        );
      }

      if (payment.type === 'TEAM_JOIN' && result.success) {
        const metadata = payment.metadata as any;
        const player = (result as any).data?.player;
        if (player && player.status === 'PENDING') {
          await this.notifyOrganizersOfClaim(
            this.db,
            player.id,
            metadata.userId,
          );
        }
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

  /**
   * Record a registration payment collected outside the platform
   * (cash / direct bank transfer) so the dashboard reconciles all income.
   */
  async recordOfflinePayment(userId: string, dto: RecordOfflinePaymentDto) {
    const tournament = await this.db.tournament.findFirst({
      where: {
        OR: [{ id: dto.tournamentId }, { customName: dto.tournamentId }],
      },
    });
    if (!tournament) throw new NotFoundException('Tournament not found');
    if (!tournament.organization_id) {
      throw new BadRequestException('Tournament has no organization');
    }

    await this.organizationsService.validateMemberRole(
      tournament.organization_id,
      userId,
      ['OWNER', 'ADMIN'],
    );

    // Optionally link an existing participant
    let participant: any = null;
    if (dto.participantId) {
      participant = await this.db.participant.findUnique({
        where: { id: dto.participantId },
        include: { team: true },
      });
      if (!participant || participant.tournament_id !== tournament.id) {
        throw new BadRequestException(
          'Participant does not belong to this tournament',
        );
      }
    }

    const amount = dto.amount ?? tournament.registrationFee;
    if (!amount || amount <= 0) {
      throw new BadRequestException('Amount must be greater than zero');
    }

    const payerName =
      dto.payerName ||
      participant?.customName ||
      participant?.team?.name ||
      null;

    const payment = await this.db.payment.create({
      data: {
        organizationId: tournament.organization_id,
        tournamentId: tournament.id,
        userId: participant?.user_id || null,
        amount,
        currency: 'NGN',
        status: PaymentStatus.SUCCESS,
        paystackReference: `offline_${randomUUID()}`,
        type: 'OFFLINE_REGISTRATION',
        metadata: {
          channel: 'OFFLINE',
          method: dto.method,
          note: dto.note || null,
          payerName,
          participantId: participant?.id || null,
          recordedBy: userId,
        },
      },
    });

    return ResponseUtil.success(payment, 'Offline payment recorded');
  }

  async notifyOrganizersOfClaim(
    db: DatabaseService,
    playerId: string,
    userId: string,
  ) {
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
                          role: { in: ['OWNER', 'ADMIN'] },
                        },
                        include: {
                          user: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      });

      if (playerWithTourney?.participant?.tournament?.organization?.members) {
        const playerUser = await db.user.findUnique({ where: { id: userId } });
        for (const member of playerWithTourney.participant.tournament
          .organization.members) {
          if (member.user?.email) {
            const notifyPayload = {
              organizerEmail: member.user.email,
              organizerName: member.user.name,
              playerName: playerUser?.name || playerWithTourney.name,
              teamName:
                playerWithTourney.participant.customName || 'Individual',
              tournamentName: playerWithTourney.participant.tournament.name,
              tournamentLogoUrl:
                playerWithTourney.participant.tournament.logoUrl || undefined,
            };
            this.eventEmitter.emit(
              EmailEvents.TEAM_JOIN_REQUEST,
              notifyPayload,
            );
          }
        }
      }
    } catch (err) {
      this.logger.error('Failed to notify organizers of player claim:', err);
    }
  }
}
