import { IsNotEmpty, IsString, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateGroupDto {
  @ApiProperty({ example: 'Group A' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'tournament-uuid' })
  @IsString()
  @IsNotEmpty()
  tournament_id: string;
}
