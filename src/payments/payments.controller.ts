import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Req,
  RawBodyRequest,
  HttpCode,
  HttpStatus,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaystackService } from './paystack.service';
import { InitializePaymentDto } from './dto/initialize-payment.dto';
import { InitializeRegistrationDto } from './dto/initialize-registration.dto';
import { InitializePlayerClaimDto } from './dto/initialize-player-claim.dto';
import { InitializeTeamJoinDto } from './dto/initialize-team-join.dto';
import { SetupPayoutAccountDto } from './dto/setup-payout-account.dto';
import { Public } from 'src/auth/decorators/public.decorator';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';

@ApiTags('Payments')
@Controller('payments')
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);

  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly paystackService: PaystackService,
  ) {}

  @Post('initialize')
  @ApiOperation({ summary: 'Initialize a subscription payment' })
  async initialize(@Body() dto: InitializePaymentDto, @Req() req: any) {
    return this.paymentsService.initializeSubscription(req.user.sub, dto);
  }

  @Post('initialize-registration')
  @ApiOperation({ summary: 'Initialize a tournament registration fee payment' })
  async initializeRegistration(
    @Body() dto: InitializeRegistrationDto,
    @Req() req: any,
  ) {
    return this.paymentsService.initializeRegistration(req.user.sub, dto);
  }

  @Post('initialize-player-claim')
  @ApiOperation({ summary: 'Initialize a player profile claim fee payment' })
  async initializePlayerClaim(
    @Body() dto: InitializePlayerClaimDto,
    @Req() req: any,
  ) {
    return this.paymentsService.initializePlayerClaim(req.user.sub, dto);
  }

  @Post('initialize-team-join')
  @ApiOperation({
    summary: 'Initialize a team join fee payment via invite link',
  })
  async initializeTeamJoin(
    @Body() dto: InitializeTeamJoinDto,
    @Req() req: any,
  ) {
    return this.paymentsService.initializeTeamJoin(req.user.sub, dto);
  }

  @Get('payout/banks')
  @ApiOperation({ summary: 'List banks supported for payout settlements' })
  async listBanks() {
    return this.paymentsService.listBanks();
  }

  @Get('payout/resolve-account')
  @ApiOperation({ summary: 'Resolve an account number to the account name' })
  async resolvePayoutAccount(
    @Query('accountNumber') accountNumber: string,
    @Query('bankCode') bankCode: string,
  ) {
    if (!accountNumber || !bankCode) {
      throw new BadRequestException('accountNumber and bankCode are required');
    }
    return this.paymentsService.resolvePayoutAccount(accountNumber, bankCode);
  }

  @Get('payout-account/:orgId')
  @ApiOperation({ summary: 'Get the payout account status for an organization' })
  async getPayoutAccount(@Param('orgId') orgId: string, @Req() req: any) {
    return this.paymentsService.getPayoutAccount(req.user.sub, orgId);
  }

  @Get('payout-summary/:orgId')
  @ApiOperation({
    summary: 'Get registration earnings summary for an organization',
  })
  async getPayoutSummary(@Param('orgId') orgId: string, @Req() req: any) {
    return this.paymentsService.getPayoutSummary(req.user.sub, orgId);
  }

  @Post('payout-account/:orgId')
  @ApiOperation({
    summary: 'Create or update the payout account for an organization',
  })
  async setupPayoutAccount(
    @Param('orgId') orgId: string,
    @Body() dto: SetupPayoutAccountDto,
    @Req() req: any,
  ) {
    return this.paymentsService.setupPayoutAccount(req.user.sub, orgId, dto);
  }

  @Get('verify/:reference')
  @ApiOperation({ summary: 'Verify a payment after Paystack redirect' })
  async verify(@Param('reference') reference: string) {
    return this.paymentsService.verifyPayment(reference);
  }

  @Public()
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Paystack webhook receiver' })
  async webhook(@Req() req: RawBodyRequest<Request>) {
    // 1. Validate the signature
    const signature = req.headers['x-paystack-signature'] as string;
    if (!signature) {
      throw new BadRequestException('Missing Paystack signature');
    }

    const rawBody = req.rawBody;
    if (!rawBody) {
      throw new BadRequestException('Missing raw body');
    }

    const isValid = this.paystackService.verifyWebhookSignature(
      rawBody,
      signature,
    );

    if (!isValid) {
      this.logger.warn('Invalid Paystack webhook signature');
      throw new BadRequestException('Invalid signature');
    }

    // 2. Process the event
    const event = req.body;
    await this.paymentsService.handleWebhook(event);

    // 3. Paystack expects a 200 response
    return { status: 'ok' };
  }

  @Get('subscription/:orgId')
  @ApiOperation({ summary: 'Get current subscription for an organization' })
  async getSubscription(@Param('orgId') orgId: string) {
    return this.paymentsService.getSubscription(orgId);
  }

  @Post('cancel/:orgId')
  @ApiOperation({ summary: 'Cancel subscription for an organization' })
  async cancelSubscription(@Param('orgId') orgId: string, @Req() req: any) {
    return this.paymentsService.cancelSubscription(req.user.sub, orgId);
  }

  @Get('history/:orgId')
  @ApiOperation({ summary: 'Get payment history for an organization' })
  async getPaymentHistory(@Param('orgId') orgId: string) {
    return this.paymentsService.getPaymentHistory(orgId);
  }
}
