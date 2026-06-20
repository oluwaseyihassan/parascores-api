import { IsString, IsOptional, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateParticipantDto {
  @ApiProperty({ description: 'Custom name for the participant/team', required: false })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  customName?: string;

  @ApiProperty({ description: 'Short name/abbreviation for the participant/team', required: false })
  @IsString()
  @IsOptional()
  @MaxLength(10)
  customShortName?: string;

  @ApiProperty({ description: 'Logo URL for the participant/team', required: false })
  @IsString()
  @IsOptional()
  logoUrl?: string;

  @ApiProperty({ description: 'Group ID for assignment', required: false })
  @IsString()
  @IsOptional()
  groupId?: string | null;

  @ApiProperty({ description: 'Team ID for profile linking', required: false })
  @IsString()
  @IsOptional()
  teamId?: string | null;
}
