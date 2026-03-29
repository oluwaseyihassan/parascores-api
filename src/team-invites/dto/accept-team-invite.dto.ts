import { IsNotEmpty, IsOptional, IsString, IsInt } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AcceptTeamInviteDto {
  @ApiProperty({ description: 'Player name' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ description: 'Shirt number' })
  @IsInt()
  @IsOptional()
  number?: number;

  @ApiPropertyOptional({ description: 'Position (GK, DEF, MID, FWD)' })
  @IsString()
  @IsOptional()
  position?: string;

  @ApiPropertyOptional({ description: 'Avatar URL' })
  @IsString()
  @IsOptional()
  avatarUrl?: string;
}
