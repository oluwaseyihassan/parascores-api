import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import { OrganizationsService } from 'src/organizations/organizations.service';
import { ResponseUtil } from 'src/utils/api-response';
import { CreateAnnouncementDto } from './dto/pulse.dto';

/**
 * The Pulse: an auto-generated fan feed for event hubs. Scoring hooks
 * (match events, kickoff, full time, race results, medals) write cards;
 * fans attach anonymous emoji reactions. No user-generated text, so no
 * moderation surface.
 *
 * Card model: one row per (type, fixtureId). In-match events upsert a
 * single per-match card (latest event wins, card bumps to the top);
 * state changes (kickoff/full-time/medal/race result) are standalone.
 */
@Injectable()
export class PulseService {
  private readonly logger = new Logger(PulseService.name);

  /** Match event types that update the per-match pulse card. */
  private static readonly PULSE_EVENT_TYPES = [
    'GOAL',
    'OWN_GOAL',
    'PENALTY',
    'MISSED_PENALTY',
    'YELLOW_CARD',
    'RED_CARD',
    'SUBSTITUTION',
  ];

  constructor(
    private readonly db: DatabaseService,
    private readonly organizationsService: OrganizationsService,
  ) {}

  // ── Public read ──────────────────────────────────────────────────────

  private async resolvePublishedOrg(subdomain: string) {
    const org = await this.db.organization.findUnique({
      where: { subdomain },
      select: { id: true, brandConfig: true },
    });
    const brand = ((org?.brandConfig ?? {}) as Record<string, any>) ?? {};
    if (!org || brand.published === false) {
      throw new NotFoundException('Event hub not found');
    }
    return org;
  }

  async list(
    subdomain: string,
    opts: { limit?: number; deviceId?: string } = {},
  ) {
    const org = await this.resolvePublishedOrg(subdomain);
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);

    const items = await this.db.pulseItem.findMany({
      where: { organizationId: org.id },
      orderBy: [{ pinned: 'desc' }, { sortAt: 'desc' }],
      take: limit,
      include: {
        // Live scores ride along so match cards never show stale numbers
        fixture: {
          select: { homeScore: true, awayScore: true, status: true },
        },
      },
    });

    const ids = items.map((i) => i.id);
    const [counts, mine] = ids.length
      ? await Promise.all([
          this.db.pulseReaction.groupBy({
            by: ['pulseItemId', 'emoji'],
            where: { pulseItemId: { in: ids } },
            _count: { _all: true },
          }),
          opts.deviceId
            ? this.db.pulseReaction.findMany({
                where: { pulseItemId: { in: ids }, deviceId: opts.deviceId },
                select: { pulseItemId: true, emoji: true },
              })
            : Promise.resolve([] as { pulseItemId: string; emoji: string }[]),
        ])
      : [[], []];

    const countMap = new Map<string, Record<string, number>>();
    for (const c of counts as any[]) {
      const m = countMap.get(c.pulseItemId) ?? {};
      m[c.emoji] = c._count._all;
      countMap.set(c.pulseItemId, m);
    }
    const mineMap = new Map<string, string[]>();
    for (const r of mine as { pulseItemId: string; emoji: string }[]) {
      const arr = mineMap.get(r.pulseItemId) ?? [];
      arr.push(r.emoji);
      mineMap.set(r.pulseItemId, arr);
    }

