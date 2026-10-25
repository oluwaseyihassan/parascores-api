import { Injectable, Logger } from '@nestjs/common';
import { InitializePaymentDto } from './dto/initialize-payment.dto';
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

import { PayoutsService } from './services/payouts.service';
import { SubscriptionsService } from './services/subscriptions.service';
import { DiscountCodesService } from './services/discount-codes.service';
import { PaymentsCheckoutService } from './services/payments-checkout.service';
import { PaymentsWebhookService } from './services/payments-webhook.service';
import { PaymentsHistoryService } from './services/payments-history.service';

/**
 * PaymentsService acts as a facade orchestrating payments operations
 * by delegating to focused domain-specific services.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly payoutsService: PayoutsService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly discountCodesService: DiscountCodesService,
    private readonly checkoutService: PaymentsCheckoutService,
    private readonly webhookService: PaymentsWebhookService,
    private readonly historyService: PaymentsHistoryService,
  ) {}

  // ─── Payout Accounts & Settlements ───────────────────────

  async listBanks() {
    return this.payoutsService.listBanks();
  }

  async resolvePayoutAccount(accountNumber: string, bankCode: string) {
    return this.payoutsService.resolvePayoutAccount(accountNumber, bankCode);
  }

  async getPayoutAccount(userId: string, organizationId: string) {
    return this.payoutsService.getPayoutAccount(userId, organizationId);
  }

  async setInstantPayouts(userId: string, orgId: string, enabled: boolean) {
    return this.payoutsService.setInstantPayouts(userId, orgId, enabled);
  }

  async setupPayoutAccount(
    userId: string,
    organizationId: string,
    dto: SetupPayoutAccountDto,
  ) {
    return this.payoutsService.setupPayoutAccount(userId, organizationId, dto);
  }

  async getPayoutSummary(userId: string, organizationId: string) {
    return this.payoutsService.getPayoutSummary(userId, organizationId);
  }

  async retryPayout(userId: string, paymentId: string) {
    return this.payoutsService.retryPayout(userId, paymentId);
  }

  // ─── Subscriptions ───────────────────────────────────────

  async initializeSubscription(userId: string, dto: InitializePaymentDto) {
    return this.subscriptionsService.initializeSubscription(userId, dto);
  }

  async getSubscription(orgId: string) {
    return this.subscriptionsService.getSubscription(orgId);
  }

  async cancelSubscription(userId: string, orgId: string) {
    return this.subscriptionsService.cancelSubscription(userId, orgId);
  }

  // ─── Checkouts & Registration ────────────────────────────

  async initializeRegistration(userId: string, dto: InitializeRegistrationDto) {
    return this.checkoutService.initializeRegistration(userId, dto);
  }

  async initializePlayerClaim(userId: string, dto: InitializePlayerClaimDto) {
    return this.checkoutService.initializePlayerClaim(userId, dto);
  }

  async initializeTeamJoin(userId: string, dto: InitializeTeamJoinDto) {
    return this.checkoutService.initializeTeamJoin(userId, dto);
  }

  async verifyPayment(reference: string) {
    return this.checkoutService.verifyPayment(reference);
  }

  async recordOfflinePayment(userId: string, dto: RecordOfflinePaymentDto) {
    return this.checkoutService.recordOfflinePayment(userId, dto);
  }

  // ─── Webhook ─────────────────────────────────────────────

  async handleWebhook(event: any) {
    return this.webhookService.handleWebhook(event);
  }

  // ─── Payment History & Reports ───────────────────────────

  async getPaymentHistory(orgId: string) {
    return this.historyService.getPaymentHistory(orgId);
  }

  async exportPaymentsCsv(
    userId: string,
    organizationId: string,
    tournamentId?: string,
  ) {
    return this.historyService.exportPaymentsCsv(
      userId,
      organizationId,
      tournamentId,
    );
  }

  async refundPayment(
    userId: string,
    paymentId: string,
    dto: RefundPaymentDto,
  ) {
    return this.historyService.refundPayment(userId, paymentId, dto);
  }

  // ─── Discount Codes ──────────────────────────────────────

  async listDiscountCodes(userId: string, tournamentId: string) {
    return this.discountCodesService.listDiscountCodes(userId, tournamentId);
  }

  async createDiscountCode(
    userId: string,
    tournamentId: string,
    dto: CreateDiscountCodeDto,
  ) {
    return this.discountCodesService.createDiscountCode(
      userId,
      tournamentId,
      dto,
    );
  }

  async updateDiscountCode(
    userId: string,
    id: string,
    dto: UpdateDiscountCodeDto,
  ) {
    return this.discountCodesService.updateDiscountCode(userId, id, dto);
  }

  async deleteDiscountCode(userId: string, id: string) {
    return this.discountCodesService.deleteDiscountCode(userId, id);
  }

  async validateDiscountCode(userId: string, dto: ValidateDiscountCodeDto) {
    return this.discountCodesService.validateDiscountCode(userId, dto);
  }
}
