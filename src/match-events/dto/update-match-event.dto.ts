import { PartialType } from '@nestjs/swagger';
import { CreateMatchEventDto } from './create-match-event.dto';

export class UpdateMatchEventDto extends PartialType(CreateMatchEventDto) {}
