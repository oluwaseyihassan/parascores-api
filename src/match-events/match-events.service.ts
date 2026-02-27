import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateMatchEventDto } from './dto/create-match-event.dto';
import { UpdateMatchEventDto } from './dto/update-match-event.dto';
import { DatabaseService } from 'src/database/database.service';
import { FixturesService } from 'src/fixtures/fixtures.service';
import { ResponseUtil } from 'src/utils/api-response';

@Injectable()
export class MatchEventsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly fixturesService: FixturesService,
  ) {}

  async create(fixtureId: string, createMatchEventDto: CreateMatchEventDto) {
    const fixture = await this.db.fixture.findUnique({
      where: { id: fixtureId },
    });

    if (!fixture) {
      throw new NotFoundException('Fixture not found');
    }

    const event = await this.db.matchEvent.create({
      data: {
        fixture_id: fixtureId,
        participant_id: createMatchEventDto.participantId,
        playerId: createMatchEventDto.playerId,
        relatedParticipant_id: createMatchEventDto.relatedParticipantId,
        relatedPlayerId: createMatchEventDto.relatedPlayerId,
        type: createMatchEventDto.type,
        minute: createMatchEventDto.minute,
        description: createMatchEventDto.description,
        metadata: createMatchEventDto.metadata ? JSON.parse(JSON.stringify(createMatchEventDto.metadata)) : undefined,
      },
      include: {
        player: true,
        participant: {
          include: {
            team: { select: { id: true, name: true } },
          },
        },
        relatedPlayer: true,
      }
    });

    // Emit live update
    this.fixturesService.liveFixturesSubject.next({ type: 'event_added', data: event });

    return ResponseUtil.success(event);
  }

  async findAllByFixture(fixtureId: string) {
    const fixture = await this.db.fixture.findUnique({
      where: { id: fixtureId },
    });

    if (!fixture) {
      throw new NotFoundException('Fixture not found');
    }

    const events = await this.db.matchEvent.findMany({
      where: { fixture_id: fixtureId },
      orderBy: { minute: 'asc' },
      include: {
        player: true,
        participant: {
          include: {
            team: { select: { id: true, name: true } },
          },
        },
        relatedPlayer: true,
      }
    });
    
    return ResponseUtil.success(events);
  }

  async findOne(id: string) {
    const event = await this.db.matchEvent.findUnique({
      where: { id },
      include: {
        player: true,
        participant: {
          include: {
            team: { select: { id: true, name: true } },
          },
        },
        relatedPlayer: true,
        fixture: true,
      }
    });

    if (!event) {
      throw new NotFoundException('Match event not found');
    }

    return ResponseUtil.success(event);
  }

  async update(id: string, updateMatchEventDto: UpdateMatchEventDto) {
    const event = await this.db.matchEvent.findUnique({ where: { id } });
    if (!event) {
      throw new NotFoundException('Match event not found');
    }

    let parsedMetadata = undefined;
    if (updateMatchEventDto.metadata !== undefined) {
      parsedMetadata = updateMatchEventDto.metadata ? JSON.parse(JSON.stringify(updateMatchEventDto.metadata)) : null;
    }

    const updatedEvent = await this.db.matchEvent.update({
      where: { id },
      data: {
        ...(updateMatchEventDto.participantId !== undefined && { participant_id: updateMatchEventDto.participantId }),
        ...(updateMatchEventDto.playerId !== undefined && { playerId: updateMatchEventDto.playerId }),
        ...(updateMatchEventDto.relatedParticipantId !== undefined && { relatedParticipant_id: updateMatchEventDto.relatedParticipantId }),
        ...(updateMatchEventDto.relatedPlayerId !== undefined && { relatedPlayerId: updateMatchEventDto.relatedPlayerId }),
        ...(updateMatchEventDto.type !== undefined && { type: updateMatchEventDto.type as any }),
        ...(updateMatchEventDto.minute !== undefined && { minute: updateMatchEventDto.minute }),
        ...(updateMatchEventDto.description !== undefined && { description: updateMatchEventDto.description }),
        ...(parsedMetadata !== undefined && { metadata: parsedMetadata }),
      },
      include: {
        player: true,
        participant: {
          include: {
            team: { select: { id: true, name: true } },
            user: { select: { id: true, name: true } },
          },
        },
        relatedPlayer: true,
      }
    });

    // Emit live update
    this.fixturesService.liveFixturesSubject.next({ type: 'event_updated', data: updatedEvent });

    return ResponseUtil.success(updatedEvent);
  }

  async remove(id: string) {
    const event = await this.db.matchEvent.findUnique({ where: { id } });
    if (!event) {
      throw new NotFoundException('Match event not found');
    }

    await this.db.matchEvent.delete({ where: { id } });
    
    // Emit live update
    this.fixturesService.liveFixturesSubject.next({ type: 'event_deleted', data: { eventId: id, fixtureId: event.fixture_id } });

    return ResponseUtil.success({ deleted: true });
  }
}
