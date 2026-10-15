import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  Min,
  IsObject,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class GenerateFixturesDto {
  @ApiPropertyOptional({
    description: 'Start date/time for the first fixture',
    example: '2024-06-01T14:00:00Z',
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
      'Whether to shuffle/randomize participant order before generating',
    example: false,
    default: false,
  })
  @IsBoolean()
  @IsOptional()
  shuffleParticipants?: boolean;

  @ApiPropertyOptional({
    description: 'If true, clears existing fixtures before generating new ones',
    example: false,
    default: false,
  })
  @IsBoolean()
  @IsOptional()
  clearExisting?: boolean;

  @ApiPropertyOptional({
    description: 'Number of groups to split participants into (for GROUP type)',
    example: 4,
  })
  @IsInt()
  @IsOptional()
  numberOfGroups?: number;

  @ApiPropertyOptional({
    description: 'Number of teams per group (alternative to numberOfGroups)',
    example: 4,
  })
  @IsInt()
  @IsOptional()
  teamsPerGroup?: number;

  @ApiPropertyOptional({
    description:
      'Manual group assignments. Keys are group labels (e.g. "Group A"), values are arrays of participant IDs.',
    example: { 'Group A': ['id1', 'id2'], 'Group B': ['id3', 'id4'] },
  })
  @IsObject()
  @IsOptional()
  groupAssignments?: Record<string, string[]>;

  @ApiPropertyOptional({
    description:
      'If true, use the existing groups and their participant assignments already set in the database.',
    example: true,
    default: false,
  })
  @IsBoolean()
  @IsOptional()
  useExistingGroups?: boolean;
  @ApiPropertyOptional({
    description:
      'If true, pre-generates knockout stage fixtures with group placeholders for HYBRID tournaments',
    example: true,
    default: false,
  })
  @IsBoolean()
  @IsOptional()
  generateKnockoutStage?: boolean;

  @ApiPropertyOptional({
    description:
      'Number of teams advancing from each group to the knockout stage (default 2)',
    example: 2,
    default: 2,
  })
  @IsInt()
  @Min(1)
  @IsOptional()
  advancingPerGroup?: number;

  @ApiPropertyOptional({
    description: 'Whether to include a 3rd place match in knockout stage',
    example: false,
    default: false,
  })
  @IsBoolean()
  @IsOptional()
  hasThirdPlace?: boolean;

  @ApiPropertyOptional({
    description: 'Whether to generate double round-robin fixtures (home & away)',
    example: false,
    default: false,
  })
  @IsBoolean()
  @IsOptional()
  doubleRoundRobin?: boolean;

  @ApiPropertyOptional({
    description: 'Custom knockout first round matchups (placeholders for HYBRID tournaments)',
    example: [{ home: 'Winner Group A', away: 'Runner-up Group B' }],
  })
  @IsOptional()
  knockoutMatchups?: {
    home?: string;
    away?: string;
    homePlaceholder?: string;
    awayPlaceholder?: string;
  }[];

}
