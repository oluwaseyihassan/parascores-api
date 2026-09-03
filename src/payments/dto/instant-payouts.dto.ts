import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class InstantPayoutsDto {
  @ApiProperty({
    description:
      'When enabled, registration fees are transferred to the organization bank account within minutes of payment (via Paystack Transfers) instead of settling through the subaccount the next business day.',
  })
  @IsBoolean()
  enabled: boolean;
}
