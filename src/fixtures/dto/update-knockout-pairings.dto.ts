import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsOptional, IsString, ValidateNested } from 'class-validator';

export class KnockoutPairingItemDto {
  @ApiProperty({ description: 'Fixture ID of the match' })
  @IsString()
  fixtureId: string;

  @ApiProperty({ description: 'Home participant ID', required: false })
  @IsOptional()
  @IsString()
  homeTeamId?: string;

  @ApiProperty({ description: 'Away participant ID', required: false })
  @IsOptional()
  @IsString()
  awayTeamId?: string;
}

export class UpdateKnockoutPairingsDto {
  @ApiProperty({
    description: 'Array of match pairings to update',
    type: [KnockoutPairingItemDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => KnockoutPairingItemDto)
  pairings: KnockoutPairingItemDto[];
}
