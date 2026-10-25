import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import { OrganizationsService } from 'src/organizations/organizations.service';
import { PaystackService } from '../paystack.service';
import { PayoutsService } from './payouts.service';
import { RefundPaymentDto } from '../dto/refund-payment.dto';
import { ResponseUtil } from 'src/utils/api-response';
import { PaymentStatus } from 'prisma/generated/client';

@Injectable()
export class PaymentsHistoryService {
  private readonly logger = new Logger(PaymentsHistoryService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly paystack: PaystackService,
    private readonly organizationsService: OrganizationsService,
    private readonly payoutsService: PayoutsService,
  ) {}

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

    const commissionPercent =
      this.payoutsService.commissionPercentForOrg(organization);
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
      const net =
        p.status === PaymentStatus.REFUNDED ? 0 : p.amount - commission;

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
      ]
        .map(escape)
        .join(',');
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

  /**
   * Refund a registration payment. Online payments are refunded via Paystack;
   * offline payments are only marked refunded (money moves off-platform).
   * Money out is OWNER-only.
   */
  async refundPayment(
    userId: string,
    paymentId: string,
    dto: RefundPaymentDto,
  ) {
    const payment = await this.db.payment.findUnique({
      where: { id: paymentId },
    });
    if (!payment) throw new NotFoundException('Payment not found');

    if (
      !['TOURNAMENT_REGISTRATION', 'OFFLINE_REGISTRATION'].includes(
        payment.type,
      )
    ) {
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

  /**
   * refund.processed — Paystack completed the refund. The payment was already
   * marked REFUNDED at initiation; record the final confirmation.
   */
  async handleRefundProcessed(data: any) {
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
  async handleRefundFailed(data: any) {
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
}
