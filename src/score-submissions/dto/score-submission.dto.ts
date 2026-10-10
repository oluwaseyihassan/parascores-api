import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateScoreSubmissionDto {
  @IsInt()
  @Min(0)
  @Max(999)
  homeScore: number;

  @IsInt()
  @Min(0)
  @Max(999)
  awayScore: number;

  @IsOptional()
  legs?: { home: number; away: number }[];

  @IsOptional()
  @IsString()
  evidenceUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class ResolveDisputeDto {
  // Accept one of the two entries…
  @IsOptional()
  @IsString()
  acceptSubmissionId?: string;

  // …or override with the correct score
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(999)
  homeScore?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(999)
  awayScore?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  verdictNote?: string;
}
