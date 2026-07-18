import { IsString, IsNotEmpty, IsDateString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class StartSeasonDto {
  @ApiProperty({
    description: 'The name of the new season',
    example: '2024/2025',
  })
  @IsString()
  @IsNotEmpty()
  seasonName: string;

  @ApiProperty({ description: 'Start date of the new season' })
  @IsDateString()
  @IsNotEmpty()
  start_date: string;

  @ApiProperty({ description: 'End date of the new season' })
  @IsDateString()
  @IsNotEmpty()
  end_date: string;
}
