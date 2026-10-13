import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import { OrganizationsService } from 'src/organizations/organizations.service';
import { FixturesService } from 'src/fixtures/fixtures.service';
import { ChatService } from 'src/chat/chat.service';
import {
  CreateScoreSubmissionDto,
  ResolveDisputeDto,
} from './dto/score-submission.dto';

/**
 * Double-entry score reporting (esports package): each participant submits
 * their own score for a fixture; matching entries auto-apply the result,
 * mismatches become a CONFLICT the organizer settles.
 *
 * Applying reuses FixturesService.update() as an org OWNER/ADMIN so bracket
 * progression, standings, and validation stay in one place.
 */
@Injectable()
export class ScoreSubmissionsService {
  private readonly logger = new Logger(ScoreSubmissionsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly orgs: OrganizationsService,
    private readonly fixtures: FixturesService,
    private readonly chat: ChatService,
  ) {}

  // ─── helpers ───────────────────────────────────────────

  private async loadFixture(fixtureId: string) {
    const fixture = await this.db.fixture.findUnique({
      where: { id: fixtureId },
      include: {
        tournament: {
          select: {
            id: true,
            name: true,
            customName: true,
            organization_id: true,
            requiresScoreEvidence: true,
            sport: true,
            chatEnabled: true,
          },
        },
        homeTeam: { select: { id: true, customName: true, user_id: true } },
        awayTeam: { select: { id: true, customName: true, user_id: true } },
      },
    });
    if (!fixture) throw new NotFoundException('Fixture not found');
    return fixture;
  }

  private participantName(p: { customName: string | null } | null) {
    return p?.customName ?? 'TBD';
  }

  private serialize(s: any) {
    return {
      id: s.id,
      fixtureId: s.fixtureId,
      participantId: s.participantId,
      participantName: this.participantName(s.participant),
      homeScore: s.homeScore,
      awayScore: s.awayScore,
      legs: s.legs,
      evidenceUrl: s.evidenceUrl,
      note: s.note,
      status: s.status,
      verdictNote: s.verdictNote,
      createdAt: s.createdAt,
      resolvedAt: s.resolvedAt,
    };
  }

