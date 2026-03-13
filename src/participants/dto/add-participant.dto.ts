import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateIf,
  IsArray,
  ValidateNested
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class AddParticipantDto {
  @ApiPropertyOptional({
    description: 'ID of the registered user to add',
    example: 'user-coordinate-uuid',
  })
  @ValidateIf((o) => !o.customName || !!o.userId)
  @IsString()
  @IsNotEmpty()
  userId?: string;

  @ApiPropertyOptional({
    description: 'Custom name for a non-registered participant',
    example: 'John Doe (Guest)',
  })
  @ValidateIf((o) => !o.userId || !!o.customName)
  @IsString()
  @IsNotEmpty()
  customName?: string;

  @ApiPropertyOptional({
    description: 'Seed number for the participant',
    example: 1,
  })
  @IsInt()
  @IsOptional()
  seed?: number;

  @ApiPropertyOptional({
    description: 'Team ID if adding a team',
    example: 'team-uuid',
  })
  @IsString()
  @IsOptional()
  teamId?: string;

  @ApiPropertyOptional({
    description: 'Logo URL for the participant',
    example: 'https://example.com/logo.png',
  })
  @IsString()
  @IsOptional()
  logoUrl?: string;
}

export class BulkAddParticipantDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AddParticipantDto)
  participants: AddParticipantDto[];
}
