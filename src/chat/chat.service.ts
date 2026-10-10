import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DatabaseService } from 'src/database/database.service';
import { OrganizationsService } from 'src/organizations/organizations.service';
import { ChatGateway } from './chat.gateway';
import { CreateChatMessageDto, UpdateChatSettingsDto } from './dto/chat.dto';

const AUTHOR_INCLUDE = {
  participant: {
    select: {
      id: true,
      customName: true,
      logoUrl: true,
      team: { select: { name: true } },
    },
  },
  // Quoted reply target (snippet rendered above the message)
  replyTo: {
    select: {
      id: true,
      text: true,
      authorType: true,
      deletedAt: true,
      participant: { select: { customName: true } },
    },
  },
  // Reaction rows aggregated in serialize() into { emoji, count, mine }
  reactions: {
    select: { emoji: true, userId: true },
  },
} as const;

/** Fixed quick-reaction set — validated server-side. */
export const REACTION_EMOJIS = ['👍', '⚽', '🔥', '❤️', '😂', '🎉'] as const;

@Injectable()
export class ChatService {
  constructor(
    private readonly db: DatabaseService,
    private readonly orgs: OrganizationsService,
    private readonly gateway: ChatGateway,
    private readonly events: EventEmitter2,
  ) {}

  private room(tournamentId: string) {
    return this.gateway.roomName(tournamentId);
  }

  private async loadTournament(tournamentId: string) {
    const tournament = await this.db.tournament.findUnique({
      where: { id: tournamentId },
      select: {
        id: true,
        visibility: true,
        organization_id: true,
        chatEnabled: true,
        parageeBot: true,
        organization: { select: { name: true } },
      },
    });
    if (!tournament) throw new NotFoundException('Tournament not found');
    return tournament;
  }

  // Non-throwing viewer resolution: confirmed participant and/or org member
  private async resolveViewer(tournamentId: string, organizationId: string | null, userId?: string | null) {
    if (!userId) return { participant: null, membership: null };
    const [participant, membership] = await Promise.all([
      this.db.participant.findFirst({
        where: { tournament_id: tournamentId, user_id: userId, status: 'CONFIRMED' },
        select: { id: true },
      }),
      organizationId
        ? this.db.organizationMember.findUnique({
            where: { organizationId_userId: { organizationId, userId } },
            select: { role: true },
          })
        : null,
    ]);
    return { participant, membership };
  }

  private serialize(message: any, orgName?: string | null, viewerId?: string | null) {
    const authorName = (m: any) =>
      m.authorType === 'BOT' || m.authorType === 'SYSTEM'
        ? 'Paragee'
        : m.authorType === 'ORGANIZER'
          ? (orgName ?? 'Organizer')
          : (m.participant?.customName ?? 'Player');
    // aggregate reaction rows → ordered summaries with the viewer's own state
    const byEmoji = new Map<string, { emoji: string; count: number; mine: boolean }>();
    for (const r of message.reactions ?? []) {
      const e = byEmoji.get(r.emoji) ?? { emoji: r.emoji, count: 0, mine: false };
      e.count++;
      if (viewerId && r.userId === viewerId) e.mine = true;
      byEmoji.set(r.emoji, e);
    }
    const reactions = REACTION_EMOJIS.map((e) => byEmoji.get(e)).filter(Boolean).concat(
      [...byEmoji.values()].filter((r) => !REACTION_EMOJIS.includes(r.emoji as any)),
    );
    return {
      id: message.id,
      authorType: message.authorType,
      text: message.text,
      cardType: message.cardType,
      cardPayload: message.cardPayload,
      pinnedAt: message.pinnedAt,
      createdAt: message.createdAt,
      reactions,
      replyTo: message.replyTo
        ? {
            id: message.replyTo.id,
            authorName: authorName(message.replyTo),
            deleted: !!message.replyTo.deletedAt,
            text: message.replyTo.deletedAt ? null : message.replyTo.text.slice(0, 140),
          }
        : null,
      author: {
        name: authorName(message),
        avatarUrl: message.participant?.logoUrl ?? null,
        teamName: message.participant?.team?.name ?? null,
        participantId: message.participantId ?? null,
      },
    };
  }

