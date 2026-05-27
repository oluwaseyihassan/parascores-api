import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class InitializePlayerClaimDto {
  @ApiProperty({ description: 'ID of the player profile to claim' })
  @IsNotEmpty()
  @IsString()
  playerId: string;

  @ApiProperty({ description: '6-character link code for the player profile' })
  @IsNotEmpty()
  @IsString()
  code: string;

  @ApiProperty({
    description: 'URL to redirect after checkout',
    example: 'https://parascores.com/profile',
  })
  @IsNotEmpty()
  @IsString()
  callbackUrl: string;
}
