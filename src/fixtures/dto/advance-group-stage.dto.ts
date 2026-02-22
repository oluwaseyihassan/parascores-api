import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString } from 'class-validator';

export class AdvanceGroupStageDto {
  @ApiProperty({
    description: 'Array of participant IDs to advance to the knockout stage (optional)',
    required: false,
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  qualifiedParticipantIds?: string[];
}
