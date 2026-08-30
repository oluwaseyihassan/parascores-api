import { EventEmitter2 } from '@nestjs/event-emitter';
import { DatabaseService } from '../src/database/database.service';
import { OrganizationsService } from '../src/organizations/organizations.service';

/**
 * Seeds a throwaway org (subdomain 'medaltest') covering the medal
 * aggregation rules: finals, league-standings derivation, in-progress
 * leagues (no medals), combat double-bronze, and non-combat knockouts
 * (single bronze only via third-place match).
 */
describe('Event hub medal table (e2e)', () => {
  let db: DatabaseService;
  let service: OrganizationsService;
  let orgId: string;

  const cleanup = async () => {
    const org = await db.organization.findUnique({
      where: { subdomain: 'medaltest' },
      select: { id: true },
    });
    if (!org) return;
    // Tournaments cascade participants/fixtures (FK onDelete); standings
    // cascade via participants. Org delete cascades roster entries.
    await db.tournament.deleteMany({ where: { organization_id: org.id } });
    await db.organization.delete({ where: { id: org.id } });
  };

  beforeAll(async () => {
    db = new DatabaseService();
    await db.$connect();
    service = new OrganizationsService(db, new EventEmitter2());
    await cleanup();

    const org = await db.organization.create({
      data: {
        name: 'Medal Test Org',
        slug: 'medal-test-org',
        subdomain: 'medaltest',
      },
    });
    orgId = org.id;

    // Six institutions on the roster
    const roster: Record<string, string> = {};
    for (const n of ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta']) {
      const entry = await db.rosterEntry.create({
        data: {
          organizationId: orgId,
          name: `Uni ${n}`,
          shortName: n.slice(0, 3).toUpperCase(),
        },
      });
      roster[n] = entry.id;
    }

    const mkTournament = async (name: string, type: any, sport: string) => {
      const t = await db.tournament.create({
        data: {
          name,
          type,
          sport,
          organization_id: orgId,
          participantType: 'TEAM',
          scoringRules: {},
          start_date: new Date('2026-10-02'),
          end_date: new Date('2026-10-12'),
        },
      });
      return t.id;
    };

    const mkParticipant = async (tournamentId: string, rosterKey: string) => {
      const p = await db.participant.create({
        data: { tournament_id: tournamentId, customName: `Uni ${rosterKey}` },
      });
      await db.tournamentEntry.create({
        data: { rosterEntryId: roster[rosterKey], participantId: p.id },
      });
      return p.id;
    };

    const mkFixture = (
      tournamentId: string,
      data: Partial<{
        roundName: string;
        status: any;
        homeTeamId: string;
        awayTeamId: string;
        homeScore: number;
        awayScore: number;
      }>,
    ) =>
      db.fixture.create({
        data: {
          tournament_id: tournamentId,
          round: 1,
          matchNumber: 1,
          ...data,
        },
      });

    // ── League (complete): medals from standings ──────────────────────
    const league = await mkTournament('Test League', 'LEAGUE', 'football');
    const [lA, lB, lC, lD] = [
      await mkParticipant(league, 'Alpha'),
      await mkParticipant(league, 'Beta'),
      await mkParticipant(league, 'Gamma'),
      await mkParticipant(league, 'Delta'),
    ];
    await mkFixture(league, { status: 'COMPLETED', homeTeamId: lA, awayTeamId: lB, homeScore: 1, awayScore: 0 });
    await mkFixture(league, { status: 'COMPLETED', homeTeamId: lC, awayTeamId: lD, homeScore: 2, awayScore: 2 });
    const standings = [
      { pid: lA, points: 9, position: 1 },
      { pid: lB, points: 6, position: 2 },
      { pid: lC, points: 4, position: 3 },
      { pid: lD, points: 1, position: 4 },
    ];
    for (const s of standings) {
      await db.standing.create({
        data: {
          tournament_id: league,
          participant_id: s.pid,
          points: s.points,
          position: s.position,
        },
      });
    }

    // ── League (in progress): no medals yet ───────────────────────────
    const leagueOpen = await mkTournament('Test League Open', 'LEAGUE', 'basketball');
    const oE = await mkParticipant(leagueOpen, 'Epsilon');
    const oF = await mkParticipant(leagueOpen, 'Zeta');
    await mkFixture(leagueOpen, { status: 'COMPLETED', homeTeamId: oE, awayTeamId: oF, homeScore: 40, awayScore: 30 });
    await mkFixture(leagueOpen, { status: 'SCHEDULED', homeTeamId: oF, awayTeamId: oE });

    // ── Combat knockout (boxing, no third-place): double bronze ───────
    const boxing = await mkTournament('Test Boxing', 'KNOCKOUT', 'boxing');
    const [bA, bB, bE, bF] = [
      await mkParticipant(boxing, 'Alpha'),
      await mkParticipant(boxing, 'Beta'),
      await mkParticipant(boxing, 'Epsilon'),
      await mkParticipant(boxing, 'Zeta'),
    ];
    await mkFixture(boxing, { roundName: 'Semi Final', status: 'COMPLETED', homeTeamId: bA, awayTeamId: bE, homeScore: 2, awayScore: 1 });
    await mkFixture(boxing, { roundName: 'Semi Final', status: 'COMPLETED', homeTeamId: bB, awayTeamId: bF, homeScore: 3, awayScore: 0 });
    await mkFixture(boxing, { roundName: 'Final', status: 'COMPLETED', homeTeamId: bA, awayTeamId: bB, homeScore: 1, awayScore: 0 });

    // ── Non-combat knockout (football, no third-place): no SF bronzes ─
    const footKo = await mkTournament('Test Football KO', 'KNOCKOUT', 'football');
    const [fA, fB, fC, fD] = [
      await mkParticipant(footKo, 'Alpha'),
      await mkParticipant(footKo, 'Beta'),
      await mkParticipant(footKo, 'Gamma'),
      await mkParticipant(footKo, 'Delta'),
    ];
    await mkFixture(footKo, { roundName: 'Semi Final', status: 'COMPLETED', homeTeamId: fA, awayTeamId: fB, homeScore: 1, awayScore: 0 });
    await mkFixture(footKo, { roundName: 'Semi Final', status: 'COMPLETED', homeTeamId: fC, awayTeamId: fD, homeScore: 2, awayScore: 1 });
    await mkFixture(footKo, { roundName: 'Final', status: 'COMPLETED', homeTeamId: fA, awayTeamId: fC, homeScore: 2, awayScore: 0 });
  }, 60000);

  afterAll(async () => {
    await cleanup();
    await db.$disconnect();
  }, 30000);

  it('aggregates finals, league standings, and combat double-bronze', async () => {
    const res = await service.getEventHubMedalTable('medaltest');
    const rows = res.data as any[];
    const byName = (n: string) => rows.find((r) => r.name === `Uni ${n}`);

    // Alpha: league gold + boxing gold + football gold
    expect(byName('Alpha')).toMatchObject({ gold: 3, silver: 0, bronze: 0, total: 3 });
    // Beta: league silver + boxing silver (football SF loss → nothing)
    expect(byName('Beta')).toMatchObject({ gold: 0, silver: 2, bronze: 0, total: 2 });
    // Gamma: league bronze + football silver
    expect(byName('Gamma')).toMatchObject({ gold: 0, silver: 1, bronze: 1, total: 2 });
    // Delta: league 4th + football SF loss (non-combat) → nothing
    expect(byName('Delta')).toMatchObject({ gold: 0, silver: 0, bronze: 0, total: 0 });
    // Epsilon + Zeta: boxing SF losers → one bronze each (double bronze)
    expect(byName('Epsilon')).toMatchObject({ gold: 0, silver: 0, bronze: 1, total: 1 });
    expect(byName('Zeta')).toMatchObject({ gold: 0, silver: 0, bronze: 1, total: 1 });

    // Sorted by gold first: Alpha leads
    expect(rows[0].name).toBe('Uni Alpha');
  }, 30000);
});
