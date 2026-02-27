import { IsInt, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateStandingDto {
  @ApiProperty({ description: 'ID of the tournament' })
  @IsString()
  @IsNotEmpty()
  tournament_id: string;

  @ApiProperty({ description: 'ID of the participant' })
  @IsString()
  @IsNotEmpty()
  participant_id: string;

  @ApiPropertyOptional({ description: 'Matches played' })
  @IsInt()
  @IsOptional()
  played?: number = 0;

  @ApiPropertyOptional({ description: 'Matches won' })
  @IsInt()
  @IsOptional()
  wins?: number = 0;

  @ApiPropertyOptional({ description: 'Matches drawn' })
  @IsInt()
  @IsOptional()
  draws?: number = 0;

  @ApiPropertyOptional({ description: 'Matches lost' })
  @IsInt()
  @IsOptional()
  losses?: number = 0;

  @ApiPropertyOptional({ description: 'Goals for' })
  @IsInt()
  @IsOptional()
  goalsFor?: number = 0;

  @ApiPropertyOptional({ description: 'Goals against' })
  @IsInt()
  @IsOptional()
  goalsAgainst?: number = 0;

  @ApiPropertyOptional({ description: 'Total points' })
  @IsInt()
  @IsOptional()
  points?: number = 0;

  @ApiPropertyOptional({ description: 'Group name (for group stages)' })
  @IsString()
  @IsOptional()
  group?: string;
  
  @ApiPropertyOptional({ description: 'Explicit position (if enforced manually)' })
  @IsInt()
  @IsOptional()
  position?: number;
}
