import {
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateChatMessageDto {
  @IsString()
  @MaxLength(2000)
  text: string;

  // Quoted reply target — must be a live message in the same room
  @IsOptional()
  @IsString()
  replyToId?: string;
}

export class PinChatMessageDto {
  @IsBoolean()
  pin: boolean;
}

export class ReactChatMessageDto {
  @IsString()
  @MaxLength(8)
  emoji: string;
}

export class UpdateChatSettingsDto {
  @IsOptional()
  @IsBoolean()
  chatEnabled?: boolean;

  // Empty string clears the rules
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  chatRules?: string;

  @IsOptional()
  @IsObject()
  parageeBot?: {
    enabled?: boolean;
    fixtures?: boolean;
    standings?: boolean;
    rules?: boolean;
    quickChips?: boolean;
    llm?: boolean;
  };
}
