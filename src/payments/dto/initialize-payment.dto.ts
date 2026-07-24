import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum PlanType {
  PRO_MONTHLY = 'PRO_MONTHLY',
  PRO_YEARLY = 'PRO_YEARLY',
  PER_TOURNAMENT = 'PER_TOURNAMENT',
}

export class InitializePaymentDto {
  @ApiProperty({ description: 'Organization ID to subscribe' })
  @IsNotEmpty()
  @IsString()
  organizationId: string;

  @ApiProperty({
    description: 'The plan type to subscribe to.',
    enum: PlanType,
    example: PlanType.PRO_MONTHLY,
  })
  @IsNotEmpty()
  @IsEnum(PlanType)
  planType: PlanType;

  @ApiPropertyOptional({
    description: 'Tournament ID for per-tournament upgrades.',
  })
  @IsOptional()
  @IsString()
  tournamentId?: string;

  @ApiProperty({
    description: 'Amount in smallest currency unit (kobo/cents).',
    example: 500000,
  })
  @IsNotEmpty()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  amount: number;

  @ApiPropertyOptional({
    description: 'URL to redirect after payment',
    example: 'https://parascores.com/manage/billing',
  })
  @IsOptional()
  @IsString()
  callbackUrl?: string;
}
