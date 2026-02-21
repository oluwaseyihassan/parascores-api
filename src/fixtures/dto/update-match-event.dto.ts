import { PartialType } from '@nestjs/swagger';
import { AddMatchEventDto } from './add-match-event.dto';

export class UpdateMatchEventDto extends PartialType(AddMatchEventDto) {}
