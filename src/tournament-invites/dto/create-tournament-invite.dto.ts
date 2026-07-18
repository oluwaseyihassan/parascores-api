import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsDateString,
  IsInt,
  Min,
} from 'class-validator';

export class CreateTournamentInviteDto {
  @ApiProperty({ description: 'ID of the tournament' })
  @IsString()
  tournamentId: string;

  @ApiProperty({ required: false, description: 'Maximum number of uses' })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxUses?: number;

  @ApiProperty({ required: false, description: 'Expiration date' })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
