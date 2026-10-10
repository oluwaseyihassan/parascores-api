import { EventEmitter2 } from '@nestjs/event-emitter';
import { DatabaseService } from '../src/database/database.service';
import { OrganizationsService } from '../src/organizations/organizations.service';
import { PulseService } from '../src/pulse/pulse.service';

/**
 * Event hub pulse feed: scoring hooks write cards (one per-match card
 * upserted by in-match events, standalone cards for state changes),
 * anonymous emoji reactions toggle per device, announcements pin first,
 * and unpublished hubs 404.
 */
describe('Event hub pulse (e2e)', () => {
  let db: DatabaseService;
  let service: PulseService;
  let orgId: string;
  let userId: string;
  let fixtureId: string;
  let nonHubFixtureId: string;

  const SUB = 'pulsetest';

  const cleanup = async () => {
    for (const sub of [SUB]) {
      const org = await db.organization.findUnique({
        where: { subdomain: sub },
        select: { id: true },
      });
      if (org) {
        await db.tournament.deleteMany({ where: { organization_id: org.id } });
        await db.organizationMember.deleteMany({
          where: { organizationId: org.id },
        });
        await db.organization.delete({ where: { id: org.id } });
      }
    }
    const plain = await db.organization.findFirst({
      where: { slug: 'pulse-plain-org' },
      select: { id: true },
    });
    if (plain) {
      await db.tournament.deleteMany({ where: { organization_id: plain.id } });
      await db.organization.delete({ where: { id: plain.id } });
    }
    if (userId) {
      await db.user.delete({ where: { id: userId } }).catch(() => {});
    }
  };

  beforeAll(async () => {
    db = new DatabaseService();
    await db.$connect();
    const orgs = new OrganizationsService(db, new EventEmitter2());
    service = new PulseService(db, orgs);
    await cleanup();

    const user = await db.user.create({
      data: { email: `pulse-${Date.now()}@test.dev`, name: 'Pulse Tester' },
    });
    userId = user.id;

    const org = await db.organization.create({
      data: { name: 'Pulse Test Org', slug: 'pulse-test-org', subdomain: SUB },
    });
    orgId = org.id;
    await db.organizationMember.create({
      data: { organizationId: orgId, userId, role: 'OWNER' },
    });

    const tournament = await db.tournament.create({
      data: {
        name: 'Pulse Football',
        type: 'KNOCKOUT',
        sport: 'football',
        organization_id: orgId,
        participantType: 'TEAM',
        scoringRules: {},
        start_date: new Date('2026-10-02'),
        end_date: new Date('2026-10-12'),
      },
    });
    const home = await db.participant.create({
      data: { tournament_id: tournament.id, customName: 'Uni Alpha', customShortName: 'ALP' },
    });
    const away = await db.participant.create({
      data: { tournament_id: tournament.id, customName: 'Uni Beta', customShortName: 'BET' },
    });
    const fixture = await db.fixture.create({
      data: {
        tournament_id: tournament.id,
        round: 1,
        matchNumber: 1,
        roundName: 'Semifinal',
        status: 'LIVE',
        homeTeamId: home.id,
        awayTeamId: away.id,
        homeScore: 2,
        awayScore: 1,
      },
    });
    fixtureId = fixture.id;

    // A fixture in an org with NO subdomain — hooks must no-op
    const plainOrg = await db.organization.create({
      data: { name: 'Plain Org', slug: 'pulse-plain-org' },
    });
    const plainTournament = await db.tournament.create({
      data: {
        name: 'Plain Football',
        type: 'KNOCKOUT',
        sport: 'football',
        organization_id: plainOrg.id,
        participantType: 'TEAM',
        scoringRules: {},
        start_date: new Date('2026-10-02'),
        end_date: new Date('2026-10-12'),
      },
    });
    const plainFixture = await db.fixture.create({
      data: {
        tournament_id: plainTournament.id,
        round: 1,
        matchNumber: 1,
        status: 'LIVE',
      },
    });
    nonHubFixtureId = plainFixture.id;
  }, 30000);

  afterAll(async () => {
    await cleanup();
    await db.$disconnect();
  }, 30000);

  it('writes a kickoff card and lists it', async () => {
    await service.recordFixtureState(fixtureId, 'kickoff');
    const res = await service.list(SUB, {});
    expect(res.data).toHaveLength(1);
    expect(res.data![0]).toMatchObject({ type: 'kickoff', reactions: {}, mine: [] });
    expect((res.data![0].payload as any).home.name).toBe('Uni Alpha');
  });

  it('upserts a single per-match card from in-match events', async () => {
    const mkEvent = (minute: number) =>
      db.matchEvent.create({
        data: {
          fixture_id: fixtureId,
          type: 'GOAL',
          minute,
          description: `Goal ${minute}'`,
        },
      });

    const e1 = await mkEvent(10);
    await service.recordMatchEvent(fixtureId, e1.id);
    const e2 = await mkEvent(55);
    await service.recordMatchEvent(fixtureId, e2.id);

    const res = await service.list(SUB, {});
    const matchCards = res.data!.filter((i) => i.type === 'match_event');
    expect(matchCards).toHaveLength(1);
    expect((matchCards[0].payload as any).event.description).toBe("Goal 55'");
    // bumped above the kickoff card
    expect(res.data![0].type).toBe('match_event');
  });

  it('ignores non-pulse event types and non-hub fixtures', async () => {
    const before = (await service.list(SUB, {})).data!.length;

    const draft = await db.matchEvent.create({
      data: { fixture_id: fixtureId, type: 'ASSIST', minute: 20 },
    });
    await service.recordMatchEvent(fixtureId, draft.id);

    await service.recordFixtureState(nonHubFixtureId, 'kickoff');

    const after = (await service.list(SUB, {})).data!.length;
    expect(after).toBe(before);
  });

  it('toggles anonymous reactions per device', async () => {
    const res = await service.list(SUB, {});
    const itemId = res.data![0].id;

    const on = await service.toggleReaction(SUB, itemId, 'device-aaa', '🔥');
    expect(on.data).toMatchObject({ reacted: true, reactions: { '🔥': 1 }, mine: ['🔥'] });

    // second device stacks
    await service.toggleReaction(SUB, itemId, 'device-bbb', '🔥');
    const counts = await service.toggleReaction(SUB, itemId, 'device-ccc', '👏');
    expect(counts.data!.reactions).toEqual({ '🔥': 2, '👏': 1 });

    // same device + same emoji un-reacts
    const off = await service.toggleReaction(SUB, itemId, 'device-aaa', '🔥');
    expect(off.data).toMatchObject({ reacted: false });
    expect(off.data!.reactions['🔥']).toBe(1);
    expect(off.data!.mine).not.toContain('🔥');

    // list reflects counts + device state
    const listed = await service.list(SUB, { deviceId: 'device-bbb' });
    const card = listed.data!.find((i) => i.id === itemId)!;
    expect(card.reactions['🔥']).toBe(1);
    expect(card.mine).toEqual(['🔥']);
  });

  it('posts pinned announcements ahead of the feed (org member only)', async () => {
    const res = await service.createAnnouncement(SUB, userId, {
      title: 'Venue change',
      body: 'Basketball final moves to Court 2',
      pinned: true,
    });
    expect(res.data).toMatchObject({ type: 'announcement', pinned: true });

    const listed = await service.list(SUB, {});
    expect(listed.data![0].type).toBe('announcement');
  });

  it('404s for unpublished hubs', async () => {
    await db.organization.update({
      where: { id: orgId },
      data: { brandConfig: { published: false } },
    });
    await expect(service.list(SUB, {})).rejects.toThrow(/not found/i);
    await db.organization.update({
      where: { id: orgId },
      data: { brandConfig: { published: true } },
    });
  });
});
