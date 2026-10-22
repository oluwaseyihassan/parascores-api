import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  Min,
  IsObject,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class GenerateKnockoutPlaceholdersDto {
  @ApiPropertyOptional({
    description: 'Number of groups (for HYBRID tournament)',
    example: 2,
  })
  @IsInt()
  @IsOptional()
  numberOfGroups?: number;

  @ApiPropertyOptional({
    description: 'Number of teams advancing per group',
    example: 2,
    default: 2,
  })
  @IsInt()
  @Min(1)
  @IsOptional()
  advancingPerGroup?: number;

  @ApiPropertyOptional({
    description: 'Whether to include a 3rd place match',
    example: false,
    default: false,
  })
  @IsBoolean()
  @IsOptional()
  hasThirdPlace?: boolean;

  @ApiPropertyOptional({
    description: 'Start date/time for the first knockout fixture',
  })
  @IsDateString()
  @IsOptional()
  startDate?: string;

  @ApiPropertyOptional({
    description: 'Time interval between matches in minutes',
    example: 90,
    default: 90,
  })
  @IsInt()
  @Min(30)
  @IsOptional()
  intervalMinutes?: number;

  @ApiPropertyOptional({
    description:
      'Custom knockout first round matchups (placeholders for HYBRID tournaments)',
    example: [{ home: 'Winner Group A', away: 'Runner-up Group B' }],
  })
  @IsOptional()
  knockoutMatchups?: {
    home?: string;
    away?: string;
    homePlaceholder?: string;
    awayPlaceholder?: string;
  }[];

  @ApiPropertyOptional({
    description:
      'If true, all teams share a single unified standings table (e.g. Champions League / Swiss model)',
    example: false,
    default: false,
  })
  @IsBoolean()
  @IsOptional()
  unifiedStandings?: boolean;

  @ApiPropertyOptional({
    description:
      'If true, middle seeds compete in Knockout Play-offs before Round of 16 (UEFA Champions League format)',
    example: true,
    default: false,
  })
  @IsBoolean()
  @IsOptional()
  hasKnockoutPlayoffs?: boolean;

  @ApiPropertyOptional({
    description:
      'Manual group assignments. Keys are group labels (e.g. Group A), values are arrays of participant IDs.',
    example: { 'Group A': ['id1', 'id2'], 'Group B': ['id3', 'id4'] },
  })
  @IsObject()
  @IsOptional()
  groupAssignments?: Record<string, string[]>;
}
