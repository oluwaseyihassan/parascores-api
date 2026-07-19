import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FixtureStage } from 'prisma/generated/client';

export class CreateFixtureDto {
  @ApiProperty({ description: 'Tournament ID' })
  @IsString()
  tournament_id: string;

  @ApiProperty({ description: 'Home team participant ID' })
  @IsString()
  homeTeamId: string;

  @ApiProperty({ description: 'Away team participant ID' })
  @IsString()
  awayTeamId: string;

  @ApiProperty({ description: 'Round number', example: 1 })
  @IsInt()
  @Min(1)
  round: number;

  @ApiPropertyOptional({
    description: 'Round name (e.g. "Matchday 1")',
    example: 'Matchday 1',
  })
  @IsString()
  @IsOptional()
  roundName?: string;

  @ApiPropertyOptional({ description: 'Match number within the round' })
  @IsInt()
  @IsOptional()
  matchNumber?: number;

  @ApiPropertyOptional({
    description: 'Match start time',
    example: '2024-06-01T15:00:00Z',
  })
  @IsDateString()
  @IsOptional()
  startTime?: string;

  @ApiPropertyOptional({
    description: 'Match venue',
    example: 'Main Stadium',
  })
  @IsString()
  @IsOptional()
  venue?: string;

  @ApiPropertyOptional({
    description: 'Group ID (for GROUP/HYBRID tournaments)',
  })
  @IsString()
  @IsOptional()
  groupId?: string;

  @ApiPropertyOptional({
    description: 'Fixture stage (GROUP_STAGE or KNOCKOUT)',
    enum: FixtureStage,
  })
  @IsEnum(FixtureStage)
  @IsOptional()
  stage?: FixtureStage;

  @ApiPropertyOptional({
    description: 'Match duration in minutes',
    example: 90,
  })
  @IsInt()
  @Min(1)
  @IsOptional()
  matchDuration?: number;

  @ApiPropertyOptional({
    description: 'Livestream URL for the match (YouTube, Twitch, Facebook, etc.)',
    example: 'https://youtube.com/watch?v=abc123',
  })
  @IsString()
  @IsOptional()
  livestreamUrl?: string;

  @ApiPropertyOptional({
    description: 'Livestream platform name (e.g. youtube, twitch, facebook)',
    example: 'youtube',
  })
  @IsString()
  @IsOptional()
  livestreamPlatform?: string;
}
