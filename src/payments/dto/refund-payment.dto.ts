import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class RefundPaymentDto {
  @ApiPropertyOptional({
    description: 'Reason shown in internal records and the customer note',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;

  @ApiPropertyOptional({
    description:
      'Record the refund without calling Paystack — the organizer returns the money themselves. Used when the subaccount pending payout cannot cover an automatic refund.',
  })
  @IsOptional()
  @IsBoolean()
  manual?: boolean;
}
