import { IsString, IsNotEmpty, IsOptional, IsUrl } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

export class CreateTeamDto {
  @ApiProperty({ example: 'Real Madrid' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'https://example.com/logo.png', required: false })
  @IsOptional()
  @Transform(({ value }) => (value === '' ? null : value))
  @IsUrl()
  logoUrl?: string;
}
