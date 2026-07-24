import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class InitializeRegistrationDto {
  @ApiProperty({ description: 'Tournament ID to register for' })
  @IsNotEmpty()
  @IsString()
  tournamentId: string;

  @ApiPropertyOptional({
    description: 'Existing Team ID if registering with an existing team',
  })
  @IsOptional()
  @IsString()
  teamId?: string;

  @ApiPropertyOptional({
    description:
      'Custom participant/team name if registering a new or custom team',
  })
  @IsOptional()
  @IsString()
  customName?: string;

  @ApiPropertyOptional({ description: 'Logo URL for custom participant' })
  @IsOptional()
  @IsString()
  logoUrl?: string;

  @ApiProperty({
    description: 'Invite token to validate registration permissions',
  })
  @IsNotEmpty()
  @IsString()
  token: string;

  @ApiProperty({
    description: 'URL to redirect after checkout',
    example: 'https://parascores.com/t-join/token',
  })
  @IsNotEmpty()
  @IsString()
  callbackUrl: string;
}
