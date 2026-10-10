import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  ValidateNested,
  IsNotEmpty,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ResultEntryDto {
  @ApiProperty({ description: 'Participant ID' })
  @IsString()
  @IsNotEmpty()
  participantId: string;

  @ApiPropertyOptional({
    description: 'Result value — time or distance as string (e.g. "10.42", "2:03.44", "8.95"). Optional when a manual rank is provided.',
    example: '10.42',
  })
  @IsString()
  @IsOptional()
  value?: string;

  @ApiPropertyOptional({
    description: 'Manual rank/place override (when no time is recorded)',
    example: 1,
  })
  @IsInt()
  @IsOptional()
  rank?: number;

  @ApiPropertyOptional({ description: 'Lane number', example: 4 })
  @IsInt()
  @IsOptional()
  lane?: number;

  @ApiPropertyOptional({ description: 'Note (e.g. "PB", "GR", "Wind +0.4")', example: 'PB' })
  @IsString()
  @IsOptional()
  note?: string;
}

export class SetResultsDto {
  @ApiProperty({ type: [ResultEntryDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ResultEntryDto)
  results: ResultEntryDto[];

  @ApiPropertyOptional({
    description:
      'Ranking direction: "low" = lowest value wins (races, default); "high" = highest value wins (weightlifting, jumps, throws)',
    enum: ['low', 'high'],
    example: 'low',
  })
  @IsIn(['low', 'high'])
  @IsOptional()
  direction?: 'low' | 'high';
}
