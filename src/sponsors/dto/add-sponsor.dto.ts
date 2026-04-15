import { IsNotEmpty, IsOptional, IsString, IsUrl } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AddSponsorDto {
  @ApiProperty({ description: 'Name of the sponsor', example: 'Nike' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({
    description: 'Short description of the sponsor',
    example: 'Official kit sponsor',
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({
    description: 'URL to the sponsor logo image',
    example: 'https://example.com/logo.png',
  })
  @IsString()
  @IsOptional()
  logoUrl?: string;

  @ApiPropertyOptional({
    description: 'Website URL of the sponsor',
    example: 'https://nike.com',
  })
  @IsString()
  @IsOptional()
  websiteUrl?: string;
}

export class UpdateSponsorDto {
  @ApiPropertyOptional({ description: 'Name of the sponsor', example: 'Nike' })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({
    description: 'Short description of the sponsor',
    example: 'Official kit sponsor',
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({
    description: 'URL to the sponsor logo image',
    example: 'https://example.com/logo.png',
  })
  @IsString()
  @IsOptional()
  logoUrl?: string;

  @ApiPropertyOptional({
    description: 'Website URL of the sponsor',
    example: 'https://nike.com',
  })
  @IsString()
  @IsOptional()
  websiteUrl?: string;
}
