import {
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { FixtureStage } from 'prisma/generated/client';

export class CreateBulkFixtureItemDto {
  @ApiPropertyOptional({ description: 'Home team participant ID' })
  @IsString()
  @IsOptional()
  homeTeamId?: string;

  @ApiPropertyOptional({ description: 'Away team participant ID' })
  @IsString()
  @IsOptional()
  awayTeamId?: string;

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
}

export class CreateBulkFixturesDto {
  @ApiProperty({
    description: 'Array of fixtures to create in bulk',
    type: [CreateBulkFixtureItemDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateBulkFixtureItemDto)
  fixtures: CreateBulkFixtureItemDto[];
}
