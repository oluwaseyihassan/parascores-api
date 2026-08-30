import {
  IsString,
  IsOptional,
  IsUrl,
  IsObject,
  Matches,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

export class UpdateOrganizationDto {
  @ApiProperty({ description: 'The name of the organization', required: false })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiProperty({
    description: 'The bio or description of the organization',
    required: false,
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({
    description: 'The logo URL of the organization',
    required: false,
  })
  @Transform(({ value }) => (value === '' ? null : value))
  @IsUrl()
  @IsOptional()
  logoUrl?: string;

  @ApiProperty({
    description: 'The banner URL of the organization',
    required: false,
  })
  @Transform(({ value }) => (value === '' ? null : value))
  @IsUrl()
  @IsOptional()
  bannerUrl?: string;

  @ApiProperty({
    description: 'The location of the organization',
    required: false,
  })
  @IsString()
  @IsOptional()
  location?: string;

  @ApiProperty({
    description: 'The website of the organization',
    required: false,
  })
  @Transform(({ value }) => (value === '' ? null : value))
  @IsUrl()
  @IsOptional()
  website?: string;

  @ApiProperty({
    description:
      'Event hub subdomain (e.g. "waug26" -> waug26.parascores.com). Lowercase letters, numbers and hyphens only.',
    required: false,
  })
  @Transform(({ value }) => (value === '' || value === null ? null : value))
  @IsString()
  @Matches(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/, {
    message:
      'subdomain must be lowercase letters, numbers and hyphens, and not start or end with a hyphen',
  })
  @IsOptional()
  subdomain?: string | null;

  @ApiProperty({
    description:
      'Event hub brand configuration (colors, hero text, sponsors, section toggles)',
    required: false,
  })
  @IsObject()
  @IsOptional()
  brandConfig?: Record<string, any>;
}
