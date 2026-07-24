import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { HighlightPlatform } from 'prisma/generated/client';

export class HighlightResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  fixture_id: string;

  @ApiProperty({ enum: HighlightPlatform })
  platform: HighlightPlatform;

  @ApiProperty()
  externalUrl: string;

  @ApiProperty()
  embedUrl: string;

  @ApiPropertyOptional()
  thumbnailUrl?: string | null;

  @ApiPropertyOptional()
  caption?: string | null;

  @ApiPropertyOptional()
  duration?: number | null;

  @ApiProperty()
  createdById: string;

  @ApiProperty()
  created_at: Date;

  @ApiProperty()
  updated_at: Date;
}
