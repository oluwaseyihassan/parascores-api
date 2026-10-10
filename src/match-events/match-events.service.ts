import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateMatchEventDto } from './dto/create-match-event.dto';
import { UpdateMatchEventDto } from './dto/update-match-event.dto';
import { DatabaseService } from 'src/database/database.service';
import { FixturesService } from 'src/fixtures/fixtures.service';
import { ResponseUtil } from 'src/utils/api-response';
import { OrganizationsService } from 'src/organizations/organizations.service';

import { NotificationsService } from 'src/notifications/notifications.service';
import { PulseService } from 'src/pulse/pulse.service';

@Injectable()
export class MatchEventsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly fixturesService: FixturesService,
    private readonly organizationsService: OrganizationsService,
    private readonly notificationsService: NotificationsService,
    private readonly pulseService: PulseService,
  ) {}

  async create(
    fixtureId: string,
    userId: string,
    createMatchEventDto: CreateMatchEventDto,
  ) {
    const fixture = await this.db.fixture.findUnique({
      where: { id: fixtureId },
      include: { tournament: true },
    });

    if (!fixture) {
      throw new NotFoundException('Fixture not found');
    }

    // Role check
    if (fixture.tournament.organization_id) {
      await this.organizationsService.validateMemberRole(
        fixture.tournament.organization_id,
        userId,
        ['OWNER', 'ADMIN', 'MEMBER'],
      );
    }

    const event = await this.db.matchEvent.create({
      data: {
        fixture_id: fixtureId,
        participant_id: createMatchEventDto.participantId || null,
        playerId: createMatchEventDto.playerId || null,
        relatedParticipant_id: createMatchEventDto.relatedParticipantId || null,
        relatedPlayerId: createMatchEventDto.relatedPlayerId || null,
        type: createMatchEventDto.type,
        half: createMatchEventDto.half,
        minute: createMatchEventDto.minute,
        description: createMatchEventDto.description,
        metadata: createMatchEventDto.metadata
          ? JSON.parse(JSON.stringify(createMatchEventDto.metadata))
          : undefined,
      },
      include: {
        player: true,
        participant: {
          include: {
            team: { select: { id: true, name: true, logoUrl: true } },
          },
        },
        relatedPlayer: true,
      },
    });

    // Emit live update
    this.fixturesService.liveFixturesSubject.next({
      type: 'event_added',
      data: event,
    });

    // Event hub pulse card (fire-and-forget; no-op for non-hub tournaments)
    this.pulseService.recordMatchEvent(fixtureId, event.id).catch(() => {});

    // Check if event should trigger a push notification
    const isNotifyType = [
      'GOAL',
      'OWN_GOAL',
      'PENALTY',
      'MISSED_PENALTY',
      'YELLOW_CARD',
      'RED_CARD',
      'SUBSTITUTION',
    ].includes(event.type);

    if (isNotifyType) {
      this.db.fixture
        .findUnique({
          where: { id: fixtureId },
          include: {
            homeTeam: { include: { team: { select: { name: true } } } },
            awayTeam: { include: { team: { select: { name: true } } } },
          },
        })
        .then((fullFixture) => {
          if (fullFixture) {
            const homeName =
              fullFixture.homeTeam?.customName ||
              fullFixture.homeTeam?.team?.name ||
              'TBD';
            const awayName =
              fullFixture.awayTeam?.customName ||
              fullFixture.awayTeam?.team?.name ||
              'TBD';

            let title = 'Match Event Update! 🔔';
            let body = '';
            const scorerName = event.player?.name || 'A player';
            const minuteText = event.minute ? ` in the ${event.minute}'` : '';
            const scoringParticipant = event.participant;
            const teamName =
              scoringParticipant?.customName ||
              scoringParticipant?.team?.name ||
              'their team';

            if (event.type === 'GOAL') {
              title = `GOAL! ${teamName} scored! ⚽`;
              body = `${scorerName} scores for ${teamName}${minuteText}. Current score: ${homeName} ${fullFixture.homeScore ?? 0} - ${fullFixture.awayScore ?? 0} ${awayName}.`;
            } else if (event.type === 'OWN_GOAL') {
              title = `Own Goal! 🤦‍♂️`;
              body = `${scorerName} scores an own goal${minuteText}. Current score: ${homeName} ${fullFixture.homeScore ?? 0} - ${fullFixture.awayScore ?? 0} ${awayName}.`;
            } else if (event.type === 'PENALTY') {
              title = `GOAL! Penalty scored! ⚽`;
              body = `${scorerName} scores a penalty for ${teamName}${minuteText}. Current score: ${homeName} ${fullFixture.homeScore ?? 0} - ${fullFixture.awayScore ?? 0} ${awayName}.`;
            } else if (event.type === 'MISSED_PENALTY') {
              title = `Penalty Missed! ❌`;
              body = `${scorerName} misses a penalty for ${teamName}${minuteText}. Current score: ${homeName} ${fullFixture.homeScore ?? 0} - ${fullFixture.awayScore ?? 0} ${awayName}.`;
            } else if (event.type === 'YELLOW_CARD') {
              title = `Yellow Card! 🟨`;
              body = `${scorerName} receives a yellow card${minuteText} for ${teamName}.`;
            } else if (event.type === 'RED_CARD') {
              title = `Red Card! 🟥`;
              body = `${scorerName} receives a red card${minuteText} for ${teamName}.`;
            } else if (event.type === 'SUBSTITUTION') {
              const playerInName = event.player?.name || 'Player In';
              const playerOutName = event.relatedPlayer?.name || 'Player Out';
              title = `Substitution! 🔄`;
              body = `Sub for ${teamName}${minuteText}: ${playerInName} replaces ${playerOutName}.`;
            }

            const url = `/t/${fullFixture.tournament_id}/fixture/${fullFixture.id}`;
            // Fallback chain: player avatar → participant logo → team logo
            const notificationIcon =
              event.player?.avatarUrl ||
              event.participant?.logoUrl ||
              event.participant?.team?.logoUrl ||
              undefined;
            this.notificationsService
              .sendNotificationToTournamentFollowers(
                fullFixture.tournament_id,
                title,
                body,
                url,
                `fixture-${fullFixture.id}-event-${event.id}`,
                notificationIcon,
              )
              .catch(() => {});
          }
        })
        .catch((err) => {
          console.error(
            'Error fetching fixture details for push notification:',
            err,
          );
        });
    }

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
      },
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
      },
    });

    if (!event) {
      throw new NotFoundException('Match event not found');
    }

    return ResponseUtil.success(event);
  }

  async update(
    id: string,
    userId: string,
    updateMatchEventDto: UpdateMatchEventDto,
  ) {
    const event = await this.db.matchEvent.findUnique({
      where: { id },
      include: { fixture: { include: { tournament: true } } },
    });
    if (!event) {
      throw new NotFoundException('Match event not found');
    }

    // Role check
    if (event.fixture.tournament.organization_id) {
      await this.organizationsService.validateMemberRole(
        event.fixture.tournament.organization_id,
        userId,
        ['OWNER', 'ADMIN', 'MEMBER'],
      );
    }

    let parsedMetadata = undefined;
    if (updateMatchEventDto.metadata !== undefined) {
      parsedMetadata = updateMatchEventDto.metadata
        ? JSON.parse(JSON.stringify(updateMatchEventDto.metadata))
        : null;
    }

    const updatedEvent = await this.db.matchEvent.update({
      where: { id },
      data: {
        ...(updateMatchEventDto.participantId !== undefined && {
          participant_id: updateMatchEventDto.participantId || null,
        }),
        ...(updateMatchEventDto.playerId !== undefined && {
          playerId: updateMatchEventDto.playerId || null,
        }),
        ...(updateMatchEventDto.relatedParticipantId !== undefined && {
          relatedParticipant_id:
            updateMatchEventDto.relatedParticipantId || null,
        }),
        ...(updateMatchEventDto.relatedPlayerId !== undefined && {
          relatedPlayerId: updateMatchEventDto.relatedPlayerId || null,
        }),
        ...(updateMatchEventDto.type !== undefined && {
          type: updateMatchEventDto.type as any,
        }),
        ...(updateMatchEventDto.half !== undefined && {
          half: updateMatchEventDto.half,
        }),
        ...(updateMatchEventDto.minute !== undefined && {
          minute: updateMatchEventDto.minute,
        }),
        ...(updateMatchEventDto.description !== undefined && {
          description: updateMatchEventDto.description,
        }),
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
      },
    });

    // Emit live update
    this.fixturesService.liveFixturesSubject.next({
      type: 'event_updated',
      data: updatedEvent,
    });

    return ResponseUtil.success(updatedEvent);
  }

  async remove(id: string, userId: string) {
    const event = await this.db.matchEvent.findUnique({
      where: { id },
      include: { fixture: { include: { tournament: true } } },
    });
    if (!event) {
      throw new NotFoundException('Match event not found');
    }

    // Role check
    if (event.fixture.tournament.organization_id) {
      await this.organizationsService.validateMemberRole(
        event.fixture.tournament.organization_id,
        userId,
        ['OWNER', 'ADMIN', 'MEMBER'],
      );
    }

    await this.db.matchEvent.delete({ where: { id } });

    // Emit live update
    this.fixturesService.liveFixturesSubject.next({
      type: 'event_deleted',
      data: { eventId: id, fixtureId: event.fixture_id },
    });

    return ResponseUtil.success({ deleted: true });
  }
}
