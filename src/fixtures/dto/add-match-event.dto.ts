import { IsEnum, IsInt, IsOptional, IsString, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MatchEventType } from 'prisma/generated/client';

export class AddMatchEventDto {
  @ApiProperty({ description: 'Type of event', enum: MatchEventType, example: MatchEventType.GOAL })
  @IsEnum(MatchEventType)
  type: MatchEventType;

  @ApiPropertyOptional({ description: 'Minute when event occurred', example: 45 })
  @IsInt()
  @Min(0)
  @Max(200)
  @IsOptional()
  minute?: number;

  @ApiPropertyOptional({ description: 'Participant (team) ID involved in the event' })
  @IsString()
  @IsOptional()
  participantId?: string;

  @ApiPropertyOptional({ description: 'Player ID who performed the action (e.g., scorer)' })
  @IsString()
  @IsOptional()
  playerId?: string;

  @ApiPropertyOptional({ description: 'Related player ID (e.g., player subbed off, or assist provider)' })
  @IsString()
  @IsOptional()
  relatedPlayerId?: string;

  @ApiPropertyOptional({ description: 'Event description', example: 'Volley from outside the box' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ description: 'Additional metadata as JSON' })
  @IsOptional()
  metadata?: Record<string, any>;
}
