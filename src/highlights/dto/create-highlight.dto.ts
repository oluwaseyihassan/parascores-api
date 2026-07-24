import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { HighlightPlatform } from 'prisma/generated/client';

export class CreateHighlightDto {
  @ApiProperty({
    description: 'External video URL for the highlight',
    example: 'https://www.youtube.com/shorts/abc123',
  })
  @IsUrl({}, { message: 'externalUrl must be a valid URL' })
  @IsNotEmpty()
  externalUrl: string;

  @ApiProperty({
    description: 'Video platform',
    enum: HighlightPlatform,
    example: HighlightPlatform.YOUTUBE_SHORTS,
  })
  @IsEnum(HighlightPlatform)
  @IsNotEmpty()
  platform: HighlightPlatform;

  @ApiPropertyOptional({
    description: 'Optional short caption or title for the highlight',
    example: 'Incredible 90th minute winner',
  })
  @IsString()
  @IsOptional()
  caption?: string;

  @ApiPropertyOptional({
    description: 'Duration of the clip in seconds',
    example: 30,
  })
  @IsInt()
  @Min(1)
  @Max(600)
  @IsOptional()
  duration?: number;
}
