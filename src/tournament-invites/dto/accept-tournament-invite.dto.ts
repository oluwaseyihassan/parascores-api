import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional } from 'class-validator';

export class AcceptTournamentInviteDto {
  @ApiProperty({ description: 'The custom name for the new team', required: false })
  @IsOptional()
  @IsString()
  customName?: string;

  @ApiProperty({ description: 'The short name/abbreviation for the new team', required: false })
  @IsOptional()
  @IsString()
  customShortName?: string;

  @ApiProperty({ required: false, description: 'Optional logo URL for the team' })
  @IsOptional()
  @IsString()
  logoUrl?: string;

  @ApiProperty({ required: false, description: 'ID of an existing persistent team profile' })
  @IsOptional()
  @IsString()
  teamId?: string;
}