  private async stateFor(fixtureId: string) {
    const subs = await this.db.scoreSubmission.findMany({
      where: { fixtureId },
      include: { participant: { select: { id: true, customName: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const open = subs.filter((s) => s.status === 'PENDING' || s.status === 'CONFLICT');
    const state =
      subs.some((s) => s.status === 'CONFLICT') ? 'conflict'
      : open.length === 1 ? 'awaitingOpponent'
      : subs.some((s) => s.status === 'MATCHED' || s.status === 'APPLIED') ? 'confirmed'
      : open.length === 0 ? 'none'
      : 'none';
    return { state, submissions: subs.map((s) => this.serialize(s)) };
  }

  // ─── participant submit (double-entry) ─────────────────

  async submit(fixtureId: string, userId: string, dto: CreateScoreSubmissionDto) {
    const fixture = await this.loadFixture(fixtureId);
    const t = fixture.tournament;

    if (fixture.status === 'COMPLETED') {
      throw new BadRequestException('This fixture already has a confirmed result');
    }
    if (!fixture.homeTeamId || !fixture.awayTeamId) {
      throw new BadRequestException('Fixture participants are not set yet');
    }

    // The submitter must be a claimed, confirmed participant in this fixture
    const participant = await this.db.participant.findFirst({
      where: {
        id: { in: [fixture.homeTeamId, fixture.awayTeamId] },
        user_id: userId,
        status: 'CONFIRMED',
      },
    });
    if (!participant) {
      throw new ForbiddenException('Only confirmed participants of this fixture can submit a score');
    }

    if (t.requiresScoreEvidence && !dto.evidenceUrl) {
      throw new BadRequestException('A result screenshot is required for this tournament');
    }

    // Upsert the participant's own entry (edit while still open)
    const existing = await this.db.scoreSubmission.findUnique({
      where: { fixtureId_participantId: { fixtureId, participantId: participant.id } },
    });
    if (existing && existing.status !== 'PENDING') {
      throw new BadRequestException('Your entry can no longer be edited');
    }

    const submission = existing
      ? await this.db.scoreSubmission.update({
          where: { id: existing.id },
          data: {
            homeScore: dto.homeScore,
            awayScore: dto.awayScore,
            legs: dto.legs ?? undefined,
            evidenceUrl: dto.evidenceUrl ?? existing.evidenceUrl,
            note: dto.note ?? existing.note,
          },
          include: { participant: { select: { id: true, customName: true } } },
        })
      : await this.db.scoreSubmission.create({
          data: {
            fixtureId,
            participantId: participant.id,
            homeScore: dto.homeScore,
            awayScore: dto.awayScore,
            legs: dto.legs ?? undefined,
            evidenceUrl: dto.evidenceUrl ?? null,
            note: dto.note ?? null,
          },
          include: { participant: { select: { id: true, customName: true } } },
        });

    // Compare with the opponent's entry
    const opponent = await this.db.scoreSubmission.findFirst({
      where: { fixtureId, participantId: { not: participant.id }, status: 'PENDING' },
      include: { participant: { select: { id: true, customName: true } } },
    });

    const home = this.participantName(fixture.homeTeam);
    const away = this.participantName(fixture.awayTeam);
    const me = this.participantName(participant);

    if (!opponent) {
      if (t.chatEnabled) {
        await this.chat.postBotCard(t.id, {
          text: `${me} submitted a score — awaiting the opponent's entry.`,
          cardType: 'SCORE_SUBMITTED',
          cardPayload: {
            fixtureId,
            home, away,
            homeTeamId: fixture.homeTeamId,
            awayTeamId: fixture.awayTeamId,
            submittedParticipantId: participant.id,
            score: { home: dto.homeScore, away: dto.awayScore },
            submittedBy: me,
            evidenceAttached: !!dto.evidenceUrl,
            evidenceUrl: dto.evidenceUrl ?? null,
            href: `/t/${t.customName || t.id}/fixture/${fixtureId}`,
          },
        });
      }
      return { state: 'awaitingOpponent', submission: this.serialize(submission) };
    }

    const matched =
      opponent.homeScore === dto.homeScore && opponent.awayScore === dto.awayScore;

    if (matched) {
      await this.applyResult(fixture, dto.homeScore, dto.awayScore, null, null);
      await this.db.scoreSubmission.updateMany({
        where: { fixtureId, status: 'PENDING' },
        data: { status: 'MATCHED', resolvedAt: new Date() },
      });
      if (t.chatEnabled) {
        await this.chat.postBotCard(t.id, {
          text: `Result confirmed: ${home} ${dto.homeScore}–${dto.awayScore} ${away}. Both entries matched.`,
          cardType: 'SCORE_CONFIRMED',
          cardPayload: {
            fixtureId,
            home, away,
            score: { home: dto.homeScore, away: dto.awayScore },
            by: 'players',
          },
        });
      }
      return { state: 'confirmed', submission: this.serialize(submission) };
    }

    // Mismatch → conflict
    await this.db.scoreSubmission.updateMany({
      where: { fixtureId, status: 'PENDING' },
      data: { status: 'CONFLICT' },
    });
    if (t.chatEnabled) {
      await this.chat.postBotCard(t.id, {
        text: `Score conflict on ${home} vs ${away} — the organizer is reviewing both entries.`,
        cardType: 'SCORE_CONFLICT',
        cardPayload: {
          fixtureId,
          home, away,
          claims: [
            { participantName: this.participantName(opponent.participant), score: { home: opponent.homeScore, away: opponent.awayScore }, evidenceUrl: opponent.evidenceUrl },
            { participantName: me, score: { home: dto.homeScore, away: dto.awayScore }, evidenceUrl: dto.evidenceUrl ?? null },
          ],
        },
      });
    }
    return { state: 'conflict', submission: this.serialize(submission) };
  }

  // ─── read state ────────────────────────────────────────

  async getForFixture(fixtureId: string, userId: string | null) {
    const fixture = await this.loadFixture(fixtureId);
    // Participants of the fixture + org members can read submission detail
    const allowed = userId
      ? (await this.db.participant.findFirst({
          where: {
            id: { in: [fixture.homeTeamId ?? '', fixture.awayTeamId ?? ''] },
            user_id: userId,
          },
          select: { id: true },
        })) ||
        (fixture.tournament.organization_id
          ? await this.db.organizationMember.findUnique({
              where: {
                organizationId_userId: {
                  organizationId: fixture.tournament.organization_id,
                  userId,
                },
              },
              select: { role: true },
            })
          : null)
      : null;
    if (!allowed) throw new ForbiddenException('Only the fixture participants and organizers can view submissions');
    return this.stateFor(fixtureId);
  }

  async listDisputes(tournamentId: string, userId: string) {
    const tournament = await this.db.tournament.findUnique({
      where: { id: tournamentId },
      select: { organization_id: true },
    });
    if (!tournament) throw new NotFoundException('Tournament not found');
    if (!tournament.organization_id) throw new ForbiddenException('Tournament has no organization');
    await this.orgs.validateMemberRole(tournament.organization_id, userId, ['OWNER', 'ADMIN', 'MEMBER']);

    const conflicts = await this.db.scoreSubmission.findMany({
      where: { status: 'CONFLICT', fixture: { tournament_id: tournamentId } },
      include: {
        participant: { select: { id: true, customName: true } },
        fixture: {
          select: {
            id: true, round: true, roundName: true, stage: true,
            homeTeam: { select: { customName: true } },
            awayTeam: { select: { customName: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Group the two entries per fixture
    const byFixture = new Map<string, any[]>();
    for (const s of conflicts) {
      const list = byFixture.get(s.fixtureId) ?? [];
      list.push(s);
      byFixture.set(s.fixtureId, list);
    }
    return [...byFixture.entries()].map(([fixtureId, subs]) => ({
      fixtureId,
      round: subs[0].fixture.roundName ?? subs[0].fixture.stage ?? `Round ${subs[0].fixture.round}`,
      home: subs[0].fixture.homeTeam?.customName ?? 'TBD',
      away: subs[0].fixture.awayTeam?.customName ?? 'TBD',
      submissions: subs.map((s) => this.serialize(s)),
    }));
  }

  // ─── organizer resolution ──────────────────────────────

  async resolve(fixtureId: string, userId: string, dto: ResolveDisputeDto) {
    const fixture = await this.loadFixture(fixtureId);
    const t = fixture.tournament;
    if (!t.organization_id) throw new ForbiddenException('Tournament has no organization');
    await this.orgs.validateMemberRole(t.organization_id, userId, ['OWNER', 'ADMIN', 'MEMBER']);

    const subs = await this.db.scoreSubmission.findMany({
      where: { fixtureId, status: 'CONFLICT' },
      include: { participant: { select: { id: true, customName: true } } },
    });
    if (subs.length === 0) throw new BadRequestException('No open conflict on this fixture');

    let homeScore: number;
    let awayScore: number;
    let acceptedId: string | null = null;

    if (dto.acceptSubmissionId) {
      const accepted = subs.find((s) => s.id === dto.acceptSubmissionId);
      if (!accepted) throw new BadRequestException('Submission not found in this conflict');
      homeScore = accepted.homeScore;
      awayScore = accepted.awayScore;
      acceptedId = accepted.id;
    } else if (dto.homeScore !== undefined && dto.awayScore !== undefined) {
      homeScore = dto.homeScore;
      awayScore = dto.awayScore;
    } else {
      throw new BadRequestException('Provide acceptSubmissionId or a custom score');
    }

    await this.applyResult(fixture, homeScore, awayScore, userId, dto.verdictNote ?? null);

    await this.db.scoreSubmission.updateMany({
      where: { fixtureId, status: 'CONFLICT' },
      data: {
        status: 'APPLIED',
        resolvedById: userId,
        resolvedAt: new Date(),
        verdictNote: dto.verdictNote ?? null,
      },
    });
    if (acceptedId) {
      // mark which entry was accepted (verdictNote carries it through)
      await this.db.scoreSubmission.update({
        where: { id: acceptedId },
        data: { verdictNote: dto.verdictNote ?? null },
      });
    }

    const home = this.participantName(fixture.homeTeam);
    const away = this.participantName(fixture.awayTeam);
    if (t.chatEnabled) {
      await this.chat.postBotCard(t.id, {
        text: `Result confirmed by the organizer: ${home} ${homeScore}–${awayScore} ${away}.${dto.verdictNote ? ` ${dto.verdictNote}` : ''}`,
        cardType: 'SCORE_CONFIRMED',
        cardPayload: { fixtureId, home, away, score: { home: homeScore, away: awayScore }, by: 'organizer' },
      });
    }
    return this.stateFor(fixtureId);
  }

  async dismiss(fixtureId: string, userId: string) {
    const fixture = await this.loadFixture(fixtureId);
    const t = fixture.tournament;
    if (!t.organization_id) throw new ForbiddenException('Tournament has no organization');
    await this.orgs.validateMemberRole(t.organization_id, userId, ['OWNER', 'ADMIN', 'MEMBER']);

    const count = await this.db.scoreSubmission.updateMany({
      where: { fixtureId, status: 'CONFLICT' },
      data: { status: 'DISMISSED', resolvedById: userId, resolvedAt: new Date() },
    });
    if (count.count === 0) throw new BadRequestException('No open conflict on this fixture');

    if (t.chatEnabled) {
      const home = this.participantName(fixture.homeTeam);
      const away = this.participantName(fixture.awayTeam);
      await this.chat.postBotCard(t.id, {
        text: `The score conflict on ${home} vs ${away} was dismissed by the organizer — please re-submit your scores with clear evidence.`,
      });
    }
    return this.stateFor(fixtureId);
  }

  // ─── apply via the existing fixture update path ────────

  private async applyResult(
    fixture: { id: string; tournament: { organization_id: string | null } },
    homeScore: number,
    awayScore: number,
    organizerUserId: string | null,
    _verdictNote: string | null,
  ) {
    const orgId = fixture.tournament.organization_id;
    if (!orgId) throw new ForbiddenException('Tournament has no organization');

    // Auto-confirm runs as an org OWNER/ADMIN (the players agreed); dispute
    // resolution runs as the deciding organizer.
    let applyUserId = organizerUserId;
    if (!applyUserId) {
      const owner = await this.db.organizationMember.findFirst({
        where: { organizationId: orgId, role: { in: ['OWNER', 'ADMIN'] } },
      });
      if (!owner) throw new ForbiddenException('No org owner/admin to apply the result');
      applyUserId = owner.userId;
    }

    await this.fixtures.update(fixture.id, applyUserId, {
      homeScore,
      awayScore,
      status: 'COMPLETED',
    } as any);
    this.logger.log(`Result applied on fixture ${fixture.id}: ${homeScore}-${awayScore}`);
  }
}
