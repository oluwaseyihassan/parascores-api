import { Module } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { PaystackService } from './paystack.service';
import { OrganizationsModule } from 'src/organizations/organizations.module';

import { PayoutsService } from './services/payouts.service';
import { SubscriptionsService } from './services/subscriptions.service';
import { DiscountCodesService } from './services/discount-codes.service';
import { PaymentsCheckoutService } from './services/payments-checkout.service';
import { PaymentsWebhookService } from './services/payments-webhook.service';
import { PaymentsHistoryService } from './services/payments-history.service';

@Module({
  imports: [OrganizationsModule],
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    PaystackService,
    PayoutsService,
    SubscriptionsService,
    DiscountCodesService,
    PaymentsCheckoutService,
    PaymentsWebhookService,
    PaymentsHistoryService,
  ],
  exports: [
    PaymentsService,
    PaystackService,
    PayoutsService,
    SubscriptionsService,
    DiscountCodesService,
    PaymentsCheckoutService,
    PaymentsWebhookService,
    PaymentsHistoryService,
  ],
})
export class PaymentsModule {}
