import { IsNotEmpty, IsNumber, IsString, Max, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreatePredictionDto {
  @ApiProperty({ description: 'The tournament ID' })
  @IsString()
  @IsNotEmpty()
  tournamentId: string;

  @ApiProperty({ description: 'The fixture ID' })
  @IsString()
  @IsNotEmpty()
  fixtureId: string;

  @ApiProperty({ description: 'Predicted home score', minimum: 0, maximum: 30 })
  @IsNumber()
  @Min(0)
  @Max(30)
  homeScore: number;

  @ApiProperty({ description: 'Predicted away score', minimum: 0, maximum: 30 })
  @IsNumber()
  @Min(0)
  @Max(30)
  awayScore: number;
}
