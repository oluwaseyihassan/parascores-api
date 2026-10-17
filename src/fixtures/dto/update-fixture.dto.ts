import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
  IsArray,
  Matches,
  IsBoolean,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { FixtureStatus, MatchHalf } from 'prisma/generated/client';

export class UpdateFixtureDto {
  @ApiPropertyOptional({
    description: 'Match status',
    enum: FixtureStatus,
    example: FixtureStatus.LIVE,
  })
  @IsEnum(FixtureStatus)
  @IsOptional()
  status?: FixtureStatus;

  @ApiPropertyOptional({ description: 'Home team score', example: 2 })
  @IsInt()
  @Min(0)
  @IsOptional()
  homeScore?: number;

  @ApiPropertyOptional({ description: 'Away team score', example: 1 })
  @IsInt()
  @Min(0)
  @IsOptional()
  awayScore?: number;

  @ApiPropertyOptional({
    description: 'Home team penalty score (if penalty shootout)',
    example: 5,
  })
  @IsInt()
  @Min(0)
  @IsOptional()
  homePenaltyScore?: number;

  @ApiPropertyOptional({
    description: 'Away team penalty score (if penalty shootout)',
    example: 4,
  })
  @IsInt()
  @Min(0)
  @IsOptional()
  awayPenaltyScore?: number;

  @ApiPropertyOptional({
    description: 'Match start time',
    example: '2024-06-01T15:00:00Z',
  })
  @IsDateString()
  @IsOptional()
  startTime?: string;

  @ApiPropertyOptional({
    description: 'Home team ID',
    example: 'participant-id',
  })
  @IsString()
  @IsOptional()
  homeTeamId?: string;

  @ApiPropertyOptional({
    description: 'Away team ID',
    example: 'participant-id',
  })
  @IsString()
  @IsOptional()
  awayTeamId?: string;

  @ApiPropertyOptional({
    description: 'Match venue/location name',
    example: 'Main Bowl',
  })
  @IsString()
  @IsOptional()
  venue?: string;

  @ApiPropertyOptional({
    description: 'Array of player IDs selected for the match lineup',
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  lineupPlayerIds?: string[];

  @ApiPropertyOptional({
    description: 'Home team formation (e.g. 4-3-3, 4-2-3-1)',
    example: '4-3-3',
  })
  @IsString()
  @Matches(/^\d(-\d){1,4}$/, {
    message: 'homeFormation must be a valid formation like 4-3-3 or 4-2-3-1',
  })
  @IsOptional()
  homeFormation?: string;

  @ApiPropertyOptional({
    description: 'Away team formation (e.g. 4-3-3, 4-2-3-1)',
    example: '4-2-3-1',
  })
  @IsString()
  @Matches(/^\d(-\d){1,4}$/, {
    message: 'awayFormation must be a valid formation like 4-3-3 or 4-2-3-1',
  })
  @IsOptional()
  awayFormation?: string;

  @ApiPropertyOptional({
    description:
      'Lineup positions mapping player IDs to coordinate position strings',
    example: { 'player-id-1': 'DEF-1-3' },
  })
  @IsOptional()
  lineupPositions?: Record<string, string>;

  @ApiPropertyOptional({
    description: 'Match timer start time',
    example: '2024-06-01T15:00:00Z',
  })
  @IsDateString()
  @IsOptional()
  timerStartedAt?: string;

  @ApiPropertyOptional({
    description: 'Match timer elapsed duration in seconds',
    example: 2700,
  })
  @IsInt()
  @IsOptional()
  timerElapsedSeconds?: number;

  @ApiPropertyOptional({
    description: 'Whether the match timer is running',
    example: true,
  })
  @IsBoolean()
  @IsOptional()
  timerIsRunning?: boolean;

  @ApiPropertyOptional({
    description: 'Match duration in minutes',
    example: 90,
  })
  @IsInt()
  @Min(1)
  @IsOptional()
  matchDuration?: number;

  @ApiPropertyOptional({
    description: 'Current match half',
    enum: MatchHalf,
    example: MatchHalf.SECOND_HALF,
  })
  @IsEnum(MatchHalf)
  @IsOptional()
  half?: MatchHalf;

  @ApiPropertyOptional({
    description: 'Player ID selected as Man of the Match',
    example: 'player-id',
  })
  @IsString()
  @IsOptional()
  manOfTheMatchPlayerId?: string;

  @ApiPropertyOptional({
    description:
      'Per-period scores for set/period sports (tennis sets, basketball quarters). Shape: { home: number[], away: number[] }',
    example: { home: [6, 3], away: [4, 6] },
  })
  @IsOptional()
  periodScores?: { home: number[]; away: number[] };

  @ApiPropertyOptional({
    description:
      'Per-fixture engine config overrides (e.g. { setsToWin: 3 } for a best-of-5 final). Falls back to tournament scoringRules then engine defaults.',
    example: { setsToWin: 3 },
  })
  @IsOptional()
  config?: Record<string, any>;

  @ApiPropertyOptional({
    description:
      'Livestream URL for the match (YouTube, Twitch, Facebook, etc.)',
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

  @ApiPropertyOptional({
    description: 'Explicitly allow reopening a completed fixture back to LIVE',
    example: true,
  })
  @IsBoolean()
  @IsOptional()
  allowReopen?: boolean;
}
