import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class RecordOfflinePaymentDto {
  @ApiProperty({ description: 'Tournament ID or custom name' })
  @IsNotEmpty()
  @IsString()
  tournamentId: string;

  @ApiPropertyOptional({
    description: 'Existing participant this payment belongs to (optional)',
  })
  @IsOptional()
  @IsString()
  participantId?: string;

  @ApiPropertyOptional({
    description:
      'Name of the paying team/person (used when no participant is linked)',
  })
  @IsOptional()
  @IsString()
  payerName?: string;

  @ApiPropertyOptional({
    description:
      'Amount in kobo. Defaults to the tournament registration fee.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  amount?: number;

  @ApiProperty({
    description: 'How the money was received',
    enum: ['CASH', 'BANK_TRANSFER', 'OTHER'],
  })
  @IsIn(['CASH', 'BANK_TRANSFER', 'OTHER'])
  method: 'CASH' | 'BANK_TRANSFER' | 'OTHER';

  @ApiPropertyOptional({ description: 'Free-text note (e.g. receipt number)' })
  @IsOptional()
  @IsString()
  note?: string;
}
