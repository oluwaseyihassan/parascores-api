import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { FixtureStatus } from 'prisma/generated/client';

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
}
