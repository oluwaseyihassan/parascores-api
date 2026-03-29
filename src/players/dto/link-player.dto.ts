import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LinkPlayerDto {
  @ApiProperty({ description: 'User ID to link this player to' })
  @IsString()
  @IsNotEmpty()
  userId: string;
}
