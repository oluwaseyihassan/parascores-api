import { EventEmitter2 } from '@nestjs/event-emitter';
import { DatabaseService } from '../src/database/database.service';
import { OrganizationsService } from '../src/organizations/organizations.service';
import { PaymentsService } from '../src/payments/payments.service';

/**
 * Instant payouts: opt-in per org. Registration payments skip the subaccount
 * split (full amount → platform balance), and the organizer's share (gross
 * minus commission) is pushed via Transfers API on the success transition —
 * exactly once, with Paystack reference dedupe as the retry guard.
 */
describe('Instant payouts (e2e, mocked Paystack)', () => {
  let db: DatabaseService;
  let orgs: OrganizationsService;
  let payments: PaymentsService;

  const paystack = {
    initializeTransaction: jest.fn(),
    verifyTransaction: jest.fn(),
    createTransferRecipient: jest.fn(),
    initiateTransfer: jest.fn(),
    refundTransaction: jest.fn(),
  };

  const suffix = Date.now().toString(36);
  let ownerId: string;
  let adminId: string;
  let captainId: string;
  let captain2Id: string;
  let orgInstant: any;
  let orgSplit: any;
  let tournamentId: string;
  let inviteToken: string;

  const cleanup = async () => {
    const orgRows = await db.organization.findMany({
      where: { slug: { startsWith: `e2e-instant-${suffix}` } },
      select: { id: true },
    });
    const orgIds = orgRows.map((o) => o.id);
    const ts = await db.tournament.findMany({
      where: { organization_id: { in: orgIds } },
      select: { id: true },
    });
    const tIds = ts.map((t) => t.id);
    await db.discountCode.deleteMany({ where: { tournament_id: { in: tIds } } });
    await db.payment.deleteMany({ where: { organizationId: { in: orgIds } } });
    await db.participant.deleteMany({ where: { tournament_id: { in: tIds } } });
    await db.tournamentInvite.deleteMany({ where: { tournament_id: { in: tIds } } });
    await db.tournament.deleteMany({ where: { id: { in: tIds } } });
    await db.organizationMember.deleteMany({ where: { organizationId: { in: orgIds } } });
    await db.organization.deleteMany({ where: { id: { in: orgIds } } });
    await db.user.deleteMany({
      where: { email: { startsWith: `e2e-instant-${suffix}`, endsWith: '@test.dev' } },
    });
  };

  beforeAll(async () => {
    db = new DatabaseService();
    await db.$connect();
    orgs = new OrganizationsService(db, new EventEmitter2());
    payments = new PaymentsService(
      db,
      paystack as any,
      orgs,
      new EventEmitter2(),
    );
    await cleanup();

    const mkUser = (label: string, role: any = 'USER') =>
      db.user.create({
        data: {
          email: `e2e-instant-${suffix}-${label}@test.dev`,
          name: label,
          role,
          isEmailVerified: true,
        },
      });

    ownerId = (await mkUser('owner', 'ORGANIZER')).id;
    adminId = (await mkUser('admin', 'ORGANIZER')).id;
    captainId = (await mkUser('captain')).id;
    captain2Id = (await mkUser('captain2')).id;

    // Org with instant payouts ON (settlement account present, no subaccount needed)
    orgInstant = await db.organization.create({
      data: {
        name: `Instant Org ${suffix}`,
        slug: `e2e-instant-${suffix}-on`,
        settlementBankCode: '058',
        settlementAccountNumber: '0123456789',
        settlementAccountName: 'Instant Org',
        paystackSubaccountCode: 'ACCT_instant', // required by registration guard
        instantPayouts: true,
      },
    });

    // Org with instant payouts OFF (classic subaccount split)
    orgSplit = await db.organization.create({
      data: {
        name: `Split Org ${suffix}`,
        slug: `e2e-instant-${suffix}-off`,
        settlementBankCode: '058',
        settlementAccountNumber: '0123456789',
        settlementAccountName: 'Split Org',
        paystackSubaccountCode: 'ACCT_split',
      },
    });

    await db.organizationMember.createMany({
      data: [
        { organizationId: orgInstant.id, userId: ownerId, role: 'OWNER' },
        { organizationId: orgInstant.id, userId: adminId, role: 'ADMIN' },
        { organizationId: orgSplit.id, userId: ownerId, role: 'OWNER' },
      ],
    });

    const now = new Date();
    const mkTournament = (orgId: string, tag: string) =>
      db.tournament.create({
        data: {
          name: `Instant Cup ${suffix} ${tag}`,
          start_date: now,
          end_date: new Date(now.getTime() + 30 * 86400000),
          participantType: 'TEAM',
          sport: 'football',
          type: 'ROUND_ROBIN',
          scoringRules: {},
          organization_id: orgId,
          isPaidRegistration: true,
          registrationFee: 100000, // ₦1,000
        },
      });

    const t = await mkTournament(orgInstant.id, 'on');
    tournamentId = t.id;
    const inv = await db.tournamentInvite.create({
      data: { tournament_id: t.id, createdById: ownerId },
    });
    inviteToken = inv.token;
    await mkTournament(orgSplit.id, 'off');
  });

  afterAll(async () => {
    await cleanup();
    await db.$disconnect();
  });

  beforeEach(() => jest.clearAllMocks());

  it('rejects enabling instant payouts for non-OWNERs', async () => {
    await expect(
      payments.setInstantPayouts(adminId, orgInstant.id, true),
    ).rejects.toThrow('required permissions');
  });

  it('initializeRegistration skips subaccount split for instant orgs', async () => {
    paystack.initializeTransaction.mockResolvedValue({
      data: {
        authorization_url: 'https://checkout.test/x',
        access_code: 'ac',
        reference: `ref_instant_${suffix}`,
      },
    });

    await payments.initializeRegistration(captainId, {
      tournamentId,
      customName: 'Instant FC',
      token: inviteToken,
      callbackUrl: 'http://localhost/x',
    });

    const args = paystack.initializeTransaction.mock.calls[0][0];
    expect(args.subaccount).toBeUndefined();
    expect(args.bearer).toBeUndefined();
    expect(args.amount).toBe(100000);
    expect(args.metadata.instantPayout).toBe(true);
  });

  it('verifyPayment triggers exactly one transfer of gross minus 5% commission', async () => {
    const reference = `ref_instant_${suffix}`;
    paystack.verifyTransaction.mockResolvedValue({
      data: {
        id: 424242,
        status: 'success',
        reference,
        amount: 100000,
        currency: 'NGN',
        customer: { id: 1, email: 'x@test.dev', customer_code: 'CUS_x' },
      },
    });
    paystack.createTransferRecipient.mockResolvedValue({
      data: { id: 1, recipient_code: 'RCP_test', name: 'Instant Org' },
    });
    paystack.initiateTransfer.mockResolvedValue({
      data: { id: 1, transfer_code: 'TRF_test', reference, status: 'pending' },
    });

    await payments.verifyPayment(reference);

    expect(paystack.createTransferRecipient).toHaveBeenCalledTimes(1);
    expect(paystack.initiateTransfer).toHaveBeenCalledTimes(1);
    const transferArgs = paystack.initiateTransfer.mock.calls[0][0];
    expect(transferArgs.amount).toBe(95000); // 5% free-plan commission
    expect(transferArgs.recipient).toBe('RCP_test');
    expect(transferArgs.reference).toBe(reference); // idempotency key

    const payment = await db.payment.findUnique({ where: { paystackReference: reference } });
    expect(payment?.payoutStatus).toBe('PROCESSING');
    expect(payment?.payoutTransferCode).toBe('TRF_test');
    expect(payment?.payoutAmount).toBe(95000);

    const org = await db.organization.findUnique({ where: { id: orgInstant.id } });
    expect(org?.paystackRecipientCode).toBe('RCP_test');

    // Second verify (callback retry) → payment already SUCCESS → no new transfer
    await payments.verifyPayment(reference);
    expect(paystack.initiateTransfer).toHaveBeenCalledTimes(1);

    // Webhook double-fire → transition guard blocks a second payout
    await payments.handleWebhook({
      event: 'charge.success',
      data: { reference, amount: 100000, currency: 'NGN', id: 424242 },
    });
    expect(paystack.initiateTransfer).toHaveBeenCalledTimes(1);
  });

  it('transfer.success webhook marks the payout SUCCESS; failed marks FAILED', async () => {
    const reference = `ref_instant_${suffix}`;

    await payments.handleWebhook({
      event: 'transfer.success',
      data: { reference },
    });
    let payment = await db.payment.findUnique({ where: { paystackReference: reference } });
    expect(payment?.payoutStatus).toBe('SUCCESS');

    await payments.handleWebhook({
      event: 'transfer.failed',
      data: { reference },
    });
    payment = await db.payment.findUnique({ where: { paystackReference: reference } });
    expect(payment?.payoutStatus).toBe('FAILED');
  });

  it('split orgs keep the subaccount params and never trigger transfers', async () => {
    const t2 = await db.tournament.findFirst({
      where: { organization_id: orgSplit.id },
    });
    const inv2 = await db.tournamentInvite.create({
      data: { tournament_id: t2!.id, createdById: ownerId },
    });

    paystack.initializeTransaction.mockResolvedValue({
      data: {
        authorization_url: 'https://checkout.test/y',
        access_code: 'ac',
        reference: `ref_split_${suffix}`,
      },
    });

    await payments.initializeRegistration(captainId, {
      tournamentId: t2!.id,
      customName: 'Split FC',
      token: inv2.token,
      callbackUrl: 'http://localhost/y',
    });

    const args = paystack.initializeTransaction.mock.calls[0][0];
    expect(args.subaccount).toBe('ACCT_split');
    expect(args.bearer).toBe('subaccount');

    paystack.verifyTransaction.mockResolvedValue({
      data: {
        id: 555,
        status: 'success',
        reference: `ref_split_${suffix}`,
        amount: 100000,
        currency: 'NGN',
        customer: { id: 1, email: 'x@test.dev', customer_code: 'CUS_x' },
      },
    });

    await payments.verifyPayment(`ref_split_${suffix}`);
    expect(paystack.initiateTransfer).not.toHaveBeenCalled();
  });

  it('retryPayout re-fires failed payouts, with double-pay guard on split payments', async () => {
    // New instant-mode payment whose transfer fails once (insufficient balance)
    paystack.initializeTransaction.mockResolvedValue({
      data: {
        authorization_url: 'https://checkout.test/z',
        access_code: 'ac',
        reference: `ref_retry_${suffix}`,
      },
    });
    await payments.initializeRegistration(captain2Id, {
      tournamentId,
      customName: 'Retry FC',
      token: inviteToken,
      callbackUrl: 'http://localhost/z',
    });

    paystack.verifyTransaction.mockResolvedValue({
      data: {
        id: 777,
        status: 'success',
        reference: `ref_retry_${suffix}`,
        amount: 100000,
        currency: 'NGN',
        customer: { id: 1, email: 'r@test.dev', customer_code: 'CUS_r' },
      },
    });
    paystack.initiateTransfer.mockRejectedValueOnce(
      new Error('Your balance is not enough to fulfil this request'),
    );

    await payments.verifyPayment(`ref_retry_${suffix}`);

    const payment = await db.payment.findUnique({
      where: { paystackReference: `ref_retry_${suffix}` },
    });
    expect(payment?.payoutStatus).toBe('FAILED');

    // Non-owner cannot retry
    await expect(payments.retryPayout(adminId, payment!.id)).rejects.toThrow(
      'required permissions',
    );

    // Owner retries — succeeds (recipient already saved from the earlier test)
    paystack.initiateTransfer.mockResolvedValue({
      data: {
        id: 2,
        transfer_code: 'TRF_retry',
        reference: `ref_retry_${suffix}`,
        status: 'pending',
      },
    });
    const res = await payments.retryPayout(ownerId, payment!.id);
    expect(res.data?.payoutStatus).toBe('PROCESSING');
    expect(res.data?.payoutTransferCode).toBe('TRF_retry');

    // Split-mode payment can never be retried (double-pay guard)
    const splitPayment = await db.payment.findUnique({
      where: { paystackReference: `ref_split_${suffix}` },
    });
    await expect(payments.retryPayout(ownerId, splitPayment!.id)).rejects.toThrow(
      'split account',
    );
  });
});
