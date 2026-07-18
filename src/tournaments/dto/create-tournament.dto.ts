import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';
import {
  TournamentType,
  ParticipantType,
  Visibility,
} from 'prisma/generated/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTournamentDto {
  @ApiProperty({
    description: 'The name of the tournament',
    example: 'Summer Championship 2024',
  })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({
    description: 'Unique custom name/slug for the tournament URL',
    example: 'summer-championship-2024',
  })
  @IsString()
  @IsOptional()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message:
      'customName must be a valid slug (lowercase letters, numbers, and hyphens only)',
  })
  customName?: string;

  @ApiPropertyOptional({
    description: 'A brief description of the tournament',
    example: 'Annual summer tournament for local teams.',
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({
    description: 'The sport of the tournament',
    example: 'Football',
  })
  @IsString()
  @IsNotEmpty()
  sport: string;

  @ApiProperty({
    description: 'Type of the tournament',
    enum: TournamentType,
    example: TournamentType.KNOCKOUT,
  })
  @IsEnum(TournamentType)
  type: TournamentType;

  @ApiProperty({
    description: 'Type of participants involved',
    enum: ParticipantType,
    example: ParticipantType.TEAM,
  })
  @IsEnum(ParticipantType)
  participantType: ParticipantType;

  @ApiPropertyOptional({
    description: 'Visibility of the tournament',
    enum: Visibility,
    default: Visibility.PUBLIC,
    example: Visibility.PUBLIC,
  })
  @IsEnum(Visibility)
  @IsOptional()
  visibility?: Visibility;

  @ApiProperty({
    description: 'Configuration for scoring rules',
    example: { pointsPerWin: 3, pointsPerDraw: 1 },
  })
  @IsObject()
  @IsNotEmpty()
  scoringRules: Record<string, any>;

  @ApiProperty({
    description: 'Start date of the tournament',
    example: '2024-06-01T00:00:00Z',
  })
  @IsDateString()
  start_date: string;

  @ApiProperty({
    description: 'End date of the tournament',
    example: '2024-06-30T23:59:59Z',
  })
  @IsDateString()
  end_date: string;

  @ApiPropertyOptional({
    description: 'Location where the tournament is held',
    example: 'New York, NY',
  })
  @IsString()
  @IsOptional()
  location?: string;

  @ApiPropertyOptional({
    description: 'Number of groups for group stage',
    example: 4,
  })
  @IsInt()
  @IsOptional()
  numberOfGroups?: number;

  @ApiPropertyOptional({ description: 'Number of teams per group', example: 4 })
  @IsInt()
  @IsOptional()
  teamsPerGroup?: number;

  @ApiPropertyOptional({
    description: 'Timezone of the tournament location',
    example: 'America/New_York',
  })
  @IsString()
  @IsOptional()
  timezone?: string;

  @ApiProperty({
    description: 'Maximum number of participants allowed',
    example: 16,
  })
  @IsInt()
  @IsNotEmpty()
  maxParticipants: number;

  @ApiPropertyOptional({
    description: 'Date when registration opens',
    example: '2024-05-01T00:00:00Z',
  })
  @IsDateString()
  @IsOptional()
  registrationOpen?: string;

  @ApiPropertyOptional({
    description: 'Date when registration closes',
    example: '2024-05-31T23:59:59Z',
  })
  @IsDateString()
  @IsOptional()
  registrationClose?: string;

  @ApiPropertyOptional({
    description:
      'Whether participants are automatically approved upon registration',
    default: false,
    example: true,
  })
  @IsBoolean()
  @IsOptional()
  autoApprove?: boolean;

  @ApiPropertyOptional({
    description: 'Whether registration requires payment',
    default: false,
    example: true,
  })
  @IsBoolean()
  @IsOptional()
  isPaidRegistration?: boolean;

  @ApiPropertyOptional({
    description: 'The registration fee in kobo/cents',
    default: 0,
    example: 100000,
  })
  @IsInt()
  @IsOptional()
  registrationFee?: number;

  @ApiPropertyOptional({
    description:
      'If true, the tournament is pinned to the top of the dashboard',
    default: false,
    example: true,
  })
  @IsBoolean()
  @IsOptional()
  isPinned?: boolean;

  @ApiPropertyOptional({
    description:
      'If true, knockout rounds (excluding final) will have two legs',
    default: false,
    example: true,
  })
  @IsBoolean()
  @IsOptional()
  twoLegsKnockout?: boolean;

  @ApiPropertyOptional({
    description:
      'If true, a third-place match is generated for tournament losers',
    default: false,
    example: true,
  })
  @IsBoolean()
  @IsOptional()
  thirdPlaceMatch?: boolean;

  @ApiPropertyOptional({
    description:
      'If true, teams play each other twice in round-robin or group stages',
    default: false,
    example: true,
  })
  @IsBoolean()
  @IsOptional()
  doubleRoundRobin?: boolean;

  @ApiPropertyOptional({
    description: 'URL for the tournament logo',
    example: 'https://example.com/logo.png',
  })
  @IsString()
  @IsOptional()
  logoUrl?: string;

  @ApiPropertyOptional({
    description: 'URL for the tournament banner',
    example: 'https://example.com/banner.png',
  })
  @IsString()
  @IsOptional()
  bannerUrl?: string;

  @ApiProperty({
    description: 'The ID of the organization that owns this tournament',
  })
  @IsString()
  @IsNotEmpty()
  organization_id: string;
}
