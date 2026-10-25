import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import { OrganizationsService } from 'src/organizations/organizations.service';
import {
  CreateDiscountCodeDto,
  UpdateDiscountCodeDto,
  ValidateDiscountCodeDto,
} from '../dto/discount-code.dto';
import { ResponseUtil } from 'src/utils/api-response';
import { DiscountCode } from 'prisma/generated/client';

@Injectable()
export class DiscountCodesService {
  private readonly logger = new Logger(DiscountCodesService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly organizationsService: OrganizationsService,
  ) {}

  async createDiscountCode(
    userId: string,
    tournamentId: string,
    dto: CreateDiscountCodeDto,
  ) {
    const tournament = await this.db.tournament.findFirst({
      where: { OR: [{ id: tournamentId }, { customName: tournamentId }] },
    });
    if (!tournament) throw new NotFoundException('Tournament not found');
    if (!tournament.organization_id) {
      throw new BadRequestException('Tournament has no organization');
    }
    await this.organizationsService.validateMemberRole(
      tournament.organization_id,
      userId,
      ['OWNER', 'ADMIN'],
    );

    if (
      dto.type === 'PERCENT' &&
      (dto.value == null || dto.value < 1 || dto.value > 100)
    ) {
      throw new BadRequestException(
        'Percent discount must be between 1 and 100',
      );
    }
    if (dto.type === 'FIXED' && (dto.value == null || dto.value <= 0)) {
      throw new BadRequestException('Fixed discount must be greater than zero');
    }

    const code = dto.code.trim().toUpperCase();
    const existing = await this.db.discountCode.findUnique({
      where: {
        tournament_id_code: { tournament_id: tournament.id, code },
      },
    });
    if (existing) {
      throw new ConflictException(
        `Code "${code}" already exists for this tournament`,
      );
    }

    const discountCode = await this.db.discountCode.create({
      data: {
        code,
        tournament_id: tournament.id,
        type: dto.type,
        value: dto.type === 'WAIVER' ? 0 : dto.value!,
        maxUses: dto.maxUses,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
        createdById: userId,
      },
    });

    return ResponseUtil.success(discountCode, 'Discount code created');
  }

  async listDiscountCodes(userId: string, tournamentId: string) {
    const tournament = await this.db.tournament.findFirst({
      where: { OR: [{ id: tournamentId }, { customName: tournamentId }] },
    });
    if (!tournament) throw new NotFoundException('Tournament not found');
    if (!tournament.organization_id) {
      throw new BadRequestException('Tournament has no organization');
    }
    await this.organizationsService.validateMemberRole(
      tournament.organization_id,
      userId,
      ['OWNER', 'ADMIN'],
    );

    const codes = await this.db.discountCode.findMany({
      where: { tournament_id: tournament.id },
      orderBy: { created_at: 'desc' },
    });

    return ResponseUtil.success(codes, 'Discount codes retrieved');
  }

  async updateDiscountCode(
    userId: string,
    id: string,
    dto: UpdateDiscountCodeDto,
  ) {
    const discountCode = await this.db.discountCode.findUnique({
      where: { id },
      include: { tournament: true },
    });
    if (!discountCode) throw new NotFoundException('Discount code not found');
    if (!discountCode.tournament.organization_id) {
      throw new BadRequestException('Tournament has no organization');
    }
    await this.organizationsService.validateMemberRole(
      discountCode.tournament.organization_id,
      userId,
      ['OWNER', 'ADMIN'],
    );

    const updated = await this.db.discountCode.update({
      where: { id },
      data: {
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        ...(dto.maxUses !== undefined && { maxUses: dto.maxUses }),
        ...(dto.expiresAt !== undefined && {
          expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        }),
      },
    });

    return ResponseUtil.success(updated, 'Discount code updated');
  }

  async deleteDiscountCode(userId: string, id: string) {
    const discountCode = await this.db.discountCode.findUnique({
      where: { id },
      include: { tournament: true },
    });
    if (!discountCode) throw new NotFoundException('Discount code not found');
    if (!discountCode.tournament.organization_id) {
      throw new BadRequestException('Tournament has no organization');
    }
    await this.organizationsService.validateMemberRole(
      discountCode.tournament.organization_id,
      userId,
      ['OWNER', 'ADMIN'],
    );

    await this.db.discountCode.delete({ where: { id } });

    return ResponseUtil.success(null, 'Discount code deleted');
  }

  /**
   * Preview a discount code for the join page. Any authenticated user may
   * validate — redemption limits are enforced again at registration time.
   */
  async validateDiscountCode(userId: string, dto: ValidateDiscountCodeDto) {
    void userId; // Authentication is enforced by the global AuthGuard
    const tournament = await this.db.tournament.findFirst({
      where: {
        OR: [{ id: dto.tournamentId }, { customName: dto.tournamentId }],
      },
    });
    if (!tournament) throw new NotFoundException('Tournament not found');

    const resolved = await this.resolveDiscountCode(tournament.id, dto.code);
    if (!resolved.valid) {
      return ResponseUtil.success({ valid: false, reason: resolved.reason });
    }

    const fee = tournament.registrationFee ?? 0;
    const finalAmount = this.applyDiscount(fee, resolved.code);

    return ResponseUtil.success({
      valid: true,
      type: resolved.code.type,
      value: resolved.code.value,
      originalAmount: fee,
      finalAmount,
    });
  }

  async resolveDiscountCode(
    tournamentId: string,
    rawCode: string,
  ): Promise<
    | { valid: true; code: DiscountCode }
    | { valid: false; reason: string }
  > {
    const code = rawCode?.trim().toUpperCase();
    if (!code) return { valid: false, reason: 'No discount code provided' };

    const discountCode = await this.db.discountCode.findUnique({
      where: { tournament_id_code: { tournament_id: tournamentId, code } },
    });

    if (!discountCode || !discountCode.isActive) {
      return { valid: false, reason: 'Invalid discount code' };
    }
    if (discountCode.expiresAt && discountCode.expiresAt < new Date()) {
      return { valid: false, reason: 'Discount code has expired' };
    }
    if (discountCode.maxUses && discountCode.usedCount >= discountCode.maxUses) {
      return {
        valid: false,
        reason: 'Discount code has reached its maximum uses',
      };
    }

    return { valid: true, code: discountCode };
  }

  applyDiscount(
    fee: number,
    code: Pick<DiscountCode, 'type' | 'value'>,
  ): number {
    switch (code.type) {
      case 'WAIVER':
        return 0;
      case 'PERCENT':
        return Math.round((fee * (100 - code.value)) / 100);
      case 'FIXED':
        return Math.max(0, fee - code.value);
      default:
        return fee;
    }
  }
}
