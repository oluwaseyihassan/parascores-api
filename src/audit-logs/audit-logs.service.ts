import { Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import { ResponseUtil } from 'src/utils/api-response';
import { Prisma } from 'prisma/generated/client';

export enum AuditAction {
  USER_DELETE = 'USER_DELETE',
  USER_ROLE_UPDATE = 'USER_ROLE_UPDATE',
  TOURNAMENT_DELETE = 'TOURNAMENT_DELETE',
  TOURNAMENT_UPDATE = 'TOURNAMENT_UPDATE',
  TOURNAMENT_PRICING_UPDATE = 'TOURNAMENT_PRICING_UPDATE',
  ORGANIZATION_VERIFY = 'ORGANIZATION_VERIFY',
  ORGANIZATION_SUBSCRIPTION_UPDATE = 'ORGANIZATION_SUBSCRIPTION_UPDATE',
  ORGANIZATION_EVENT_HUB_UPDATE = 'ORGANIZATION_EVENT_HUB_UPDATE',
  PLAYER_STATUS_UPDATE = 'PLAYER_STATUS_UPDATE',
}

export enum AuditEntityType {
  USER = 'USER',
  TOURNAMENT = 'TOURNAMENT',
  ORGANIZATION = 'ORGANIZATION',
  PLAYER = 'PLAYER',
}

export interface CreateAuditLogInput {
  actorId: string;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId: string;
  metadata?: Record<string, any>;
  ipAddress?: string;
}

@Injectable()
export class AuditLogsService {
  constructor(private readonly db: DatabaseService) {}

  async create(input: CreateAuditLogInput) {
    const log = await this.db.auditLog.create({
      data: {
        actor: { connect: { id: input.actorId } },
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        metadata: input.metadata ?? {},
        ipAddress: input.ipAddress,
      },
      include: {
        actor: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    return log;
  }

  async findAll(params: {
    page?: number;
    limit?: number;
    action?: string;
    entityType?: string;
    entityId?: string;
    actorId?: string;
  }) {
    const page = Number(params.page) || 1;
    const limit = Number(params.limit) || 20;
    const skip = (page - 1) * limit;

    const where: Prisma.AuditLogWhereInput = {};
    if (params.action) where.action = { equals: params.action };
    if (params.entityType) where.entityType = { equals: params.entityType };
    if (params.entityId) where.entityId = { equals: params.entityId };
    if (params.actorId) where.actorId = { equals: params.actorId };

    const [logs, total] = await Promise.all([
      this.db.auditLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          actor: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      }),
      this.db.auditLog.count({ where }),
    ]);

    return ResponseUtil.paginated(logs, page, limit, total);
  }

  async findRecent(limit: number = 10) {
    const logs = await this.db.auditLog.findMany({
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        actor: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    return logs;
  }
}
