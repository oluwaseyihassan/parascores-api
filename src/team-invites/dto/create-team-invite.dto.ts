import { IsNotEmpty, IsOptional, IsString, IsInt, IsDateString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTeamInviteDto {
  @ApiProperty({ description: 'Participant (team) ID to create invite for' })
  @IsString()
  @IsNotEmpty()
  participantId: string;

  @ApiProperty({ description: 'Tournament ID' })
  @IsString()
  @IsNotEmpty()
  tournamentId: string;

  @ApiPropertyOptional({ description: 'Max number of uses (null = unlimited)' })
  @IsInt()
  @IsOptional()
  maxUses?: number;

  @ApiPropertyOptional({ description: 'Expiry date (ISO string, null = never)' })
  @IsDateString()
  @IsOptional()
  expiresAt?: string;
}
