import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsNumber } from 'class-validator';

export class InitializeTeamJoinDto {
  @ApiProperty({ description: 'Invite token for the team' })
  @IsNotEmpty()
  @IsString()
  token: string;

  @ApiProperty({ description: 'Player name' })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiProperty({ description: 'Shirt number', required: false })
  @IsOptional()
  @IsNumber()
  number?: number;

  @ApiProperty({ description: 'Player position', required: false })
  @IsOptional()
  @IsString()
  position?: string;

  @ApiProperty({ description: 'Avatar URL', required: false })
  @IsOptional()
  @IsString()
  avatarUrl?: string;

  @ApiProperty({
    description: 'URL to redirect after checkout',
    example: 'https://parascores.com/join/invite-token',
  })
  @IsNotEmpty()
  @IsString()
  callbackUrl: string;
}
