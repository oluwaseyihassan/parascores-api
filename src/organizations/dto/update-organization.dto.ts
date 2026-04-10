import { IsString, IsOptional, IsUrl } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateOrganizationDto {
  @ApiProperty({ description: 'The name of the organization', required: false })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiProperty({ description: 'The logo URL of the organization', required: false })
  @IsUrl()
  @IsOptional()
  logoUrl?: string;

  @ApiProperty({ description: 'The banner URL of the organization', required: false })
  @IsUrl()
  @IsOptional()
  bannerUrl?: string;

  @ApiProperty({ description: 'The location of the organization', required: false })
  @IsString()
  @IsOptional()
  location?: string;

  @ApiProperty({ description: 'The website of the organization', required: false })
  @IsUrl()
  @IsOptional()
  website?: string;
}
