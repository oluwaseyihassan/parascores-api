import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import Redis from 'ioredis';
import { createAdapter } from '@socket.io/redis-adapter';
import { jwtConstants } from 'src/auth/constants';
import { DatabaseService } from 'src/database/database.service';

// Mirrors the HTTP CORS rules in main.ts
const CORS_ORIGINS: (string | RegExp)[] = [
  'http://localhost:3001',
  'https://parascores-web.vercel.app',
  /^http:\/\/([a-z0-9-]+\.)*lvh\.me:3001$/,
  /^https:\/\/([a-z0-9-]+\.)*parascores\.com(:\d+)?$/,
];

@WebSocketGateway({
  namespace: '/chat',
  cors: { origin: CORS_ORIGINS, credentials: true },
})
export class ChatGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;

  private readonly logger = new Logger(ChatGateway.name);
  // Presence is tracked per instance — fine for dev/single-instance deploys;
  // multi-instance presence would need Redis keys instead of these maps.
  private roomSockets = new Map<string, Set<string>>();
  private socketRooms = new Map<string, Set<string>>();
  // Typing-indicator throttle: last relay per socket
  private typingAt = new Map<string, number>();

  constructor(
    private readonly jwt: JwtService,
    private readonly db: DatabaseService,
  ) {}

  async afterInit() {
    // Attach the Redis adapter when available so rooms fan out across
    // instances; otherwise stay on the default in-memory adapter.
    const url = process.env.REDIS_URL || 'redis://localhost:6379';
    let pub: Redis | null = null;
    try {
      pub = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1 });
      const sub = pub.duplicate();
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Redis connect timeout')), 1500),
      );
      await Promise.race([
        Promise.all([pub.connect(), sub.connect()]).then(() => pub!.ping()),
        timeout,
      ]);
      this.server.adapter(createAdapter(pub, sub));
      this.logger.log('Socket.IO Redis adapter attached (chat)');
    } catch {
      this.logger.warn('Redis unavailable — chat gateway on in-memory adapter');
      try { pub?.disconnect(); } catch { /* noop */ }
    }
  }

  async handleConnection(socket: Socket) {
    // Token sources: handshake auth.token, Authorization header, or the
    // httpOnly access_token cookie (the web app's auth is cookie-based)
    const cookieHeader = socket.handshake.headers.cookie;
    const cookieToken = cookieHeader
      ?.split(';')
      .map((c) => c.trim())
      .find((c) => c.startsWith('access_token='))
      ?.split('=')[1];
    const token =
      (socket.handshake.auth as any)?.token ||
      socket.handshake.headers.authorization?.replace(/^Bearer /, '') ||
      (cookieToken ? decodeURIComponent(cookieToken) : undefined);
    if (!token) return; // anonymous = read-only on public rooms
    try {
      const payload = await this.jwt.verifyAsync(token, { secret: jwtConstants.secret });
      socket.data.userId = payload.sub;
    } catch {
      // invalid token → stay anonymous
    }
  }

  roomName(tournamentId: string) {
    return `tournament:${tournamentId}:chat`;
  }

  emitToRoom(room: string, event: string, payload: unknown) {
    this.server?.to(room).emit(event, payload);
  }

  @SubscribeMessage('join')
  async join(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { tournamentId?: string },
  ) {
    const tournamentId = body?.tournamentId;
    if (!tournamentId) return { ok: false };

    const tournament = await this.db.tournament.findUnique({
      where: { id: tournamentId },
      select: { visibility: true, organization_id: true, chatEnabled: true },
    });
    if (!tournament || !tournament.chatEnabled) return { ok: false };

    if (tournament.visibility === 'PRIVATE') {
      const userId = socket.data.userId as string | undefined;
      if (!userId) return { ok: false };
      const [participant, membership] = await Promise.all([
        this.db.participant.findFirst({
          where: { tournament_id: tournamentId, user_id: userId, status: 'CONFIRMED' },
          select: { id: true },
        }),
        tournament.organization_id
          ? this.db.organizationMember.findUnique({
              where: {
                organizationId_userId: { organizationId: tournament.organization_id, userId },
              },
              select: { role: true },
            })
          : null,
      ]);
      if (!participant && !membership) return { ok: false };
    }

    const room = this.roomName(tournamentId);
    await socket.join(room);

    if (!this.socketRooms.has(socket.id)) this.socketRooms.set(socket.id, new Set());
    this.socketRooms.get(socket.id)!.add(room);
    const sockets = this.roomSockets.get(room) ?? new Set<string>();
    sockets.add(socket.id);
    this.roomSockets.set(room, sockets);
    this.emitToRoom(room, 'chat:presence', { online: sockets.size });

    return { ok: true };
  }

  /**
   * Typing indicator relay — ephemeral, broadcast to the room minus sender.
   * Joined + named posters only; throttled to one relay per 1.5s per socket.
   * The display name is resolved fresh per relay (the throttle keeps this to
   * ~1 indexed query/1.5s per active typer) so renames show immediately.
   */
  @SubscribeMessage('typing')
  async typing(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { tournamentId?: string },
  ) {
    const tournamentId = body?.tournamentId;
    if (!tournamentId) return;
    const room = this.roomName(tournamentId);
    if (!this.roomSockets.get(room)?.has(socket.id)) return;
    const userId = socket.data.userId as string | undefined;
    if (!userId) return;
    const now = Date.now();
    if (now - (this.typingAt.get(socket.id) ?? 0) < 1500) return;
    this.typingAt.set(socket.id, now); // stamp before the async lookup — closes the double-emit race

    const identity = await this.resolveIdentity(tournamentId, userId);
    if (!identity) return;
    socket.to(room).emit('chat:typing', { userId, name: identity.name, avatarUrl: identity.avatarUrl });
  }

  /** Participant identity first (name + avatar), then the organization for staff. */
  private async resolveIdentity(
    tournamentId: string,
    userId: string,
  ): Promise<{ name: string; avatarUrl: string | null } | null> {
    const participant = await this.db.participant.findFirst({
      where: { tournament_id: tournamentId, user_id: userId, status: 'CONFIRMED' },
      select: { customName: true, logoUrl: true },
    });
    if (participant) {
      return { name: participant.customName ?? 'Player', avatarUrl: participant.logoUrl ?? null };
    }
    const tournament = await this.db.tournament.findUnique({
      where: { id: tournamentId },
      select: { organization_id: true, organization: { select: { name: true, logoUrl: true } } },
    });
    if (!tournament?.organization_id) return null;
    const membership = await this.db.organizationMember.findUnique({
      where: {
        organizationId_userId: { organizationId: tournament.organization_id, userId },
      },
      select: { role: true },
    });
    return membership
      ? { name: tournament.organization?.name ?? 'Organizer', avatarUrl: tournament.organization?.logoUrl ?? null }
      : null;
  }

  @SubscribeMessage('leave')
  async leave(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { tournamentId?: string },
  ) {
    if (!body?.tournamentId) return { ok: false };
    await this.leaveRoom(socket, this.roomName(body.tournamentId));
    return { ok: true };
  }

  async handleDisconnect(socket: Socket) {
    const rooms = this.socketRooms.get(socket.id);
    if (rooms) {
      for (const room of rooms) await this.leaveRoom(socket, room);
    }
    this.socketRooms.delete(socket.id);
    this.typingAt.delete(socket.id);
  }

  private async leaveRoom(socket: Socket, room: string) {
    await socket.leave(room);
    this.socketRooms.get(socket.id)?.delete(room);
    const sockets = this.roomSockets.get(room);
    if (sockets) {
      sockets.delete(socket.id);
      if (sockets.size === 0) this.roomSockets.delete(room);
      this.emitToRoom(room, 'chat:presence', { online: sockets.size });
    }
  }
}
