import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DatabaseService } from 'src/database/database.service';
import { OrganizationsService } from 'src/organizations/organizations.service';
import { PaystackService } from './paystack.service';
import { InitializePaymentDto, PlanType } from './dto/initialize-payment.dto';
import { InitializeRegistrationDto } from './dto/initialize-registration.dto';
import { InitializePlayerClaimDto } from './dto/initialize-player-claim.dto';
import { InitializeTeamJoinDto } from './dto/initialize-team-join.dto';
import { SetupPayoutAccountDto } from './dto/setup-payout-account.dto';
import { RecordOfflinePaymentDto } from './dto/record-offline-payment.dto';
import {
  CreateDiscountCodeDto,
  UpdateDiscountCodeDto,
  ValidateDiscountCodeDto,
} from './dto/discount-code.dto';
import { RefundPaymentDto } from './dto/refund-payment.dto';
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
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly paystack: PaystackService,
    private readonly organizationsService: OrganizationsService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ─── Payout Accounts (Subaccounts) ──────────────────────

  private get commissionPercent() {
    const free = Number(process.env.PLATFORM_COMMISSION_PERCENT || 5);
    const pro = Number(process.env.PLATFORM_COMMISSION_PERCENT_PRO || 3);
    return { free, pro };
  }

  async listBanks() {
    const response = await this.paystack.listBanks();
    return ResponseUtil.success(response.data);
  }

  async resolvePayoutAccount(accountNumber: string, bankCode: string) {
    try {
      const response = await this.paystack.resolveAccountNumber(
        accountNumber,
        bankCode,
      );
      return ResponseUtil.success(response.data);
    } catch (error: any) {
      throw new BadRequestException(
        error?.message || 'Could not resolve account number',
      );
    }
  }

  private banksCache: {
    at: number;
    banks: { code: string; name: string }[];
  } | null = null;

  private async getBankName(bankCode: string | null) {
    if (!bankCode) return null;
    try {
      const cacheFresh =
        this.banksCache && Date.now() - this.banksCache.at < 86400000;
      if (!cacheFresh) {
        const response = await this.paystack.listBanks();
        this.banksCache = { at: Date.now(), banks: response.data };
      }
      return (
        this.banksCache!.banks.find((b) => b.code === bankCode)?.name ?? null
      );
    } catch {
      return null;
    }
  }

  async getPayoutAccount(userId: string, organizationId: string) {
    await this.organizationsService.validateMemberRole(organizationId, userId, [
      'OWNER',
      'ADMIN',
    ]);

    const organization = await this.db.organization.findUnique({
      where: { id: organizationId },
      select: {
        paystackSubaccountCode: true,
        settlementBankCode: true,
        settlementAccountNumber: true,
        settlementAccountName: true,
        payoutAccountCreatedAt: true,
      },
    });

    if (!organization) throw new NotFoundException('Organization not found');

    const hasPayoutAccount = !!organization.paystackSubaccountCode;

    return ResponseUtil.success({
      hasPayoutAccount,
      bankCode: organization.settlementBankCode,
      bankName: await this.getBankName(organization.settlementBankCode),
      accountNumberMasked: organization.settlementAccountNumber
        ? `••••••${organization.settlementAccountNumber.slice(-4)}`
        : null,
      accountName: organization.settlementAccountName,
      createdAt: organization.payoutAccountCreatedAt,
    });
  }

  async setupPayoutAccount(
    userId: string,
    organizationId: string,
    dto: SetupPayoutAccountDto,
  ) {
    await this.organizationsService.validateMemberRole(organizationId, userId, [
      'OWNER',
      'ADMIN',
    ]);

    const organization = await this.db.organization.findUnique({
      where: { id: organizationId },
      include: { subscription: true },
    });
    if (!organization) throw new NotFoundException('Organization not found');

    let resolved: Awaited<
      ReturnType<PaystackService['resolveAccountNumber']>
    >;
    try {
      resolved = await this.paystack.resolveAccountNumber(
        dto.accountNumber,
        dto.bankCode,
      );
    } catch (error: any) {
      throw new BadRequestException(
        error?.message || 'Could not resolve account number',
      );
    }

    const commission = this.commissionPercent;
    const isPro =
      organization.subscription &&
      (organization.subscription.status === 'ACTIVE' ||
        organization.subscription.status === 'TRIALING') &&
      (organization.subscription.plan === SubscriptionPlan.PRO ||
        organization.subscription.plan === SubscriptionPlan.ENTERPRISE);
    const percentageCharge = isPro ? commission.pro : commission.free;

    // Paystack holds settlements when the subaccount business name does not
    // match the bank-verified account name — default to the resolved name
    const businessName =
      dto.businessName || resolved.data.account_name || organization.name;

    let subaccountCode = organization.paystackSubaccountCode;

    try {
      if (subaccountCode) {
        await this.paystack.updateSubaccount(subaccountCode, {
          business_name: businessName,
          settlement_bank: dto.bankCode,
          account_number: dto.accountNumber,
          percentage_charge: percentageCharge,
        });
      } else {
        const created = await this.paystack.createSubaccount({
          business_name: businessName,
          settlement_bank: dto.bankCode,
          account_number: dto.accountNumber,
          percentage_charge: percentageCharge,
          description: `Registration fee settlements for ${organization.name}`,
          primary_contact_email: undefined,
        });
        subaccountCode = created.data.subaccount_code;
      }
    } catch (error: any) {
      throw new BadRequestException(
        error?.message || 'Could not set up payout account with Paystack',
      );
    }

    await this.db.organization.update({
      where: { id: organizationId },
      data: {
        paystackSubaccountCode: subaccountCode,
        settlementBankCode: dto.bankCode,
        settlementAccountNumber: dto.accountNumber,
        settlementAccountName: resolved.data.account_name,
        payoutAccountCreatedAt:
          organization.payoutAccountCreatedAt ?? new Date(),
      },
    });

    return ResponseUtil.success(
      {
        hasPayoutAccount: true,
        accountName: resolved.data.account_name,
        accountNumberMasked: `••••••${dto.accountNumber.slice(-4)}`,
        commissionPercent: percentageCharge,
      },
      'Payout account saved',
    );
  }

  async getPayoutSummary(userId: string, organizationId: string) {
    await this.organizationsService.validateMemberRole(organizationId, userId, [
      'OWNER',
      'ADMIN',
    ]);

    const organization = await this.db.organization.findUnique({
      where: { id: organizationId },
      include: { subscription: true },
    });
    if (!organization) throw new NotFoundException('Organization not found');

    const payments = await this.db.payment.findMany({
      where: {
        organizationId,
        type: { in: ['TOURNAMENT_REGISTRATION', 'OFFLINE_REGISTRATION'] },
        status: PaymentStatus.SUCCESS,
      },
      include: {
        tournament: { select: { id: true, name: true } },
      },
    });

    const refunds = await this.db.payment.aggregate({
      where: {
        organizationId,
        type: { in: ['TOURNAMENT_REGISTRATION', 'OFFLINE_REGISTRATION'] },
        status: PaymentStatus.REFUNDED,
      },
      _sum: { amount: true },
      _count: { _all: true },
    });

    const commission = this.commissionPercent;
    const isPro =
      organization.subscription &&
      (organization.subscription.status === 'ACTIVE' ||
        organization.subscription.status === 'TRIALING') &&
      (organization.subscription.plan === SubscriptionPlan.PRO ||
        organization.subscription.plan === SubscriptionPlan.ENTERPRISE);
    const commissionPercent = isPro ? commission.pro : commission.free;
    // Commission applies only to online (split-settlement) payments —
    // offline collections never pass through the platform.
    const netOf = (p: { amount: number; type: string }) =>
      p.type === 'OFFLINE_REGISTRATION'
        ? p.amount
        : Math.round((p.amount * (100 - commissionPercent)) / 100);

    const totalGross = payments.reduce((sum, p) => sum + p.amount, 0);
    const totalNet = payments.reduce((sum, p) => sum + netOf(p), 0);
    const offlinePayments = payments.filter(
      (p) => p.type === 'OFFLINE_REGISTRATION',
    );
    const offlineGross = offlinePayments.reduce((sum, p) => sum + p.amount, 0);

    const byTournament = new Map<
      string,
      { id: string; name: string; count: number; gross: number; net: number }
    >();
    for (const p of payments) {
      const key = p.tournamentId || 'unknown';
      const existing = byTournament.get(key);
      if (existing) {
        existing.count++;
        existing.gross += p.amount;
        existing.net += netOf(p);
      } else {
        byTournament.set(key, {
          id: key,
          name: p.tournament?.name || 'Unknown tournament',
          count: 1,
          gross: p.amount,
          net: netOf(p),
        });
      }
    }

    const tournaments = [...byTournament.values()].sort(
      (a, b) => b.gross - a.gross,
    );

    return ResponseUtil.success({
      totalGross,
      totalNet,
      paymentCount: payments.length,
      commissionPercent,
      offlineGross,
      offlineCount: offlinePayments.length,
      refundedAmount: refunds._sum.amount ?? 0,
      refundCount: refunds._count._all,
      tournaments,
    });
  }

  // ─── Initialize ──────────────────────────────────────────

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
      const resolved = await this.resolveDiscountCode(
        resolvedTournamentId,
        rawDiscountCode,
      );
      if (!resolved.valid) {
        throw new BadRequestException(resolved.reason);
      }
      discountCode = resolved.code;
      finalAmount = this.applyDiscount(feeAmount, discountCode);
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

    // 2b. Initialize Paystack transaction (split: organizer's subaccount receives
    // settlement directly, platform keeps its commission percentage)
    const paystackResponse = await this.paystack.initializeTransaction({
      email: user.email,
      amount: finalAmount,
      subaccount: organization.paystackSubaccountCode,
      bearer: 'subaccount',
      metadata: {
        type: 'TOURNAMENT_REGISTRATION',
        userId,
        tournamentId: resolvedTournamentId,
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

      case 'refund.processed':
        await this.handleRefundProcessed(event.data);
        break;

      case 'refund.failed':
        await this.handleRefundFailed(event.data);
        break;

      default:
        this.logger.debug(`Unhandled webhook event: ${eventType}`);
    }
  }

  /**
   * refund.processed — Paystack completed the refund. The payment was already
   * marked REFUNDED at initiation; record the final confirmation.
   */
  private async handleRefundProcessed(data: any) {
    const reference = data?.transaction_reference;
    if (!reference) return;

    const payment = await this.db.payment.findUnique({
      where: { paystackReference: reference },
    });
    if (!payment || payment.status !== PaymentStatus.REFUNDED) return;

    await this.db.payment.update({
      where: { id: payment.id },
      data: {
        metadata: {
          ...((payment.metadata as any) || {}),
          refundStatus: 'processed',
          refundProcessedAt: new Date().toISOString(),
        },
      },
    });
    this.logger.log(`Refund processed for ${reference}`);
  }

  /**
   * refund.failed — Paystack could not complete the refund (e.g. insufficient
   * pending payout on the subaccount). Restore the payment to SUCCESS so it
   * counts in earnings again and can be retried or refunded manually.
   */
  private async handleRefundFailed(data: any) {
    const reference = data?.transaction_reference;
    if (!reference) return;

    const payment = await this.db.payment.findUnique({
      where: { paystackReference: reference },
    });
    if (!payment || payment.status !== PaymentStatus.REFUNDED) return;

    await this.db.payment.update({
      where: { id: payment.id },
      data: {
        status: PaymentStatus.SUCCESS,
        metadata: {
          ...((payment.metadata as any) || {}),
          refundStatus: 'failed',
          refundFailedAt: new Date().toISOString(),
        },
      },
    });
    this.logger.warn(
      `Refund failed for ${reference} — payment restored to SUCCESS`,
    );
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

  private async notifyOrganizersOfClaim(
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
      await this.notifyOrganizersOfClaim(
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
        await this.notifyOrganizersOfClaim(this.db, player.id, metadata.userId);
      }
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

  // ─── Offline Payments ─────────────────────────────────

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

  // ─── Settlement Report (CSV) ───────────────────────────

  /**
   * Export registration earnings (online + offline) as a CSV settlement report.
   * Returns the CSV as a string; the controller sets the file headers.
   */
  async exportPaymentsCsv(
    userId: string,
    organizationId: string,
    tournamentId?: string,
  ) {
    await this.organizationsService.validateMemberRole(
      organizationId,
      userId,
      ['OWNER', 'ADMIN'],
    );

    const organization = await this.db.organization.findUnique({
      where: { id: organizationId },
      include: { subscription: true },
    });
    if (!organization) throw new NotFoundException('Organization not found');

    const payments = await this.db.payment.findMany({
      where: {
        organizationId,
        type: { in: ['TOURNAMENT_REGISTRATION', 'OFFLINE_REGISTRATION'] },
        status: { in: [PaymentStatus.SUCCESS, PaymentStatus.REFUNDED] },
        ...(tournamentId && { tournamentId }),
      },
      include: {
        tournament: { select: { id: true, name: true } },
      },
      orderBy: { created_at: 'asc' },
    });

    // Enrich online registration payments with the paying team's name
    const teamIds = payments
      .map((p) => (p.metadata as any)?.teamId)
      .filter((id): id is string => !!id);
    const teams = teamIds.length
      ? await this.db.team.findMany({
          where: { id: { in: teamIds } },
          select: { id: true, name: true },
        })
      : [];
    const teamNameMap = new Map(teams.map((t) => [t.id, t.name]));

    const commissionPercent = this.commissionPercentForOrg(organization);
    const naira = (kobo: number) => (kobo / 100).toFixed(2);
    const escape = (v: string | number | null | undefined) => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const header = [
      'Date',
      'Tournament',
      'Payer / Team',
      'Channel',
      'Method / Detail',
      'Status',
      'Gross (NGN)',
      'Commission (NGN)',
      'Net (NGN)',
      'Reference',
    ];

    let totalGross = 0;
    let totalNet = 0;

    const rows = payments.map((p) => {
      const metadata = (p.metadata as any) || {};
      const isOffline = p.type === 'OFFLINE_REGISTRATION';
      const payer =
        metadata.payerName ||
        metadata.customName ||
        (metadata.teamId ? teamNameMap.get(metadata.teamId) : null) ||
        '';
      const commission = isOffline
        ? 0
        : p.amount - Math.round((p.amount * (100 - commissionPercent)) / 100);
      const net = p.status === PaymentStatus.REFUNDED ? 0 : p.amount - commission;

      if (p.status !== PaymentStatus.REFUNDED) {
        totalGross += p.amount;
        totalNet += net;
      }

      return [
        p.created_at.toISOString().slice(0, 10),
        p.tournament?.name || '',
        payer,
        isOffline ? 'Offline' : 'Online',
        isOffline ? metadata.method || '' : 'Paystack',
        p.status,
        naira(p.amount),
        naira(p.status === PaymentStatus.REFUNDED ? 0 : commission),
        naira(net),
        p.paystackReference,
      ].map(escape).join(',');
    });

    const totals = [
      '',
      '',
      '',
      '',
      '',
      'TOTALS',
      naira(totalGross),
      naira(totalGross - totalNet),
      naira(totalNet),
      '',
    ].join(',');

    return [header.join(','), ...rows, totals].join('\n');
  }

  // ─── Discount Codes ────────────────────────────────────

  async createDiscountCode(
    userId: string,
    tournamentId: string,
    dto: CreateDiscountCodeDto,
  ) {
    const tournament = await this.db.tournament.findFirst({
      where: { OR: [{ id: tournamentId }, { customName: tournamentId }] },
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

    if (dto.type === 'PERCENT' && (dto.value == null || dto.value < 1 || dto.value > 100)) {
      throw new BadRequestException(
        'Percent discount must be between 1 and 100',
      );
    }
    if (dto.type === 'FIXED' && (dto.value == null || dto.value <= 0)) {
      throw new BadRequestException('Fixed discount must be greater than zero');
    }

    const code = dto.code.trim().toUpperCase();
    const existing = await this.db.discountCode.findUnique({
      where: {
        tournament_id_code: { tournament_id: tournament.id, code },
      },
    });
    if (existing) {
      throw new ConflictException(
        `Code "${code}" already exists for this tournament`,
      );
    }

    const discountCode = await this.db.discountCode.create({
      data: {
        code,
        tournament_id: tournament.id,
        type: dto.type,
        value: dto.type === 'WAIVER' ? 0 : dto.value!,
        maxUses: dto.maxUses,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
        createdById: userId,
      },
    });

    return ResponseUtil.success(discountCode, 'Discount code created');
  }

  async listDiscountCodes(userId: string, tournamentId: string) {
    const tournament = await this.db.tournament.findFirst({
      where: { OR: [{ id: tournamentId }, { customName: tournamentId }] },
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

    const codes = await this.db.discountCode.findMany({
      where: { tournament_id: tournament.id },
      orderBy: { created_at: 'desc' },
    });

    return ResponseUtil.success(codes, 'Discount codes retrieved');
  }

  async updateDiscountCode(
    userId: string,
    id: string,
    dto: UpdateDiscountCodeDto,
  ) {
    const discountCode = await this.db.discountCode.findUnique({
      where: { id },
      include: { tournament: true },
    });
    if (!discountCode) throw new NotFoundException('Discount code not found');
    if (!discountCode.tournament.organization_id) {
      throw new BadRequestException('Tournament has no organization');
    }
    await this.organizationsService.validateMemberRole(
      discountCode.tournament.organization_id,
      userId,
      ['OWNER', 'ADMIN'],
    );

    const updated = await this.db.discountCode.update({
      where: { id },
      data: {
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        ...(dto.maxUses !== undefined && { maxUses: dto.maxUses }),
        ...(dto.expiresAt !== undefined && {
          expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        }),
      },
    });

    return ResponseUtil.success(updated, 'Discount code updated');
  }

  async deleteDiscountCode(userId: string, id: string) {
    const discountCode = await this.db.discountCode.findUnique({
      where: { id },
      include: { tournament: true },
    });
    if (!discountCode) throw new NotFoundException('Discount code not found');
    if (!discountCode.tournament.organization_id) {
      throw new BadRequestException('Tournament has no organization');
    }
    await this.organizationsService.validateMemberRole(
      discountCode.tournament.organization_id,
      userId,
      ['OWNER', 'ADMIN'],
    );

    await this.db.discountCode.delete({ where: { id } });

    return ResponseUtil.success(null, 'Discount code deleted');
  }

  /**
   * Preview a discount code for the join page. Any authenticated user may
   * validate — redemption limits are enforced again at registration time.
   */
  async validateDiscountCode(userId: string, dto: ValidateDiscountCodeDto) {
    void userId; // Authentication is enforced by the global AuthGuard
    const tournament = await this.db.tournament.findFirst({
      where: {
        OR: [{ id: dto.tournamentId }, { customName: dto.tournamentId }],
      },
    });
    if (!tournament) throw new NotFoundException('Tournament not found');

    const resolved = await this.resolveDiscountCode(tournament.id, dto.code);
    if (!resolved.valid) {
      return ResponseUtil.success({ valid: false, reason: resolved.reason });
    }

    const fee = tournament.registrationFee ?? 0;
    const finalAmount = this.applyDiscount(fee, resolved.code);

    return ResponseUtil.success({
      valid: true,
      type: resolved.code.type,
      value: resolved.code.value,
      originalAmount: fee,
      finalAmount,
    });
  }

  private async resolveDiscountCode(
    tournamentId: string,
    rawCode: string,
  ): Promise<
    | { valid: true; code: DiscountCode }
    | { valid: false; reason: string }
  > {
    const code = rawCode?.trim().toUpperCase();
    if (!code) return { valid: false, reason: 'No discount code provided' };

    const discountCode = await this.db.discountCode.findUnique({
      where: { tournament_id_code: { tournament_id: tournamentId, code } },
    });

    if (!discountCode || !discountCode.isActive) {
      return { valid: false, reason: 'Invalid discount code' };
    }
    if (discountCode.expiresAt && discountCode.expiresAt < new Date()) {
      return { valid: false, reason: 'Discount code has expired' };
    }
    if (discountCode.maxUses && discountCode.usedCount >= discountCode.maxUses) {
      return {
        valid: false,
        reason: 'Discount code has reached its maximum uses',
      };
    }

    return { valid: true, code: discountCode };
  }

  private applyDiscount(
    fee: number,
    code: Pick<DiscountCode, 'type' | 'value'>,
  ): number {
    switch (code.type) {
      case 'WAIVER':
        return 0;
      case 'PERCENT':
        return Math.round((fee * (100 - code.value)) / 100);
      case 'FIXED':
        return Math.max(0, fee - code.value);
      default:
        return fee;
    }
  }

  // ─── Refunds ───────────────────────────────────────────

  /**
   * Refund a registration payment. Online payments are refunded via Paystack;
   * offline payments are only marked refunded (money moves off-platform).
   * Money out is OWNER-only.
   */
  async refundPayment(userId: string, paymentId: string, dto: RefundPaymentDto) {
    const payment = await this.db.payment.findUnique({
      where: { id: paymentId },
    });
    if (!payment) throw new NotFoundException('Payment not found');

    if (!['TOURNAMENT_REGISTRATION', 'OFFLINE_REGISTRATION'].includes(payment.type)) {
      throw new BadRequestException(
        'Only registration payments can be refunded',
      );
    }
    if (payment.status === PaymentStatus.REFUNDED) {
      throw new BadRequestException('This payment has already been refunded');
    }
    if (payment.status !== PaymentStatus.SUCCESS) {
      throw new BadRequestException('Only successful payments can be refunded');
    }
    if (!payment.organizationId) {
      throw new BadRequestException('Payment is not linked to an organization');
    }

    await this.organizationsService.validateMemberRole(
      payment.organizationId,
      userId,
      ['OWNER'],
    );

    // Offline collections and zero-value waivers never touched Paystack
    const offPlatform =
      payment.type === 'OFFLINE_REGISTRATION' ||
      !payment.paystackTransactionId;

    // Manual refunds record the refund without calling Paystack — the
    // organizer returns the money themselves. This is the fallback when the
    // subaccount's pending payout can't cover an automatic refund (Paystack
    // deducts refunds from pending payouts first).
    const viaPaystack = !offPlatform && dto.manual !== true;

    if (viaPaystack) {
      try {
        await this.paystack.refundTransaction({
          transaction: payment.paystackReference,
          merchant_note: dto.reason
            ? `Organizer refund: ${dto.reason}`
            : 'Organizer-initiated refund',
          customer_note:
            dto.reason ||
            'Your registration fee has been refunded by the organizer.',
        });
      } catch (error: any) {
        this.logger.error(
          `Paystack refund failed for ${payment.paystackReference}:`,
          error?.message,
        );
        throw new BadRequestException(
          `${error?.message || 'Refund failed at the payment processor'}. If the payout balance is empty, wait for new registrations or refund manually instead.`,
        );
      }
    }

    const updated = await this.db.payment.update({
      where: { id: payment.id },
      data: {
        status: PaymentStatus.REFUNDED,
        metadata: {
          ...((payment.metadata as any) || {}),
          refundedBy: userId,
          refundedAt: new Date().toISOString(),
          refundReason: dto.reason || null,
          refundChannel: viaPaystack
            ? 'paystack'
            : offPlatform
              ? 'offline'
              : 'manual',
          refundStatus: viaPaystack ? 'pending' : 'manual',
        },
      },
    });

    return ResponseUtil.success(
      updated,
      viaPaystack
        ? 'Refund initiated with Paystack. The payer is typically credited within 3–10 business days.'
        : 'Payment marked as refunded — return the funds to the payer directly.',
    );
  }

  private commissionPercentForOrg(
    organization: { subscription?: any } | null,
  ): number {
    const commission = this.commissionPercent;
    const sub = organization?.subscription;
    const isPro =
      sub &&
      (sub.status === 'ACTIVE' || sub.status === 'TRIALING') &&
      (sub.plan === SubscriptionPlan.PRO ||
        sub.plan === SubscriptionPlan.ENTERPRISE);
    return isPro ? commission.pro : commission.free;
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

    // Enrich registration payments with the paying team's name
    const teamIds = payments
      .filter((p) =>
        ['TOURNAMENT_REGISTRATION', 'OFFLINE_REGISTRATION'].includes(p.type),
      )
      .map((p) => (p.metadata as any)?.teamId)
      .filter((id): id is string => !!id);

    const teams = teamIds.length
      ? await this.db.team.findMany({
          where: { id: { in: teamIds } },
          select: { id: true, name: true, logoUrl: true },
        })
      : [];
    const teamNameMap = new Map(teams.map((t) => [t.id, t.name]));
    const teamLogoMap = new Map(teams.map((t) => [t.id, t.logoUrl]));

    const enriched = payments.map((p) => {
      if (!['TOURNAMENT_REGISTRATION', 'OFFLINE_REGISTRATION'].includes(p.type))
        return p;
      const metadata = p.metadata as any;
      const teamName =
        metadata?.payerName ||
        metadata?.customName ||
        (metadata?.teamId ? teamNameMap.get(metadata.teamId) : null) ||
        null;
      const teamLogoUrl =
        metadata?.logoUrl ||
        (metadata?.teamId ? teamLogoMap.get(metadata.teamId) : null) ||
        null;
      return { ...p, teamName, teamLogoUrl };
    });

    return ResponseUtil.success(enriched, 'Payment history retrieved');
  }
}
