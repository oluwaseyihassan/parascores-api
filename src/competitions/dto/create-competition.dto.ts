import { IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCompetitionDto {
  @ApiProperty({
    description: 'The name of the competition / league',
    example: 'Premier League',
  })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({
    description: 'Custom slug for URLs (auto-generated if omitted)',
    example: 'premier-league',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9-]+$/, {
    message: 'Slug can only contain lowercase letters, numbers, and hyphens',
  })
  slug?: string;

  @ApiPropertyOptional({
    description: 'Description of the competition',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    description: 'Sport discipline',
    example: 'football',
  })
  @IsString()
  @IsNotEmpty()
  sport: string;

  @ApiProperty({
    description: 'Owning organization ID',
  })
  @IsString()
  @IsNotEmpty()
  organization_id: string;

  @ApiPropertyOptional({
    description: 'Logo URL',
  })
  @IsOptional()
  @IsString()
  logoUrl?: string;

  @ApiPropertyOptional({
    description: 'Banner URL',
  })
  @IsOptional()
  @IsString()
  bannerUrl?: string;
}