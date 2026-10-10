import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DatabaseService } from 'src/database/database.service';
import { RedisService } from 'src/redis/redis.service';
import { ChatService } from 'src/chat/chat.service';
import { AiService } from 'src/ai/ai.service';

type ParageeIntent = 'nextMatch' | 'table' | 'topScorer' | 'rules' | null;

interface ParageeMentionPayload {
  tournamentId: string;
  messageId: string;
  authorParticipantId: string | null;
  authorUserId: string;
  text: string;
  // Set when the message replies to a Paragee message — follow-up context
  replyContext?: { text: string; cardType: string | null } | null;
}

/**
 * Paragee — template tier. Answers @paragee mentions with deterministic,
 * SQL-backed responses (no LLM): next match, table, top scorer, rules.
 * Capability + rate-limit flags come from tournament.parageeBot.
 */
@Injectable()
export class ParageeService {
  private readonly logger = new Logger(ParageeService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly chat: ChatService,
    private readonly redis: RedisService,
    private readonly ai: AiService,
  ) {}

  @OnEvent('chat.parageeMention', { async: true })
  async handleMention(payload: ParageeMentionPayload) {
    const { tournamentId, authorParticipantId, authorUserId, text, replyContext } = payload;
    try {
      const tournament = await this.db.tournament.findUnique({
        where: { id: tournamentId },
        select: {
          id: true,
          customName: true,
          chatRules: true,
          parageeBot: true,
          timezone: true,
        },
      });
      if (!tournament) return;
      const flags = (tournament.parageeBot as any) ?? {};
      if (!flags.enabled) return;

      // Rate limit: 10 bot questions per user per hour.
      // RedisService returns null when offline → permissive in that case.
      const rlKey = `paragee:rl:${tournamentId}:${authorUserId}`;
      const used = (await this.redis.get<number>(rlKey)) ?? 0;
      if (used >= 10) {
        await this.answer(tournamentId, payload.messageId, {
          text: 'Easy 😅 — that’s the question limit for now (10/hour). The organizer can help you directly.',
        });
        return;
      }

      const intent = classify(text);

      // Capability gating (organizer toggles in the manage rail)
      const gateKey =
        intent === 'nextMatch' ? 'fixtures'
        : intent === 'table' || intent === 'topScorer' ? 'standings'
        : intent === 'rules' ? 'rules'
        : null;
      if (gateKey && flags[gateKey] === false) {
        await this.answer(tournamentId, payload.messageId, {
          text: 'That answer is disabled by the organizer for this room 🙊',
        });
        return;
      }

      let answer: { text: string; cardType?: any; cardPayload?: any };
      switch (intent) {
        case 'nextMatch':
          answer = await this.nextMatch(tournament, authorParticipantId);
          break;
        case 'table':
          answer = await this.table(tournamentId);
          break;
        case 'topScorer':
          answer = await this.topScorer(tournamentId);
          break;
        case 'rules':
          answer = this.rules(tournament.chatRules);
          break;
        default: {
          // Sensitive topics never get a free-form answer — always escalate
          if (isSensitive(text)) {
            answer = {
              text: 'That one needs a human — the organizer will jump in 🙋 (disputes, payments and rulings are always handled by them).',
            };
            this.logger.log(`Paragee escalation (sensitive): tournament=${tournamentId} text="${text.slice(0, 120)}"`);
            break;
          }
          // LLM tier (parageeBot.llm flag + AI_API_KEY configured): free-form,
          // grounded in a tournament-scoped context bundle
          if (flags.llm && this.ai.configured) {
            this.chat.emitBotThinking(tournamentId, true);
            try {
              const llmAnswer = await this.groundedAnswer(tournament, authorParticipantId, text, replyContext);
              if (llmAnswer) {
                answer = { text: llmAnswer };
                break;
              }
              this.logger.warn(`Paragee LLM fallback (call failed): tournament=${tournamentId}`);
            } finally {
              this.chat.emitBotThinking(tournamentId, false);
            }
          }
          answer = {
            text: "I'm not sure about that one — flagging the organizer to jump in 🙋",
          };
          this.logger.log(`Paragee escalation (no intent): tournament=${tournamentId} text="${text.slice(0, 120)}"`);
        }
      }

      await this.redis.set(rlKey, used + 1, 3600);
      await this.answer(tournamentId, payload.messageId, answer);
    } catch (err) {
      this.logger.error(`Paragee mention handling failed: ${(err as Error).message}`);
    }
  }

