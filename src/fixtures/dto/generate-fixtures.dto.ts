import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  Min,
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
    description: 'If true, play double round robin (home and away)',
    example: true,
  })
  @IsBoolean()
  @IsOptional()
  doubleRoundRobin?: boolean;
}
