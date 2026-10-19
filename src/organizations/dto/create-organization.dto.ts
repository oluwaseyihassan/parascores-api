import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsHexColor,
  IsPhoneNumber,
  IsUrl,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

export class CreateOrganizationDto {
  @ApiProperty({ description: 'The name of the organization' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({
    description: 'Optional URL for the organization logo',
  })
  @IsOptional()
  @Transform(({ value }) => (value === '' ? null : value))
  @IsUrl()
  logoUrl?: string;

  @ApiPropertyOptional({
    description: 'Optional bio or description for the organization',
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ description: 'Optional branding color in Hex' })
  @IsOptional()
  @IsHexColor()
  color?: string;

  @ApiPropertyOptional({ description: 'Optional contact phone number' })
  @IsOptional()
  @Transform(({ value }) => {
    if (!value || typeof value !== 'string') return value;
    const trimmed = value.trim().replace(/[\s\-\(\)\.]/g, '');
    if (!trimmed) return undefined;
    if (trimmed.startsWith('+')) return trimmed;
    if (/^0[789][01]\d{8}$/.test(trimmed)) {
      return '+234' + trimmed.slice(1);
    }
    if (/^234\d{10}$/.test(trimmed)) {
      return '+' + trimmed;
    }
    return trimmed;
  })
  @IsPhoneNumber()
  phone?: string;
}
