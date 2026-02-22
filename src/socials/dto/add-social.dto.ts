import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AddSocialDto {
  @ApiProperty({ description: 'Social media platform name', example: 'twitter' })
  @IsString()
  @IsNotEmpty()
  platform: string;

  @ApiProperty({ description: 'URL to the social media profile or page', example: 'https://twitter.com/tournament' })
  @IsString()
  @IsNotEmpty()
  url: string;

  @ApiPropertyOptional({ description: 'Social media handle', example: '@tournament' })
  @IsString()
  @IsOptional()
  handle?: string;
}

export class UpdateSocialDto {
  @ApiPropertyOptional({ description: 'Social media platform name', example: 'twitter' })
  @IsString()
  @IsOptional()
  platform?: string;

  @ApiPropertyOptional({ description: 'URL to the social media profile or page', example: 'https://twitter.com/tournament' })
  @IsString()
  @IsOptional()
  url?: string;

  @ApiPropertyOptional({ description: 'Social media handle', example: '@tournament' })
  @IsString()
  @IsOptional()
  handle?: string;
}
