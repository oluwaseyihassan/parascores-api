import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class AddPlayerDto {
  @ApiProperty({ description: 'Name of the player', example: 'Lionel Messi' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ description: 'Shirt number', example: 10 })
  @IsInt()
  @IsOptional()
  number?: number;

  @ApiPropertyOptional({
    description: 'Position (e.g., GK, DEF, MID, FWD)',
    example: 'FWD',
  })
  @IsString()
  @IsOptional()
  position?: string;
}

export class BulkAddPlayerDto {
  @ApiProperty({ type: [AddPlayerDto], description: 'List of players to add' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AddPlayerDto)
  players: AddPlayerDto[];
}
