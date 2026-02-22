import { IsInt, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AddPlayerDto {
  @ApiProperty({ description: 'Name of the player', example: 'Lionel Messi' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ description: 'Shirt number', example: 10 })
  @IsInt()
  @IsOptional()
  number?: number;

  @ApiPropertyOptional({ description: 'Position (e.g., GK, DEF, MID, FWD)', example: 'FWD' })
  @IsString()
  @IsOptional()
  position?: string;
}
