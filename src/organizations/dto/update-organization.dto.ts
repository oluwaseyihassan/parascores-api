import {
  IsString,
  IsOptional,
  IsUrl,
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
}
