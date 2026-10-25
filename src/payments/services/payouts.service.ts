import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import { OrganizationsService } from 'src/organizations/organizations.service';
import { PaystackService } from '../paystack.service';
import { SetupPayoutAccountDto } from '../dto/setup-payout-account.dto';
import { ResponseUtil } from 'src/utils/api-response';
import { PaymentStatus, SubscriptionPlan } from 'prisma/generated/client';

@Injectable()
export class PayoutsService {
  private readonly logger = new Logger(PayoutsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly paystack: PaystackService,
    private readonly organizationsService: OrganizationsService,
  ) {}

  get commissionPercent() {
    const free = Number(process.env.PLATFORM_COMMISSION_PERCENT || 5);
    const pro = Number(process.env.PLATFORM_COMMISSION_PERCENT_PRO || 3);
    return { free, pro };
  }

  commissionPercentForOrg(
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

  async getBankName(bankCode: string | null) {
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
        instantPayouts: true,
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
      instantPayouts: organization.instantPayouts,
    });
  }

  /**
   * Opt an organization into instant payouts. Money-routing config → OWNER only.
   * When enabled, registration payments skip the subaccount split (full amount
   * to the platform balance) and the organizer's share is pushed to their bank
   * via the Transfers API within minutes of payment.
   */
  async setInstantPayouts(userId: string, orgId: string, enabled: boolean) {
    await this.organizationsService.validateMemberRole(orgId, userId, [
      'OWNER',
    ]);

    const organization = await this.db.organization.findUnique({
      where: { id: orgId },
    });
    if (!organization) throw new NotFoundException('Organization not found');

    if (enabled) {
      if (
        !organization.settlementBankCode ||
        !organization.settlementAccountNumber
      ) {
        throw new BadRequestException(
          'Set up a payout account before enabling instant payouts',
        );
      }

      // Create the Paystack transfer recipient once, then reuse it
      if (!organization.paystackRecipientCode) {
        const recipient = await this.paystack.createTransferRecipient({
          type: 'nuban',
          name: organization.settlementAccountName || organization.name,
          account_number: organization.settlementAccountNumber,
          bank_code: organization.settlementBankCode,
        });
        await this.db.organization.update({
          where: { id: orgId },
          data: { paystackRecipientCode: recipient.data.recipient_code },
        });
      }
    }

    const updated = await this.db.organization.update({
      where: { id: orgId },
      data: { instantPayouts: enabled },
    });

    // Re-fire any payouts that previously failed (e.g. unfunded balance)
    if (enabled) {
      const stuck = await this.db.payment.findMany({
        where: {
          organizationId: orgId,
          type: 'TOURNAMENT_REGISTRATION',
          status: PaymentStatus.SUCCESS,
          payoutStatus: { in: ['FAILED', 'REVERSED'] },
        },
        select: { id: true },
      });
      for (const p of stuck) {
        await this.maybeInitiateInstantPayout(p.id);
      }
      if (stuck.length > 0) {
        this.logger.log(
          `Re-triggered ${stuck.length} failed payout(s) for org ${orgId}`,
        );
      }
    }

    return ResponseUtil.success(
      { instantPayouts: updated.instantPayouts },
      enabled
        ? 'Instant payouts enabled — registration fees arrive within minutes'
        : 'Instant payouts disabled — settlements return to next business day',
    );
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

  /**
   * For instant-payout orgs, transfer the organizer's share (gross minus
   * platform commission) to their settlement bank account via Paystack
   * Transfers. Runs after the payment's PENDING → SUCCESS transition, exactly
   * once per payment (guarded by payoutStatus + Paystack's reference dedupe).
   */
  async maybeInitiateInstantPayout(paymentId: string) {
    try {
      const payment = await this.db.payment.findUnique({
        where: { id: paymentId },
        include: { organization: { include: { subscription: true } } },
      });

      if (!payment || payment.type !== 'TOURNAMENT_REGISTRATION') return;
      if (payment.status !== PaymentStatus.SUCCESS) return;
      if (payment.amount <= 0) return; // waived registration — nothing to pay out

      const org = payment.organization;
      if (!org?.instantPayouts) return;

      // Only payments initialized in instant mode are payout-eligible —
      // split-mode payments already settled to the subaccount.
      if ((payment.metadata as any)?.instantPayout !== true) return;

      // Already underway or completed (e.g. webhook + callback both fired)
      if (
        payment.payoutStatus === 'PROCESSING' ||
        payment.payoutStatus === 'SUCCESS'
      ) {
        return;
      }

      if (!org.settlementBankCode || !org.settlementAccountNumber) {
        this.logger.warn(
          `Instant payout skipped: org ${org.id} has no settlement account`,
        );
        return;
      }

      // Create/reuse the Paystack transfer recipient
      let recipientCode = org.paystackRecipientCode;
      if (!recipientCode) {
        const recipient = await this.paystack.createTransferRecipient({
          type: 'nuban',
          name: org.settlementAccountName || org.name,
          account_number: org.settlementAccountNumber,
          bank_code: org.settlementBankCode,
        });
        recipientCode = recipient.data.recipient_code;
        await this.db.organization.update({
          where: { id: org.id },
          data: { paystackRecipientCode: recipientCode },
        });
      }

      const commissionPercent = this.commissionPercentForOrg(org);
      const payoutAmount = Math.round(
        (payment.amount * (100 - commissionPercent)) / 100,
      );

      await this.db.payment.update({
        where: { id: payment.id },
        data: {
          payoutStatus: 'PROCESSING',
          payoutAmount,
          payoutInitiatedAt: new Date(),
        },
      });

      // reference = payment reference → Paystack rejects duplicate transfers,
      // making callback/webhook double-fires and retries safe.
      const transfer = await this.paystack.initiateTransfer({
        amount: payoutAmount,
        recipient: recipientCode,
        reason: `Registration payout — ${payment.paystackReference}`,
        reference: payment.paystackReference,
      });

      await this.db.payment.update({
        where: { id: payment.id },
        data: { payoutTransferCode: transfer.data.transfer_code },
      });

      this.logger.log(
        `Instant payout initiated: ₦${payoutAmount / 100} → org ${org.id} (payment ${payment.id})`,
      );
    } catch (error: any) {
      this.logger.error(
        `Instant payout failed to initiate for payment ${paymentId}:`,
        error?.message,
      );
      await this.db.payment
        .update({
          where: { id: paymentId },
          data: { payoutStatus: 'FAILED' },
        })
        .catch(() => {});
    }
  }

  /**
   * Retry a failed/reversed instant payout (or one that never fired, e.g. it
   * completed before instant payouts existed). OWNER-only. The underlying
   * method re-checks eligibility and uses the payment reference as the
   * transfer idempotency key, so retries can't double-pay.
   */
  async retryPayout(userId: string, paymentId: string) {
    const payment = await this.db.payment.findUnique({
      where: { id: paymentId },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.type !== 'TOURNAMENT_REGISTRATION') {
      throw new BadRequestException('Only registration payments have payouts');
    }
    if (payment.status !== PaymentStatus.SUCCESS) {
      throw new BadRequestException(
        'Payouts can only be retried for successful payments',
      );
    }
    if (!payment.organizationId) {
      throw new BadRequestException('Payment is not linked to an organization');
    }
    if (
      payment.payoutStatus === 'PROCESSING' ||
      payment.payoutStatus === 'SUCCESS'
    ) {
      throw new BadRequestException(
        'This payout is already underway or completed',
      );
    }

    // Never pay out for payments that were initialized in split mode —
    // those already settled to the subaccount. Retrying them would
    // double-pay the organizer.
    if ((payment.metadata as any)?.instantPayout !== true) {
      throw new BadRequestException(
        'This payment was settled via the split account — no payout is due',
      );
    }

    await this.organizationsService.validateMemberRole(
      payment.organizationId,
      userId,
      ['OWNER'],
    );

    await this.maybeInitiateInstantPayout(payment.id);

    const refreshed = await this.db.payment.findUnique({
      where: { id: payment.id },
    });

    return ResponseUtil.success(
      refreshed,
      refreshed?.payoutStatus === 'PROCESSING'
        ? 'Payout initiated — funds typically arrive within minutes'
        : 'Payout could not be initiated — check the platform balance and try again',
    );
  }

  /**
   * transfer.* — final state of an instant payout. transfer.failed/reversed
   * mark the payout FAILED/REVERSED for manual follow-up (the organizer's
   * money is still in the platform balance; the registration itself stands).
   */
  async handleTransferUpdate(eventType: string, data: any) {
    const reference = data?.reference;
    if (!reference) return;

    const payment = await this.db.payment.findUnique({
      where: { paystackReference: reference },
    });
    if (!payment || !payment.payoutStatus) return;

    const status =
      eventType === 'transfer.success'
        ? 'SUCCESS'
        : eventType === 'transfer.failed'
          ? 'FAILED'
          : 'REVERSED';

    await this.db.payment.update({
      where: { id: payment.id },
      data: { payoutStatus: status },
    });
    this.logger.log(
      `Instant payout ${status} for payment ${payment.id} (${reference})`,
    );
  }
}
