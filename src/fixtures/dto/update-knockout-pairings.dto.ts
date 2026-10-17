import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsString, ValidateNested } from 'class-validator';

export class KnockoutPairingItemDto {
  @ApiProperty({ description: 'Fixture ID of the match' })
  @IsString()
  fixtureId: string;

  @ApiProperty({ description: 'Home participant ID' })
  @IsString()
  homeTeamId: string;

  @ApiProperty({ description: 'Away participant ID' })
  @IsString()
  awayTeamId: string;
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
