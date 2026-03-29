import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class UpgradeToOrganizerDto {
  @ApiProperty({
    description: 'Organization name',
    example: 'ParaScores FC',
  })
  @IsString()
  @IsNotEmpty()
  organization_name: string;

  @ApiPropertyOptional({
    description: 'Contact phone number',
    example: '+1234567890',
  })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({
    description: 'Organization logo URL',
    example: 'https://example.com/logo.png',
  })
  @IsOptional()
  @IsString()
  organization_logo?: string;
}
