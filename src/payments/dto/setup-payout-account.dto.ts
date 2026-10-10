import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';

export class SetupPayoutAccountDto {
  @ApiProperty({
    description: 'Paystack bank code of the settlement bank',
    example: '058',
  })
  @IsNotEmpty()
  @IsString()
  bankCode: string;

  @ApiProperty({
    description: 'NUBAN account number (10 digits)',
    example: '0123456789',
  })
  @IsNotEmpty()
  @IsString()
  @Matches(/^\d{10}$/, {
    message: 'Account number must be exactly 10 digits',
  })
  accountNumber: string;

  @ApiPropertyOptional({
    description:
      'Business name for the subaccount (defaults to organization name)',
  })
  @IsOptional()
  @IsString()
  businessName?: string;
}