  async list(tournamentId: string, userId: string | null, opts: { cursor?: string; limit: number }) {
    const tournament = await this.loadTournament(tournamentId);
    if (!tournament.chatEnabled) throw new NotFoundException('Chat is not enabled for this tournament');

    if (tournament.visibility === 'PRIVATE') {
      const { participant, membership } = await this.resolveViewer(tournamentId, tournament.organization_id, userId);
      if (!participant && !membership) {
        throw new ForbiddenException('This chat is only visible to participants and organizers');
      }
    }

    const limit = Math.min(Math.max(opts.limit || 50, 1), 100);
    const messages = await this.db.chatMessage.findMany({
      where: { tournamentId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
      include: AUTHOR_INCLUDE,
    });
    const hasMore = messages.length > limit;
    if (hasMore) messages.pop();

    const pinned = await this.db.chatMessage.findFirst({
      where: { tournamentId, deletedAt: null, pinnedAt: { not: null } },
      orderBy: { pinnedAt: 'desc' },
      include: AUTHOR_INCLUDE,
    });

    const orgName = tournament.organization?.name;
    return {
      messages: messages.reverse().map((m) => this.serialize(m, orgName, userId)),
      pinned: pinned ? this.serialize(pinned, orgName, userId) : null,
      nextCursor: hasMore ? messages[0]?.id : null,
    };
  }

  async post(tournamentId: string, userId: string, dto: CreateChatMessageDto) {
    const tournament = await this.loadTournament(tournamentId);
    if (!tournament.chatEnabled) throw new ForbiddenException('Chat is not enabled for this tournament');

    const { participant, membership } = await this.resolveViewer(tournamentId, tournament.organization_id, userId);
    const isOrganizer = !!membership && ['OWNER', 'ADMIN', 'MEMBER'].includes(membership.role);
    if (!participant && !isOrganizer) {
      throw new ForbiddenException('Only approved participants and organizers can post');
    }

    const text = dto.text.trim();
    if (!text) throw new BadRequestException('Message cannot be empty');

    // Quoted reply: target must be a live message in this room
    let replyToId: string | null = null;
    let replyToBot: { text: string; cardType: string | null } | null = null;
    if (dto.replyToId) {
      const target = await this.db.chatMessage.findFirst({
        where: { id: dto.replyToId, tournamentId, deletedAt: null },
        select: { id: true, authorType: true, text: true, cardType: true },
      });
      if (!target) throw new BadRequestException('Cannot reply to that message');
      replyToId = target.id;
      if (target.authorType === 'BOT') replyToBot = { text: target.text, cardType: target.cardType };
    }

    const message = await this.db.chatMessage.create({
      data: {
        tournamentId,
        // Org members post with the organizer identity (gold rail)
        authorType: isOrganizer ? 'ORGANIZER' : 'USER',
        authorUserId: userId,
        participantId: participant?.id ?? null,
        text,
        replyToId,
      },
      include: AUTHOR_INCLUDE,
    });

    const serialized = this.serialize(message, tournament.organization?.name);
    this.gateway.emitToRoom(this.room(tournamentId), 'chat:new', serialized);

    // Paragee hook — decoupled via event bus; paragee module listens.
    // Triggers on an explicit mention OR a reply to a bot message (follow-up).
    const botFlags = (tournament.parageeBot as any) ?? {};
    if (botFlags.enabled && (/@(paragee|arena)\b/i.test(text) || replyToBot)) {
      this.events.emitAsync('chat.parageeMention', {
        tournamentId,
        messageId: message.id,
        authorParticipantId: participant?.id ?? null,
        authorUserId: userId,
        text,
        replyContext: replyToBot,
      });
    }

    return serialized;
  }

  async remove(messageId: string, userId: string) {
    const message = await this.db.chatMessage.findUnique({
      where: { id: messageId },
      include: { tournament: { select: { organization_id: true } } },
    });
    if (!message || message.deletedAt) throw new NotFoundException('Message not found');
    if (!message.tournament.organization_id) throw new ForbiddenException('Tournament has no organization');

    await this.orgs.validateMemberRole(message.tournament.organization_id, userId, ['OWNER', 'ADMIN', 'MEMBER']);

    await this.db.chatMessage.update({ where: { id: messageId }, data: { deletedAt: new Date() } });
    this.gateway.emitToRoom(this.room(message.tournamentId), 'chat:deleted', { id: messageId });
  }

  async setPin(messageId: string, userId: string, pin: boolean) {
    const message = await this.db.chatMessage.findUnique({
      where: { id: messageId },
      include: { tournament: { select: { organization_id: true, organization: { select: { name: true } } } } },
    });
    if (!message || message.deletedAt) throw new NotFoundException('Message not found');
    if (!message.tournament.organization_id) throw new ForbiddenException('Tournament has no organization');

    await this.orgs.validateMemberRole(message.tournament.organization_id, userId, ['OWNER', 'ADMIN', 'MEMBER']);

    // index 0 is the unpin sweep (updateMany → { count }), index 1 is the message
    const [, updated] = await this.db.$transaction([
      this.db.chatMessage.updateMany({
        where: { tournamentId: message.tournamentId, pinnedAt: { not: null } },
        data: { pinnedAt: null },
      }),
      this.db.chatMessage.update({
        where: { id: messageId },
        data: { pinnedAt: pin ? new Date() : null },
        include: AUTHOR_INCLUDE,
      }),
    ]);

    const serialized = pin ? this.serialize(updated, message.tournament.organization?.name) : null;
    this.gateway.emitToRoom(this.room(message.tournamentId), 'chat:pinned', { message: serialized });
    return serialized;
  }

  // ─── Reactions (emoji toggles) ─────────────────────────────

  /** Toggle an emoji reaction on a message. Returns the updated summary for the caller. */
  async react(messageId: string, userId: string, emoji: string) {
    if (!REACTION_EMOJIS.includes(emoji as any)) {
      throw new BadRequestException(`Unsupported reaction — pick one of ${REACTION_EMOJIS.join(' ')}`);
    }
    const message = await this.db.chatMessage.findUnique({
      where: { id: messageId },
      include: { tournament: { select: { organization_id: true, chatEnabled: true } } },
    });
    if (!message || message.deletedAt) throw new NotFoundException('Message not found');
    if (!message.tournament.chatEnabled) throw new ForbiddenException('Chat is not enabled for this tournament');

    // Same rule as posting: confirmed participants + org members
    const { participant, membership } = await this.resolveViewer(
      message.tournamentId,
      message.tournament.organization_id,
      userId,
    );
    const isOrganizer = !!membership && ['OWNER', 'ADMIN', 'MEMBER'].includes(membership.role);
    if (!participant && !isOrganizer) {
      throw new ForbiddenException('Only approved participants and organizers can react');
    }

    const key = { messageId, userId, emoji };
    const existing = await this.db.chatReaction.findUnique({
      where: { messageId_userId_emoji: key },
    });
    if (existing) {
      await this.db.chatReaction.delete({ where: { id: existing.id } });
    } else {
      await this.db.chatReaction.create({ data: key });
    }

    const fresh = await this.db.chatMessage.findUnique({
      where: { id: messageId },
      include: AUTHOR_INCLUDE,
    });
    const forCaller = this.serialize(fresh, null, userId).reactions;
    // room broadcast carries counts only — each client keeps its own "mine" flags
    const forRoom = forCaller.map(({ emoji: e, count }: any) => ({ emoji: e, count }));
    this.gateway.emitToRoom(this.room(message.tournamentId), 'chat:reaction', { messageId, reactions: forRoom });
    return forCaller;
  }

  async updateSettings(tournamentId: string, userId: string, dto: UpdateChatSettingsDto) {
    const tournament = await this.db.tournament.findUnique({
      where: { id: tournamentId },
      select: { organization_id: true },
    });
    if (!tournament) throw new NotFoundException('Tournament not found');
    if (!tournament.organization_id) throw new ForbiddenException('Tournament has no organization');

    await this.orgs.validateMemberRole(tournament.organization_id, userId, ['OWNER', 'ADMIN']);

    const data: Record<string, any> = {};
    if (dto.chatEnabled !== undefined) data.chatEnabled = dto.chatEnabled;
    if (dto.chatRules !== undefined) data.chatRules = dto.chatRules.trim() || null;
    if (dto.parageeBot !== undefined) data.parageeBot = dto.parageeBot;

    const updated = await this.db.tournament.update({
      where: { id: tournamentId },
      data,
      select: { chatEnabled: true, chatRules: true, parageeBot: true },
    });

    this.gateway.emitToRoom(this.room(tournamentId), 'chat:settings', { chatEnabled: updated.chatEnabled });
    return updated;
  }

  // ─── Used by Paragee + score submissions (BOT-authored cards) ───
  /** Ephemeral "Paragee is thinking…" state for the LLM path (template answers are instant). */
  emitBotThinking(tournamentId: string, state: boolean) {
    this.gateway.emitToRoom(this.room(tournamentId), 'chat:botThinking', { state });
  }

  async postBotCard(
    tournamentId: string,
    opts: { text: string; cardType?: 'FIXTURE' | 'TABLE' | 'STATS' | 'LINK' | 'SCORE_SUBMITTED' | 'SCORE_CONFIRMED' | 'SCORE_CONFLICT'; cardPayload?: any; replyToId?: string | null },
  ) {
    const message = await this.db.chatMessage.create({
      data: {
        tournamentId,
        authorType: 'BOT',
        text: opts.text,
        cardType: opts.cardType ?? null,
        cardPayload: opts.cardPayload ?? null,
        replyToId: opts.replyToId ?? null,
      },
      include: AUTHOR_INCLUDE,
    });
    const serialized = this.serialize(message);
    this.gateway.emitToRoom(this.room(tournamentId), 'chat:new', serialized);
    return serialized;
  }
}