  /** Post a bot card + bump the per-tournament Paragee call counter. Answers quote the question. */
  private async answer(
    tournamentId: string,
    replyToId: string | null,
    card: { text: string; cardType?: any; cardPayload?: any },
  ) {
    await this.chat.postBotCard(tournamentId, { ...card, replyToId });
    await this.db.tournament.update({
      where: { id: tournamentId },
      data: { botCalls: { increment: 1 } },
    });
  }

  // ─── Intent handlers ───────────────────────────────────

  private async nextMatch(tournament: { id: string; customName: string | null }, participantId: string | null) {
    if (!participantId) {
      return { text: 'I can only look up fixtures for registered players — organizers, the Fixtures tab on the dashboard has the full picture.' };
    }
    const participant = await this.db.participant.findUnique({
      where: { id: participantId },
      select: { customName: true },
    });
    const fixture = await this.db.fixture.findFirst({
      where: {
        tournament_id: tournament.id,
        status: 'SCHEDULED',
        OR: [{ homeTeamId: participantId }, { awayTeamId: participantId }],
      },
      orderBy: [{ round: 'asc' }, { matchNumber: 'asc' }],
      include: {
        homeTeam: { select: { customName: true } },
        awayTeam: { select: { customName: true } },
      },
    });
    const name = participant?.customName ?? 'there';
    if (!fixture) {
      return { text: `@${name} no upcoming fixture on record for you right now — check the bracket for your path.` };
    }
    const slug = tournament.customName || tournament.id;
    const when = fixture.startTime
      ? `Scheduled ${new Date(fixture.startTime).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
      : 'Awaiting schedule — watch this room for the call-up';
    return {
      text: `@${name} here's your next fixture:`,
      cardType: 'FIXTURE',
      cardPayload: {
        round: fixture.roundName ?? fixture.stage ?? `Round ${fixture.round}`,
        home: fixture.homeTeam?.customName ?? 'TBD',
        away: fixture.awayTeam?.customName ?? 'TBD',
        meta: when,
        href: `/t/${slug}/fixture/${fixture.id}`,
      },
    };
  }

  private async table(tournamentId: string) {
    const standings = await this.db.standing.findMany({
      where: { tournament_id: tournamentId },
      orderBy: [{ points: 'desc' }, { goalDiff: 'desc' }, { goalsFor: 'desc' }],
      take: 5,
      include: { participant: { select: { customName: true } } },
    });
    if (standings.length === 0) {
      return { text: 'No table yet — standings appear once matches are completed.' };
    }
    return {
      text: 'Current standings — top of the table:',
      cardType: 'TABLE',
      cardPayload: {
        title: 'League table',
        rows: standings.map((s, i) => ({
          rank: i + 1,
          name: s.participant.customName ?? '—',
          value: `${s.points} pts`,
        })),
      },
    };
  }

  private async topScorer(tournamentId: string) {
    const grouped = await this.db.matchEvent.groupBy({
      by: ['participant_id'],
      where: { type: 'GOAL', fixture: { tournament_id: tournamentId } },
      _count: { participant_id: true },
      orderBy: { _count: { participant_id: 'desc' } },
      take: 3,
    });
    const withGoals = grouped.filter((g) => g.participant_id);
    if (withGoals.length === 0) {
      return { text: 'No goals recorded yet — the race for the golden boot starts soon.' };
    }
    const participants = await this.db.participant.findMany({
      where: { id: { in: withGoals.map((g) => g.participant_id!) } },
      select: { id: true, customName: true },
    });
    const nameOf = new Map(participants.map((p) => [p.id, p.customName ?? '—']));
    return {
      text: 'Top scorers so far:',
      cardType: 'STATS',
      cardPayload: {
        title: 'Top scorers',
        rows: withGoals.map((g, i) => ({
          rank: i + 1,
          name: nameOf.get(g.participant_id!) ?? '—',
          value: `${g._count.participant_id} ${g._count.participant_id === 1 ? 'goal' : 'goals'}`,
        })),
      },
    };
  }

  private rules(chatRules: string | null) {
    return {
      text: chatRules
        ? `📋 House rules:\n${chatRules}`
        : 'No house rules posted yet — the organizer can add them from the Chat tab settings.',
    };
  }

  // ─── LLM tier (free-form, grounded) ──────────────────────

  /**
   * Free-form answer grounded in a tournament-scoped context bundle.
   * Returns null when the AI call fails — caller falls back to escalation.
   */
  private async groundedAnswer(
    tournament: { id: string; customName: string | null; chatRules: string | null },
    participantId: string | null,
    question: string,
    replyContext?: { text: string; cardType: string | null } | null,
  ): Promise<string | null> {
    const context = await this.buildContext(tournament, participantId);
    const replyLine = replyContext
      ? `\nThe player is replying to your earlier message${replyContext.cardType ? ` (${replyContext.cardType} card)` : ''}: "${replyContext.text.slice(0, 200)}" — treat it as the subject of follow-ups.`
      : '';
    const text = await this.ai.complete({
      system: [
        'You are Paragee, the built-in assistant of a ParaScores tournament chat.',
        'Answer ONLY from the context below — never invent scores, rules, dates, payments or participants.',
        'If the context does not contain the answer, say so briefly and point to the organizer.',
        'Be concise (under 80 words), plain text, no markdown, no tables.',
        'Never discuss disputes, payments, walkovers or rulings — those belong to the organizer.',
      ].join('\n'),
      user: `Tournament context:\n${context}${replyLine}\n\nPlayer question: ${question.replace(/^@(paragee|arena)\s*/i, '')}`,
      maxTokens: 1400, // Gemini Flash thinking budget + the answer
    });
    if (!text) return null;
    const name = await this.askerName(participantId);
    return `@${name} ${text}`;
  }

  /** Compact tournament-scoped context bundle (token-budget conscious). */
  private async buildContext(
    tournament: { id: string; customName: string | null; chatRules: string | null },
    participantId: string | null,
  ): Promise<string> {
    const t = await this.db.tournament.findUnique({
      where: { id: tournament.id },
      select: { name: true, type: true, sport: true, start_date: true, end_date: true },
    });
    const [pinned, standings, topScorers, upcoming] = await Promise.all([
      this.db.chatMessage.findFirst({
        where: { tournamentId: tournament.id, deletedAt: null, pinnedAt: { not: null } },
        orderBy: { pinnedAt: 'desc' },
        select: { text: true },
      }),
      this.db.standing.findMany({
        where: { tournament_id: tournament.id },
        orderBy: [{ points: 'desc' }, { goalDiff: 'desc' }, { goalsFor: 'desc' }],
        take: 5,
        include: { participant: { select: { customName: true } } },
      }),
      this.db.matchEvent.groupBy({
        by: ['participant_id'],
        where: { type: 'GOAL', fixture: { tournament_id: tournament.id } },
        _count: { participant_id: true },
        orderBy: { _count: { participant_id: 'desc' } },
        take: 3,
      }),
      this.db.fixture.findMany({
        where: { tournament_id: tournament.id, status: 'SCHEDULED' },
        orderBy: [{ round: 'asc' }, { matchNumber: 'asc' }],
        take: 5,
        include: {
          homeTeam: { select: { customName: true } },
          awayTeam: { select: { customName: true } },
        },
      }),
    ]);

    const lines: string[] = [];
    if (t) {
      lines.push(`Tournament: ${t.name} (${t.sport}, ${t.type})`);
      if (t.start_date) lines.push(`Runs ${t.start_date.toISOString().slice(0, 10)} → ${t.end_date ? t.end_date.toISOString().slice(0, 10) : 'open'}`);
    }
    if (tournament.chatRules) lines.push(`House rules: ${tournament.chatRules}`);
    if (pinned) lines.push(`Pinned announcement: ${pinned.text.slice(0, 200)}`);
    if (standings.length) {
      lines.push('Table (top): ' + standings.map((s, i) => `${i + 1}. ${s.participant.customName ?? '—'} ${s.points}pts`).join(', '));
    }
    if (topScorers.length) {
      const names = await this.participantNames(topScorers.map((g) => g.participant_id!).filter(Boolean));
      lines.push('Top scorers: ' + topScorers.map((g) => `${names.get(g.participant_id!) ?? '—'} ${g._count.participant_id}`).join(', '));
    }
    if (upcoming.length) {
      lines.push('Upcoming fixtures: ' + upcoming.map((f) => `${f.roundName ?? `R${f.round}`}: ${f.homeTeam?.customName ?? 'TBD'} vs ${f.awayTeam?.customName ?? 'TBD'}${f.startTime ? ` (${f.startTime.toISOString().slice(0, 16).replace('T', ' ')})` : ''}`).join('; '));
    }

    // Asker-specific section
    if (participantId) {
      const asker = await this.db.participant.findUnique({
        where: { id: participantId },
        select: { customName: true },
      });
      const [askerStanding, askerNext, askerRecent] = await Promise.all([
        this.db.standing.findFirst({
          where: { tournament_id: tournament.id, participant_id: participantId },
        }),
        this.db.fixture.findFirst({
          where: { tournament_id: tournament.id, status: 'SCHEDULED', OR: [{ homeTeamId: participantId }, { awayTeamId: participantId }] },
          orderBy: [{ round: 'asc' }, { matchNumber: 'asc' }],
          include: { homeTeam: { select: { customName: true } }, awayTeam: { select: { customName: true } } },
        }),
        this.db.fixture.findMany({
          where: { tournament_id: tournament.id, status: 'COMPLETED', OR: [{ homeTeamId: participantId }, { awayTeamId: participantId }] },
          orderBy: { updated_at: 'desc' },
          take: 3,
          include: { homeTeam: { select: { customName: true } }, awayTeam: { select: { customName: true } } },
        }),
      ]);
      lines.push(`Asker: ${asker?.customName ?? 'a participant'}`);
      if (askerStanding) lines.push(`Asker standing: ${askerStanding.points}pts, GD ${askerStanding.goalDiff}, played ${askerStanding.played}`);
      if (askerNext) lines.push(`Asker next fixture: ${askerNext.homeTeam?.customName ?? 'TBD'} vs ${askerNext.awayTeam?.customName ?? 'TBD'} (${askerNext.roundName ?? `R${askerNext.round}`}${askerNext.startTime ? `, ${askerNext.startTime.toISOString().slice(0, 16).replace('T', ' ')}` : ', unscheduled'})`);
      if (askerRecent.length) {
        lines.push('Asker recent results: ' + askerRecent.map((f) => `${f.homeTeam?.customName ?? '?'} ${f.homeScore ?? '?'}-${f.awayScore ?? '?'} ${f.awayTeam?.customName ?? '?'}`).join('; '));
      }
    }
    return lines.join('\n');
  }

  private async askerName(participantId: string | null): Promise<string> {
    if (!participantId) return 'there';
    const p = await this.db.participant.findUnique({ where: { id: participantId }, select: { customName: true } });
    return p?.customName ?? 'there';
  }

  private async participantNames(ids: string[]): Promise<Map<string, string>> {
    const rows = await this.db.participant.findMany({ where: { id: { in: ids } }, select: { id: true, customName: true } });
    return new Map(rows.map((r) => [r.id, r.customName ?? '—']));
  }
}

/** Sensitive topics always escalate to a human — never answered by the bot. */
function isSensitive(text: string): boolean {
  return /(dispute|protest|appeal|payment|refund|prize|money|fee|walkover|ban(?:ish)?|kick(?:ed)?\s+(?:me|him|her|them|us)|cheat|hack|ddos|suspend|rule\s*change)/i.test(text);
}

function classify(text: string): ParageeIntent {
  const q = text.toLowerCase();
  if (/(next match|next fixture|when.*(do|to).*(play|match)|upcoming|my match|who.*(i|we).*play)/.test(q)) return 'nextMatch';
  if (/(top ?scorer|most goals|golden boot|leading scorer|top scorer)/.test(q)) return 'topScorer';
  if (/(table|standing|league position|points)/.test(q)) return 'table';
  if (/(rule|allowed|format|walkover|best of|legs?|aggregate|screenshot)/.test(q)) return 'rules';
  return null;
}