    return ResponseUtil.success(
      items.map((item) => ({
        id: item.id,
        type: item.type,
        payload: item.payload,
        pinned: item.pinned,
        sortAt: item.sortAt,
        created_at: item.created_at,
        fixture: item.fixture,
        reactions: countMap.get(item.id) ?? {},
        mine: mineMap.get(item.id) ?? [],
      })),
    );
  }

  async toggleReaction(
    subdomain: string,
    itemId: string,
    deviceId: string,
    emoji: string,
  ) {
    const org = await this.resolvePublishedOrg(subdomain);
    const item = await this.db.pulseItem.findFirst({
      where: { id: itemId, organizationId: org.id },
      select: { id: true },
    });
    if (!item) throw new NotFoundException('Pulse item not found');

    const key = {
      pulseItemId_deviceId_emoji: { pulseItemId: item.id, deviceId, emoji },
    };
    const existing = await this.db.pulseReaction.findUnique({ where: key });
    if (existing) {
      await this.db.pulseReaction.delete({ where: { id: existing.id } });
    } else {
      await this.db.pulseReaction.create({
        data: { pulseItemId: item.id, deviceId, emoji },
      });
    }

    const counts = await this.db.pulseReaction.groupBy({
      by: ['emoji'],
      where: { pulseItemId: item.id },
      _count: { _all: true },
    });
    const reactions: Record<string, number> = {};
    for (const c of counts as any[]) reactions[c.emoji] = c._count._all;
    const mineRows = await this.db.pulseReaction.findMany({
      where: { pulseItemId: item.id, deviceId },
      select: { emoji: true },
    });

    return ResponseUtil.success({
      reacted: !existing,
      reactions,
      mine: mineRows.map((r) => r.emoji),
    });
  }

  // ── Organizer announcements (manual cards) ───────────────────────────

  async createAnnouncement(
    subdomain: string,
    userId: string,
    dto: CreateAnnouncementDto,
  ) {
    const org = await this.db.organization.findUnique({
      where: { subdomain },
      select: { id: true },
    });
    if (!org) throw new NotFoundException('Event hub not found');
    await this.organizationsService.validateMemberRole(org.id, userId, [
      'OWNER',
      'ADMIN',
    ]);

    const item = await this.db.pulseItem.create({
      data: {
        organizationId: org.id,
        type: 'announcement',
        pinned: dto.pinned ?? false,
        payload: { title: dto.title, body: dto.body },
      },
    });
    return ResponseUtil.success(item);
  }

  // ── Write hooks (fire-and-forget from scoring services) ──────────────

  private teamDisplay(team: any) {
    if (!team) return { name: 'TBD', abbr: 'TBD', logoUrl: null };
    const name = team.customName ?? team.team?.name ?? 'TBD';
    return {
      name,
      abbr: (team.customShortName ?? name.slice(0, 3)).toUpperCase(),
      logoUrl: team.logoUrl ?? null,
    };
  }

  /**
   * Load a fixture with its event-hub context. Returns null when the
   * fixture doesn't belong to a published hub org with a PUBLIC tournament
   * — the common case for ordinary tournaments, so hooks stay cheap no-ops.
   */
  private async loadFixtureContext(fixtureId: string) {
    const fixture = await this.db.fixture.findUnique({
      where: { id: fixtureId },
      include: {
        tournament: {
          select: {
            id: true,
            name: true,
            customName: true,
            sport: true,
            visibility: true,
            organization: {
              select: { id: true, subdomain: true, brandConfig: true },
            },
          },
        },
        homeTeam: {
          select: {
            customName: true,
            customShortName: true,
            logoUrl: true,
            team: { select: { name: true } },
          },
        },
        awayTeam: {
          select: {
            customName: true,
            customShortName: true,
            logoUrl: true,
            team: { select: { name: true } },
          },
        },
      },
    });

    const org = fixture?.tournament?.organization;
    if (!fixture || !org?.subdomain) return null;
    const brand = ((org.brandConfig ?? {}) as Record<string, any>) ?? {};
    if (brand.published === false) return null;
    if (fixture.tournament.visibility !== 'PUBLIC') return null;
    return { fixture, org };
  }

  private basePayload(fixture: any) {
    return {
      sport: fixture.tournament.sport as string,
      tournamentName: (fixture.tournament.customName ??
        fixture.tournament.name) as string,
      roundName: (fixture.roundName ?? null) as string | null,
      venue: (fixture.venue ?? null) as string | null,
      home: this.teamDisplay(fixture.homeTeam),
      away: this.teamDisplay(fixture.awayTeam),
    };
  }

  private async upsertCard(
    organizationId: string,
    fixtureId: string,
    type: string,
    payload: Record<string, any>,
    bump: boolean,
  ) {
    await this.db.pulseItem.upsert({
      where: { type_fixtureId: { type, fixtureId } },
      create: { organizationId, fixtureId, type, payload: payload as any },
      update: { payload: payload as any, ...(bump ? { sortAt: new Date() } : {}) },
    });
  }

  /** In-match event → upsert the per-match card (bumps it to the top). */
  async recordMatchEvent(fixtureId: string, eventId: string) {
    const event = await this.db.matchEvent.findUnique({
      where: { id: eventId },
      include: {
        player: { select: { name: true } },
        participant: {
          select: {
            customName: true,
            customShortName: true,
            team: { select: { name: true } },
          },
        },
      },
    });
    if (!event || !PulseService.PULSE_EVENT_TYPES.includes(event.type)) return;

    const ctx = await this.loadFixtureContext(fixtureId);
    if (!ctx) return;

    const who =
      event.player?.name ??
      event.participant?.customShortName ??
      event.participant?.customName ??
      event.participant?.team?.name ??
      null;
    const description =
      event.description ??
      `${event.type.replace(/_/g, ' ')}${who ? ` — ${who}` : ''}`;

    await this.upsertCard(
      ctx.org.id,
      fixtureId,
      'match_event',
      {
        ...this.basePayload(ctx.fixture),
        event: { type: event.type, minute: event.minute, description },
      },
      true,
    );
  }

  /** Fixture state change → standalone card. */
  async recordFixtureState(
    fixtureId: string,
    kind: 'kickoff' | 'full_time' | 'race_result' | 'medal',
    extra?: Record<string, any>,
  ) {
    const ctx = await this.loadFixtureContext(fixtureId);
    if (!ctx) return;
    const { fixture, org } = ctx;
    const base = this.basePayload(fixture);

    if (kind === 'race_result') {
      const topThree = await this.db.resultEntry.findMany({
        where: { fixtureId, rank: { in: [1, 2, 3] } },
        orderBy: { rank: 'asc' },
        include: {
          participant: {
            select: { customName: true, customShortName: true, logoUrl: true },
          },
        },
      });
      if (!topThree.length) return;
      await this.upsertCard(
        org.id,
        fixtureId,
        kind,
        {
          ...base,
          podium: topThree.map((e) => ({
            rank: e.rank,
            name: e.participant.customShortName ?? e.participant.customName,
            logoUrl: e.participant.logoUrl,
            value: e.value,
            note: e.note,
          })),
        },
        false,
      );
      return;
    }

    await this.upsertCard(org.id, fixtureId, kind, { ...base, ...extra }, false);
  }
}
