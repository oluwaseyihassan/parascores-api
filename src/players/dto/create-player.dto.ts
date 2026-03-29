import { IsInt, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePlayerDto {
  @ApiProperty({ description: 'ID of the participant this player belongs to' })
  @IsString()
  @IsNotEmpty()
  participantId: string;

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

  @ApiPropertyOptional({ description: 'User ID to link this player to a user account' })
  @IsString()
  @IsOptional()
  userId?: string;

  @ApiPropertyOptional({ description: 'Avatar URL of the player' })
  @IsString()
  @IsOptional()
  avatarUrl?: string;
}
