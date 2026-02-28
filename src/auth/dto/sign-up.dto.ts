import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Role } from '../enums/role.enum';

export class SignUpDto {
  @ApiProperty({
    description: 'User email address',
    example: 'user@example.com',
  })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({
    description: 'User password (min 6 characters)',
    example: 'password123',
    minLength: 6,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  password: string;

  @ApiProperty({ description: 'User first name', example: 'John' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({
    description: 'Name of the organization',
    example: 'Acme Corp',
  })
  @IsOptional()
  @IsString()
  organization_name?: string;

  @ApiPropertyOptional({
    description: 'URL to organization logo',
    example: 'https://example.com/logo.png',
  })
  @IsOptional()
  @IsString()
  organization_logo?: string;

  @ApiPropertyOptional({
    description: 'Primary color of the organization',
    example: '#FF5733',
  })
  @IsOptional()
  @IsString()
  organization_color?: string;

  @ApiPropertyOptional({
    description: 'User role',
    enum: Role,
    default: Role.USER,
  })
  @IsOptional()
  @IsEnum(Role)
  role?: Role;
}
