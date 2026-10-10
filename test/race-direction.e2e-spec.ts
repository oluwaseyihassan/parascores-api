import { DatabaseService } from '../src/database/database.service';
import { FixturesService } from '../src/fixtures/fixtures.service';

/**
 * Race/placement ranking direction: 'low' (fastest wins, default) vs
 * 'high' (biggest value wins — weightlifting/jumps/throws), and the
 * h:mm:ss duration parse used by cycling-length times.
 */
describe('Race result ranking direction (e2e)', () => {
  let db: DatabaseService;
  let fixtures: FixturesService;
  let orgId: string;
  let userId: string;
  let tournamentId: string;
  let fixtureId: string;
  const participantIds: string[] = [];

  const cleanup = async () => {
    const org = await db.organization.findFirst({ where: { slug: 'race-dir-test' } });
    if (org) {
      await db.tournament.deleteMany({ where: { organization_id: org.id } });
      await db.organizationMember.deleteMany({ where: { organizationId: org.id } });
      await db.organization.delete({ where: { id: org.id } });
    }
    if (userId) {
      await db.user.delete({ where: { id: userId } }).catch(() => {});
    }
  };

  beforeAll(async () => {
    db = new DatabaseService();
    await db.$connect();
    // FixturesService has many collaborators; setResults only uses db + orgs + redis/live subjects.
    fixtures = new FixturesService(
      db as any,
      { validateMemberRole: () => Promise.resolve(true) } as any,
      { delPattern: () => Promise.resolve(), del: () => Promise.resolve() } as any,
      { sendNotificationToTournamentFollowers: () => Promise.resolve() } as any,
      {
        recordMatchEvent: () => Promise.resolve(),
        recordFixtureState: () => Promise.resolve(),
      } as any,
    );
    await cleanup();

    const user = await db.user.create({
      data: { email: `race-dir-${Date.now()}@test.dev`, name: 'Race Dir Tester' },
    });
    userId = user.id;
    const org = await db.organization.create({
      data: { name: 'Race Dir Org', slug: 'race-dir-test' },
    });
    orgId = org.id;
    await db.organizationMember.create({
      data: { organizationId: orgId, userId, role: 'OWNER' },
    });

    const t = await db.tournament.create({
      data: {
        name: 'Race Dir Tournament',
        type: 'RACE',
        sport: 'weightlifting',
        organization_id: orgId,
        participantType: 'INDIVIDUAL',
        scoringRules: {},
        start_date: new Date('2026-10-02'),
        end_date: new Date('2026-10-12'),
      },
    });
    tournamentId = t.id;

    for (const name of ['Lifter A', 'Lifter B', 'Lifter C']) {
      const p = await db.participant.create({
        data: { tournament_id: tournamentId, customName: name },
      });
      participantIds.push(p.id);
    }

    const f = await db.fixture.create({
      data: { tournament_id: tournamentId, round: 1, matchNumber: 1, roundName: 'Final' },
    });
    fixtureId = f.id;
  }, 60000);

  afterAll(async () => {
    await cleanup();
    await db.$disconnect();
  }, 30000);

  it('ranks highest value first with direction "high"', async () => {
    const res = await fixtures.setResults(fixtureId, userId, {
      direction: 'high',
      results: [
        { participantId: participantIds[0], value: '200' },
        { participantId: participantIds[1], value: '220' },
        { participantId: participantIds[2], value: '210' },
      ],
    });
    const entries = res.data?.resultEntries ?? [];
    const rankOf = (pid: string) => entries.find((e: any) => e.participantId === pid)?.rank;
    expect(rankOf(participantIds[1])).toBe(1); // 220
    expect(rankOf(participantIds[2])).toBe(2); // 210
    expect(rankOf(participantIds[0])).toBe(3); // 200
  }, 30000);

  it('ranks lowest value first with direction "low" (default)', async () => {
    const res = await fixtures.setResults(fixtureId, userId, {
      direction: 'low',
      results: [
        { participantId: participantIds[0], value: '200' },
        { participantId: participantIds[1], value: '220' },
        { participantId: participantIds[2], value: '210' },
      ],
    });
    const entries = res.data?.resultEntries ?? [];
    const rankOf = (pid: string) => entries.find((e: any) => e.participantId === pid)?.rank;
    expect(rankOf(participantIds[0])).toBe(1); // 200
    expect(rankOf(participantIds[2])).toBe(2); // 210
    expect(rankOf(participantIds[1])).toBe(3); // 220
  }, 30000);

  it('parses h:mm:ss durations (cycling-length times)', async () => {
    const res = await fixtures.setResults(fixtureId, userId, {
      results: [
        { participantId: participantIds[0], value: '1:02:33' },
        { participantId: participantIds[1], value: '0:59:10' },
      ],
    });
    const entries = res.data?.resultEntries ?? [];
    const rankOf = (pid: string) => entries.find((e: any) => e.participantId === pid)?.rank;
    expect(rankOf(participantIds[1])).toBe(1); // 59:10 beats 1:02:33
    expect(rankOf(participantIds[0])).toBe(2);
  }, 30000);
});
