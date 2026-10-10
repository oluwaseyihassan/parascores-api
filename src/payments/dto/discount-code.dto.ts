import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { DiscountType } from 'prisma/generated/client';

export class CreateDiscountCodeDto {
  @ApiProperty({ description: 'The code teams will enter', example: 'HOST26' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(32)
  code: string;

  @ApiProperty({
    description:
      'PERCENT: 1-100 off; FIXED: amount off in kobo; WAIVER: free registration',
    enum: DiscountType,
  })
  @IsEnum(DiscountType)
  type: DiscountType;

  @ApiPropertyOptional({
    description: 'Percent (1-100) or fixed amount in kobo. Ignored for WAIVER.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  value?: number;

  @ApiPropertyOptional({ description: 'Maximum number of redemptions' })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxUses?: number;

  @ApiPropertyOptional({ description: 'Expiry date (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

export class UpdateDiscountCodeDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Set to null to remove the limit' })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxUses?: number | null;

  @ApiPropertyOptional({ description: 'Set to null to remove the expiry' })
  @IsOptional()
  @IsDateString()
  expiresAt?: string | null;
}

export class ValidateDiscountCodeDto {
  @ApiProperty({ description: 'Tournament ID or custom name' })
  @IsNotEmpty()
  @IsString()
  tournamentId: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  code: string;
}
