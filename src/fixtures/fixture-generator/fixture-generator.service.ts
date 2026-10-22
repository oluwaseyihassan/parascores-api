import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import { GenerateFixturesDto } from 'src/fixtures/dto/generate-fixtures.dto';
import { AdvanceGroupStageDto } from 'src/fixtures/dto/advance-group-stage.dto';
import { GenerateKnockoutPlaceholdersDto } from 'src/fixtures/dto/generate-knockout-placeholders.dto';
import {
  Fixture,
  Participant,
  Tournament,
  Group,
  FixtureStage,
  FixtureStatus,
  TournamentType,
} from 'prisma/generated/client';
import { ResponseUtil } from 'src/utils/api-response';
import { RedisService } from 'src/redis/redis.service';
import * as crypto from 'crypto';

@Injectable()
export class FixtureGeneratorService {
  constructor(private readonly db: DatabaseService, private readonly redisService: RedisService) {}

  // Generate fixtures for a tournament
  async generateFixtures(
    tournamentId: string,
    dto: GenerateFixturesDto,
    userId: string,
  ) {
    const tournament = await this.db.tournament.findFirst({
      where: { OR: [{ id: tournamentId }, { customName: tournamentId }] },
      include: {
        participants: {
          where: { status: 'CONFIRMED' },
          orderBy: { seed: 'asc' },
        },
        organization: {
          include: {
            members: {
              where: { userId },
            },
          },
        },
        fixtures: true,
        groups: true,
      },
    });

    if (!tournament) {
      throw new NotFoundException('Tournament not found');
    }

    // Authorization check
    const membership = tournament.organization?.members[0];
    const isAuthorized =
      membership &&
      (membership.role === 'OWNER' || membership.role === 'ADMIN');

    if (!isAuthorized) {
      throw new ForbiddenException(
        'You are not authorized to generate fixtures for this tournament',
      );
    }

    // Check if fixtures already exist
    if (tournament.fixtures.length > 0 && !dto.clearExisting) {
      throw new BadRequestException(
        'Fixtures already exist. Set clearExisting to true to regenerate.',
      );
    }

    // Clear existing fixtures if requested
    if (
      dto.clearExisting &&
      (tournament.fixtures.length > 0 || tournament.groups.length > 0)
    ) {
      await this.db.fixture.deleteMany({
        where: { tournament_id: tournament.id },
      });
      await this.db.standing.deleteMany({
        where: { tournament_id: tournament.id },
      });
      if (!dto.useExistingGroups) {
        await this.db.group.deleteMany({
          where: { tournament_id: tournament.id },
        });
      }
    }

    let participants = [...tournament.participants];

    // Validate minimum participants
    const minParticipants =
      tournament.type === TournamentType.KNOCKOUT ||
      tournament.type === TournamentType.FRIENDLY ||
      tournament.type === TournamentType.RACE
        ? 2
        : 3;
    if (participants.length < minParticipants) {
      throw new BadRequestException(
        `At least ${minParticipants} confirmed participants are required for ${tournament.type} tournament`,
      );
    }

    // Shuffle participants if requested
    if (dto.shuffleParticipants) {
      participants = this.shuffleArray(participants);
    }

    const isDoubleRoundRobin =
      dto.doubleRoundRobin !== undefined
        ? dto.doubleRoundRobin
        : !!(tournament as any).doubleRoundRobin;

    if (
      dto.doubleRoundRobin !== undefined &&
      dto.doubleRoundRobin !== (tournament as any).doubleRoundRobin
    ) {
      await this.db.tournament.update({
        where: { id: tournament.id },
        data: { doubleRoundRobin: dto.doubleRoundRobin },
      });
      (tournament as any).doubleRoundRobin = dto.doubleRoundRobin;
    }

    const options = {
      startDate: dto.startDate
        ? new Date(dto.startDate)
        : new Date(tournament.start_date),
      intervalMinutes: dto.intervalMinutes ?? 90,
      doubleRoundRobin: isDoubleRoundRobin,
    };

    let rounds: { round: number; roundName: string; fixtures: Fixture[] }[];

    switch (tournament.type) {
      case TournamentType.KNOCKOUT:
        // Check for manual knockout assignments
        let seededKnockoutParticipants: (Participant | null)[] | null = null;
        if (dto.groupAssignments?.knockout) {
          const orderedIds = dto.groupAssignments.knockout;
          // Map provided IDs back to participant objects, preserving nulls/empty strings as Byes
          seededKnockoutParticipants = orderedIds.map((id) => {
            if (!id) return null;
            return participants.find((p) => p.id === id) || null;
          });
        }

        rounds = await this.generateKnockoutFixtures(
          tournament,
          seededKnockoutParticipants || participants,
          options,
        );
        break;
      case TournamentType.LEAGUE:
      case TournamentType.ROUND_ROBIN:
        rounds = await this.generateRoundRobinFixtures(
          tournament,
          participants,
          {
            ...options,
            doubleRoundRobin: isDoubleRoundRobin,
          },
        );
        break;
      case TournamentType.FRIENDLY:
        rounds = await this.generateFriendlyFixtures(
          tournament,
          participants,
          options,
        );
        break;
      case TournamentType.RACE:
        rounds = await this.generateRaceFixtures(tournament);
        break;
      case TournamentType.HYBRID:
      case TournamentType.GROUP:
        let numGroups = dto.numberOfGroups ?? tournament.numberOfGroups;
        const teamsPerGroup = dto.teamsPerGroup ?? tournament.teamsPerGroup;

        if (!numGroups && teamsPerGroup) {
          numGroups = Math.ceil(participants.length / teamsPerGroup);
        }

        // If manual group assignments are provided, derive numGroups from keys
        if (
          dto.groupAssignments &&
          Object.keys(dto.groupAssignments).length > 0
        ) {
          numGroups = Object.keys(dto.groupAssignments).length;
        }

        const validNumGroups = numGroups ?? 4;

        // Only enforce even distribution if NOT using manual assignments or existing groups
        if (
          !dto.groupAssignments &&
          !dto.useExistingGroups &&
          participants.length % validNumGroups !== 0
        ) {
          throw new BadRequestException(
            `Cannot evenly distribute ${participants.length} teams into ${validNumGroups} groups. Please adjust the number of groups or teams.`,
          );
        }

        const isUnified =
          dto.unifiedStandings !== undefined
            ? dto.unifiedStandings
            : !!(tournament as any).unifiedStandings;

        if (
          dto.unifiedStandings !== undefined &&
          dto.unifiedStandings !== (tournament as any).unifiedStandings
        ) {
          await this.db.tournament.update({
            where: { id: tournament.id },
            data: { unifiedStandings: dto.unifiedStandings },
          });
          (tournament as any).unifiedStandings = dto.unifiedStandings;
        }

        const hasPlayoffs =
          dto.hasKnockoutPlayoffs !== undefined
            ? dto.hasKnockoutPlayoffs
            : !!(tournament as any).hasKnockoutPlayoffs;

        if (
          dto.hasKnockoutPlayoffs !== undefined &&
          dto.hasKnockoutPlayoffs !== (tournament as any).hasKnockoutPlayoffs
        ) {
          await this.db.tournament.update({
            where: { id: tournament.id },
            data: { hasKnockoutPlayoffs: dto.hasKnockoutPlayoffs },
          });
          (tournament as any).hasKnockoutPlayoffs = dto.hasKnockoutPlayoffs;
        }

        const isChampionsLeague =
          dto.format === 'CHAMPIONS_LEAGUE' || dto.format === 'SWISS';

        if (isChampionsLeague) {
          rounds = await this.generateChampionsLeagueFixtures(
            tournament,
            participants,
            {
              ...options,
              numberOfPots: validNumGroups,
              matchesPerPot: dto.matchesPerPot ?? 2,
              groupAssignments: dto.groupAssignments,
              useExistingGroups: dto.useExistingGroups,
            },
          );
        } else {
          rounds = await this.generateGroupStageFixtures(
            tournament,
            participants,
            {
              ...options,
              numberOfGroups: validNumGroups,
              groupAssignments: dto.groupAssignments,
              useExistingGroups: dto.useExistingGroups,
              doubleRoundRobin: isDoubleRoundRobin,
            },
          );
        }

        if (
          tournament.type === TournamentType.HYBRID &&
          dto.generateKnockoutStage
        ) {
          const knockoutRounds =
            await this.generateHybridKnockoutPlaceholders(
              tournament,
              {
                numberOfGroups: validNumGroups,
                advancingPerGroup: dto.advancingPerGroup ?? 2,
                hasThirdPlace:
                  dto.hasThirdPlace ?? tournament.thirdPlaceMatch ?? false,
                startDate: options.startDate,
                intervalMinutes: options.intervalMinutes,
                knockoutMatchups: dto.knockoutMatchups,
                isUnifiedStandings: isUnified,
                hasKnockoutPlayoffs: hasPlayoffs,
              },
            );
          rounds.push(...knockoutRounds);
        }
        break;
      default:
        throw new BadRequestException(
          `Unsupported tournament type: ${tournament.type}`,
        );
    }

    // Initialize standings for non-knockout, non-friendly, non-race tournaments
    if (
      tournament.type !== TournamentType.KNOCKOUT &&
      tournament.type !== TournamentType.FRIENDLY &&
      tournament.type !== TournamentType.RACE
    ) {
      await this.initializeStandings(tournament);
    }

    await this.redisService.del(`standings:${tournament.id}`);
    if (tournament.customName) await this.redisService.del(`standings:${tournament.customName}`);
    const totalFixtures = rounds.reduce((sum, r) => sum + r.fixtures.length, 0);

    // Re-fetch everything with full relations to ensure frontend get all info (teams, groups, etc)
    const freshFixturesResponse = await this.db.fixture.findMany({
      where: { tournament_id: tournament.id },
      include: {
        homeTeam: {
          include: {
            user: { select: { id: true, name: true } },
            team: { select: { id: true, name: true } },
          },
        },
        awayTeam: {
          include: {
            user: { select: { id: true, name: true } },
            team: { select: { id: true, name: true } },
          },
        },
        group: true,
      },
      orderBy: [{ round: 'asc' }, { matchNumber: 'asc' }],
    });

    // Rebuild rounds structure with fresh data
    const freshRounds: { round: number; roundName: string; fixtures: any[] }[] =
      [];
    const groupedByRound: Record<number, any[]> = {};
    const roundNamesMap: Record<number, string> = {};

    freshFixturesResponse.forEach((f: any) => {
      if (!groupedByRound[f.round]) groupedByRound[f.round] = [];
      groupedByRound[f.round].push(f);
      if (!roundNamesMap[f.round]) {
        roundNamesMap[f.round] = f.roundName || `Round ${f.round}`;
      }
    });

    Object.keys(groupedByRound)
      .sort((a, b) => Number(a) - Number(b))
      .forEach((rNum) => {
        const n = Number(rNum);
        freshRounds.push({
          round: n,
          roundName: roundNamesMap[n],
          fixtures: groupedByRound[n],
        });
      });

    return ResponseUtil.success({
      message: `Generated ${totalFixtures} fixtures for ${tournament.type} tournament`,
      rounds: freshRounds,
    });
  }

  // Advance group stage to knockout
  async advanceGroupStage(
    tournamentId: string,
    userId: string,
    dto: AdvanceGroupStageDto,
  ) {
    const tournament = await this.db.tournament.findFirst({
      where: { OR: [{ id: tournamentId }, { customName: tournamentId }] },
      include: {
        participants: {
          include: {
            user: true,
            team: true,
          },
        },
        fixtures: {
          include: {
            homeTeam: true,
            awayTeam: true,
          },
        },
        groups: {
          include: {
            participants: true,
          },
        },
        organization: {
          include: {
            members: {
              where: { userId },
            },
          },
        },
      },
    });

    if (!tournament) {
      throw new NotFoundException('Tournament not found');
    }

    // Authorization check
    const membership = tournament.organization?.members[0];
    const isAuthorized =
      membership &&
      (membership.role === 'OWNER' || membership.role === 'ADMIN');

    if (!isAuthorized) {
      throw new ForbiddenException(
        'You are not authorized to advance group stage for this tournament',
      );
    }

    if (
      tournament.type !== TournamentType.HYBRID &&
      tournament.type !== TournamentType.GROUP
    ) {
      throw new BadRequestException(
        'Only Hybrid or Group tournaments can manually advance',
      );
    }

    // 1. Verify Group Stage Completion
    // For HYBRID, we assume the first set of fixtures are group stage.
    const groupFixtures = tournament.fixtures.filter(
      (f) => f.stage === FixtureStage.GROUP_STAGE,
    );

    if (groupFixtures.length === 0) {
      throw new BadRequestException(
        'No group stage fixtures found. Generate fixtures first.',
      );
    }

    // Calculate expected minimum matches (Single Round Robin)
    let expectedMinMatches = 0;
    for (const group of tournament.groups) {
      const n = group.participants.length;
      if (n >= 2) {
        expectedMinMatches += (n * (n - 1)) / 2;
      }
    }

    if (!(tournament as any).unifiedStandings && groupFixtures.length < expectedMinMatches) {
      throw new BadRequestException(
        `Group stage is incomplete. Expected at least ${expectedMinMatches} matches (Single Round Robin), but found ${groupFixtures.length}.`,
      );
    }

    const uncompleted = groupFixtures.filter((f) => f.status !== 'COMPLETED');
    if (uncompleted.length > 0) {
      throw new BadRequestException(
        `Group stage not finished. ${uncompleted.length} matches remaining.`,
      );
      // For testing purposes or manual override, maybe we allow it?
    }

    let qualifiedParticipants: Participant[] = [];

    const standings = await this.db.standing.findMany({
      where: { tournament_id: tournament.id },
      orderBy: [
        { points: 'desc' },
        { goalDiff: 'desc' },
        { goalsFor: 'desc' },
      ],
    });

    if (dto.qualifiedParticipantIds && dto.qualifiedParticipantIds.length > 0) {
      // Manual selection
      qualifiedParticipants = tournament.participants.filter((p) =>
        dto.qualifiedParticipantIds?.includes(p.id),
      );
      if (qualifiedParticipants.length !== dto.qualifiedParticipantIds.length) {
        throw new BadRequestException(
          'One or more qualified participant IDs are invalid for this tournament',
        );
      }
    } else if ((tournament as any).unifiedStandings) {
      // For unified standings (Champions League / Swiss), advance top qualifiers globally
      const hasPlayoffs = !!(tournament as any).hasKnockoutPlayoffs;
      let totalQualifiers = 16;
      if (hasPlayoffs) {
        if (standings.length >= 24) totalQualifiers = 24;
        else if (standings.length >= 12) totalQualifiers = 12;
        else totalQualifiers = 6;
      } else {
        totalQualifiers = tournament.groups.length > 0 ? tournament.groups.length * 2 : 8;
      }
      const topStandings = standings.slice(0, Math.min(totalQualifiers, standings.length));
      for (const s of topStandings) {
        const p = tournament.participants.find(
          (part) => part.id === s.participant_id,
        );
        if (p) qualifiedParticipants.push(p);
      }
    } else {

      // Group them
      const groups = tournament.groups;
      for (const group of groups) {
        const groupStandings = standings
          .filter((s) => {
            // We need to know which participant belongs to which group.
            // The Standings model has 'group' string, or we use participant.groupId
            const p = tournament.participants.find(
              (p) => p.id === s.participant_id,
            );
            return p && p.groupId === group.id;
          })
          .sort((a, b) => {
            if (a.points !== b.points) return b.points - a.points;
            if (a.goalDiff !== b.goalDiff) return b.goalDiff - a.goalDiff;
            return b.goalsFor - a.goalsFor;
          });

        // Take top 2
        const top2 = groupStandings.slice(0, 2);
        for (const s of top2) {
          const p = tournament.participants.find(
            (p) => p.id === s.participant_id,
          );
          if (p) qualifiedParticipants.push(p);
        }
      }
    }

    // Now generate Knockout Bracket with these participants
    if (qualifiedParticipants.length < 2) {
      throw new BadRequestException(
        'Not enough qualified participants for a knockout stage (min 2)',
      );
    }

    let knockoutParticipants: (Participant | null)[] = qualifiedParticipants;
    if (dto.manualSeeding && dto.manualSeeding.length > 0) {
      knockoutParticipants = dto.manualSeeding.map((id) => {
        if (!id) return null;
        return tournament.participants.find((p) => p.id === id) || null;
      });
    }

    // Check if knockout placeholder fixtures already exist (pre-generated during hybrid setup)
    const existingKnockoutFixtures = tournament.fixtures.filter(
      (f) => f.stage === FixtureStage.KNOCKOUT,
    );

    const findParticipantByPlaceholder = (placeholder?: string | null) => {
        if (!placeholder) return null;

        // Check for Seed N or Nth Place (League)
        const seedMatch = placeholder.match(/(?:Seed|Rank|(\d+)(?:st|nd|rd|th)?\s+Place\s*\(League\))\s*(\d+)?/i);
        if (seedMatch) {
          const rank = parseInt(seedMatch[2] || seedMatch[1], 10);
          const targetStanding = standings[rank - 1];
          if (targetStanding) {
            return tournament.participants.find((p: any) => p.id === targetStanding.participant_id) || null;
          }
        }

        const match = placeholder.match(/(Winner|Runner-up|1st|2nd|3rd|4th)(\s+Place)?\s+Group\s+([A-Z])/i);
        if (!match) return null;
        const rankStr = match[1].toLowerCase();
        const groupLetter = match[3].toUpperCase();
        const group = tournament.groups.find((g: any) =>
          g.name.toUpperCase().endsWith(groupLetter) || g.name.toUpperCase() === `GROUP ${groupLetter}`
        );
        if (!group) return null;
        let rank = 1;
        if (rankStr === 'winner' || rankStr === '1st') rank = 1;
        else if (rankStr === 'runner-up' || rankStr === '2nd') rank = 2;
        else if (rankStr === '3rd') rank = 3;
        else if (rankStr === '4th') rank = 4;

        const groupStandings = standings
          .filter((s: any) => {
            const p = tournament.participants.find((p: any) => p.id === s.participant_id);
            return p && p.groupId === group.id;
          })
          .sort((a: any, b: any) => {
            if (a.points !== b.points) return b.points - a.points;
            if (a.goalDiff !== b.goalDiff) return b.goalDiff - a.goalDiff;
            return b.goalsFor - a.goalsFor;
          });
        const targetStanding = groupStandings[rank - 1];
        if (!targetStanding) return null;
        return tournament.participants.find((p: any) => p.id === targetStanding.participant_id) || null;
      };

    if (existingKnockoutFixtures.length > 0) {
      // Populate any knockout fixture whose placeholders match seeds or groups
      for (const fixture of existingKnockoutFixtures) {
        let home: any = findParticipantByPlaceholder(fixture.homeTeamPlaceholder);
        let away: any = findParticipantByPlaceholder(fixture.awayTeamPlaceholder);

        if (fixture.round === 1 && dto.manualSeeding && dto.manualSeeding.length > 0) {
          const idx = fixture.matchNumber - 1;
          home = knockoutParticipants[idx * 2] || home;
          away = knockoutParticipants[idx * 2 + 1] || away;
        }

        if (home || away) {
          await this.db.fixture.update({
            where: { id: fixture.id },
            data: {
              ...(home ? { homeTeamId: home.id, homeTeamPlaceholder: null } : {}),
              ...(away ? { awayTeamId: away.id, awayTeamPlaceholder: null } : {}),
            },
          });

          // If two-legged and this is Leg 1, mirror to Leg 2
          if (tournament.twoLegsKnockout && fixture.roundName?.includes('Leg 1')) {
            const leg2 = existingKnockoutFixtures.find(
              (f) =>
                f.round === fixture.round &&
                f.matchNumber === fixture.matchNumber + 1 &&
                f.roundName?.includes('Leg 2'),
            );
            if (leg2) {
              await this.db.fixture.update({
                where: { id: leg2.id },
                data: {
                  ...(home ? { awayTeamId: home.id, awayTeamPlaceholder: null } : {}),
                  ...(away ? { homeTeamId: away.id, homeTeamPlaceholder: null } : {}),
                },
              });
            }
          }
        }
      }
    } else {
      if ((tournament as any).unifiedStandings && (tournament as any).hasKnockoutPlayoffs) {
        await this.generateHybridKnockoutPlaceholders(
          tournament,
          {
            numberOfGroups: tournament.groups.length || 1,
            advancingPerGroup: Math.max(2, Math.floor(knockoutParticipants.length / (tournament.groups.length || 1))),
            hasThirdPlace: tournament.thirdPlaceMatch ?? false,
            startDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
            intervalMinutes: 120,
            isUnifiedStandings: true,
            hasKnockoutPlayoffs: true,
          },
        );

        const newKnockoutFixtures = await this.db.fixture.findMany({
          where: { tournament_id: tournament.id, stage: FixtureStage.KNOCKOUT },
        });

        for (const fixture of newKnockoutFixtures) {
          let home: any = findParticipantByPlaceholder(fixture.homeTeamPlaceholder);
          let away: any = findParticipantByPlaceholder(fixture.awayTeamPlaceholder);

          if (home || away) {
            await this.db.fixture.update({
              where: { id: fixture.id },
              data: {
                ...(home ? { homeTeamId: home.id, homeTeamPlaceholder: null } : {}),
                ...(away ? { awayTeamId: away.id, awayTeamPlaceholder: null } : {}),
              },
            });

            if (tournament.twoLegsKnockout && fixture.roundName?.includes('Leg 1')) {
              const leg2 = newKnockoutFixtures.find(
                (f) =>
                  f.round === fixture.round &&
                  f.matchNumber === fixture.matchNumber + 1 &&
                  f.roundName?.includes('Leg 2'),
              );
              if (leg2) {
                await this.db.fixture.update({
                  where: { id: leg2.id },
                  data: {
                    ...(home ? { awayTeamId: home.id, awayTeamPlaceholder: null } : {}),
                    ...(away ? { homeTeamId: away.id, homeTeamPlaceholder: null } : {}),
                  },
                });
              }
            }
          }
        }
      } else {
        await this.generateKnockoutFixtures(tournament, knockoutParticipants, {
          startDate: new Date(Date.now() + 24 * 60 * 60 * 1000), // Start tomorrow? Or use end of group stage?
          intervalMinutes: 120, // Standard knockout time
          stage: FixtureStage.KNOCKOUT,
        });
      }
    }

    // Re-fetch everything with full relations to ensure frontend get all info (teams, groups, etc)
    const freshFixturesResponse = await this.db.fixture.findMany({
      where: { tournament_id: tournament.id },
      include: {
        homeTeam: {
          include: {
            user: { select: { id: true, name: true } },
            team: { select: { id: true, name: true } },
          },
        },
        awayTeam: {
          include: {
            user: { select: { id: true, name: true } },
            team: { select: { id: true, name: true } },
          },
        },
        group: true,
      },
      orderBy: [{ round: 'asc' }, { matchNumber: 'asc' }],
    });

    // Rebuild rounds structure with fresh data
    const freshRounds: { round: number; roundName: string; fixtures: any[] }[] =
      [];
    const groupedByRound: Record<number, any[]> = {};
    const roundNamesMap: Record<number, string> = {};

    freshFixturesResponse.forEach((f: any) => {
      if (!groupedByRound[f.round]) groupedByRound[f.round] = [];
      groupedByRound[f.round].push(f);
      if (!roundNamesMap[f.round]) {
        roundNamesMap[f.round] = f.roundName || `Round ${f.round}`;
      }
    });

    Object.keys(groupedByRound)
      .sort((a, b) => Number(a) - Number(b))
      .forEach((rNum) => {
        const n = Number(rNum);
        freshRounds.push({
          round: n,
          roundName: roundNamesMap[n],
          fixtures: groupedByRound[n],
        });
      });

    return ResponseUtil.success({
      message: `Advanced to knockout stage. Generated ${freshFixturesResponse.length} fixtures total with ${qualifiedParticipants.length} qualifiers.`,
      qualifiers: qualifiedParticipants.map((p: any) => ({
        id: p.id,
        name: p.customName || p.user?.name || p.team?.name,
      })),
      rounds: freshRounds,
    });
  }

  // Generate knockout stage placeholders (for hybrid tournaments or manual setups)
  async generateKnockoutPlaceholders(
    tournamentId: string,
    userId: string,
    dto: GenerateKnockoutPlaceholdersDto,
  ) {
    const tournament = await this.db.tournament.findFirst({
      where: { OR: [{ id: tournamentId }, { customName: tournamentId }] },
      include: {
        organization: {
          include: {
            members: {
              where: { userId },
            },
          },
        },
        participants: {
          where: { status: 'CONFIRMED' },
        },
        groups: true,
      },
    });

    if (!tournament) {
      throw new NotFoundException('Tournament not found');
    }

    const membership = tournament.organization?.members[0];
    const isAuthorized =
      membership &&
      (membership.role === 'OWNER' || membership.role === 'ADMIN');

    if (!isAuthorized) {
      throw new ForbiddenException(
        'You are not authorized to generate fixtures for this tournament',
      );
    }

    if (
      tournament.type !== TournamentType.HYBRID &&
      tournament.type !== TournamentType.GROUP
    ) {
      throw new BadRequestException(
        'Knockout placeholders can only be generated for Hybrid or Group tournaments',
      );
    }

    // Sync tournament settings if provided
    if (
      dto.unifiedStandings !== undefined &&
      dto.unifiedStandings !== (tournament as any).unifiedStandings
    ) {
      await this.db.tournament.update({
        where: { id: tournament.id },
        data: { unifiedStandings: dto.unifiedStandings },
      });
      (tournament as any).unifiedStandings = dto.unifiedStandings;
    }

    if (
      dto.hasKnockoutPlayoffs !== undefined &&
      dto.hasKnockoutPlayoffs !== (tournament as any).hasKnockoutPlayoffs
    ) {
      await this.db.tournament.update({
        where: { id: tournament.id },
        data: { hasKnockoutPlayoffs: dto.hasKnockoutPlayoffs },
      });
      (tournament as any).hasKnockoutPlayoffs = dto.hasKnockoutPlayoffs;
    }

    // Optional: sync group assignments and standings if provided
    if (dto.groupAssignments && Object.keys(dto.groupAssignments).length > 0) {
      const assignmentLabels = Object.keys(dto.groupAssignments);
      const existingGroups = await this.db.group.findMany({
        where: { tournament_id: tournament.id },
      });

      const groupMap = new Map<string, any>();
      for (const group of existingGroups) {
        groupMap.set(group.name, group);
      }

      for (const name of assignmentLabels) {
        if (!groupMap.has(name)) {
          const newGroup = await this.db.group.create({
            data: { name, tournament_id: tournament.id },
          });
          groupMap.set(name, newGroup);
        }
      }

      for (const [groupName, participantIds] of Object.entries(
        dto.groupAssignments,
      )) {
        const group = groupMap.get(groupName);
        if (group && Array.isArray(participantIds) && participantIds.length > 0) {
          await this.db.participant.updateMany({
            where: {
              id: { in: participantIds },
              tournament_id: tournament.id,
            },
            data: { groupId: group.id },
          });
        }
      }

      await this.initializeStandings(tournament);
      await this.redisService.del(`standings:${tournament.id}`);
      if (tournament.customName) {
        await this.redisService.del(`standings:${tournament.customName}`);
      }
    }

    // Delete any existing knockout stage fixtures
    await this.db.fixture.deleteMany({
      where: {
        tournament_id: tournament.id,
        stage: FixtureStage.KNOCKOUT,
      },
    });

    const isUnified =
      dto.unifiedStandings !== undefined
        ? dto.unifiedStandings
        : !!(tournament as any).unifiedStandings;

    const hasPlayoffs =
      dto.hasKnockoutPlayoffs !== undefined
        ? dto.hasKnockoutPlayoffs
        : !!(tournament as any).hasKnockoutPlayoffs;

    const startDate = dto.startDate
      ? new Date(dto.startDate)
      : new Date(tournament.start_date || Date.now());
    const intervalMinutes = dto.intervalMinutes ?? 90;

    const validNumGroups =
      dto.numberOfGroups ??
      ((dto.groupAssignments ? Object.keys(dto.groupAssignments).length : 0) ||
        tournament.groups.length ||
        2);

    const knockoutRounds = await this.generateHybridKnockoutPlaceholders(
      tournament,
      {
        numberOfGroups: validNumGroups,
        advancingPerGroup: dto.advancingPerGroup ?? 2,
        hasThirdPlace:
          dto.hasThirdPlace ?? tournament.thirdPlaceMatch ?? false,
        startDate,
        intervalMinutes,
        knockoutMatchups: dto.knockoutMatchups,
        isUnifiedStandings: isUnified,
        hasKnockoutPlayoffs: hasPlayoffs,
      },
    );

    // Invalidate caches
    await this.redisService.delPattern(`fixtures:tournament:${tournament.id}:*`);
    if (tournament.customName) {
      await this.redisService.delPattern(
        `fixtures:tournament:${tournament.customName}:*`,
      );
    }
    await this.redisService.del('fixtures:live');
    await this.redisService.delPattern('fixtures:live:org:*');

    // Fetch fresh knockout fixtures with full relations
    const freshKnockoutFixtures = await this.db.fixture.findMany({
      where: {
        tournament_id: tournament.id,
        stage: FixtureStage.KNOCKOUT,
      },
      include: {
        homeTeam: {
          include: {
            user: { select: { id: true, name: true } },
            team: { select: { id: true, name: true } },
          },
        },
        awayTeam: {
          include: {
            user: { select: { id: true, name: true } },
            team: { select: { id: true, name: true } },
          },
        },
        group: true,
      },
      orderBy: [{ round: 'asc' }, { matchNumber: 'asc' }],
    });

    return ResponseUtil.success({
      message: 'Knockout stage fixtures generated successfully',
      rounds: knockoutRounds,
      fixtures: freshKnockoutFixtures,
    });
  }

  // Knockout bracket generation - returns fixtures grouped by rounds
  private async generateKnockoutFixtures(
    tournament: Tournament,
    participants: (Participant | null)[],
    options: { startDate: Date; intervalMinutes: number; stage?: FixtureStage },
  ) {
    const rounds: {
      round: number;
      roundName: string;
      fixtures: Fixture[];
      bracketFixtures?: Fixture[];
    }[] = [];

    // Calculate number of rounds needed based on actual participant count or provided seeds
    const n = participants.length;
    const totalRounds = Math.ceil(Math.log2(n));
    const perfectBracketSize = Math.pow(2, totalRounds);

    // If participants are already seeded (fixed length power of 2), use them directly
    // Otherwise, apply standard bracket seeding (1v8, 4v5 pattern)
    let seededParticipants: (Participant | null)[] = [];
    if (participants.length === perfectBracketSize) {
      seededParticipants = participants;
    } else {
      // Need to filter out any nulls before seeding to avoid duplicates
      const cleanParticipants = participants.filter((p) => !!p);
      seededParticipants = this.seedBracket(
        cleanParticipants,
        perfectBracketSize,
      );
    }

    let currentTime = new Date(options.startDate);

    // Track matches per round to create proper bracket structure
    let matchesInCurrentRound = perfectBracketSize / 2;
    const fixturesToInsert: any[] = [];

    for (let round = 1; round <= totalRounds; round++) {
      const roundName = this.getKnockoutRoundName(
        round,
        totalRounds,
        perfectBracketSize,
      );
      const prevRoundName =
        round > 1
          ? this.getKnockoutRoundName(
              round - 1,
              totalRounds,
              perfectBracketSize,
            )
          : null;
      const prevRoundAbbrev = prevRoundName
        ? this.getRoundAbbreviation(prevRoundName)
        : null;
      const bracketFixtures: Fixture[] = [];
      const allRoundFixtures: Fixture[] = [];

      let roundMatchNumber = 1; // Reset match ID counter for each round for clean labeling

      for (
        let matchIndex = 0;
        matchIndex < matchesInCurrentRound;
        matchIndex++
      ) {
        // For round 1, assign actual participants; for future rounds, leave as TBD (null)
        let homeTeamId: string | null = null;
        let awayTeamId: string | null = null;
        let homeTeamPlaceholder: string | null = null;
        let awayTeamPlaceholder: string | null = null;

        if (round === 1) {
          const home = seededParticipants[matchIndex * 2];
          const away = seededParticipants[matchIndex * 2 + 1];
          homeTeamId = home?.id ?? null;
          awayTeamId = away?.id ?? null;

          // Skip only if BOTH are null (double bye - shouldn't happen with proper seeding)
          if (home === null && away === null) continue;
        } else {
          // For subsequent rounds, add placeholder labels
          const prevMatch1 = matchIndex * 2 + 1;
          const prevMatch2 = matchIndex * 2 + 2;

          homeTeamPlaceholder = `${prevRoundAbbrev}(${prevMatch1}) Winner`;
          awayTeamPlaceholder = `${prevRoundAbbrev}(${prevMatch2}) Winner`;
        }

        const isTwoLegs = tournament.twoLegsKnockout && round < totalRounds;

        const fixtureData = {
          id: crypto.randomUUID(),
          tournament_id: tournament.id,
          round,
          roundName: isTwoLegs ? `${roundName} - Leg 1` : roundName,
          matchNumber: roundMatchNumber++,
          startTime: null,
          homeTeamId,
          awayTeamId,
          homeTeamPlaceholder,
          awayTeamPlaceholder,
          status: 'SCHEDULED',
          ...(options.stage && { stage: options.stage }),
        };

        bracketFixtures.push(fixtureData as unknown as Fixture);
        allRoundFixtures.push(fixtureData as unknown as Fixture);
        fixturesToInsert.push(fixtureData);

        currentTime = new Date(
          currentTime.getTime() + options.intervalMinutes * 60 * 1000,
        );

        if (isTwoLegs) {
          const leg2Data = {
            id: crypto.randomUUID(),
            tournament_id: tournament.id,
            round,
            roundName: `${roundName} - Leg 2`,
            matchNumber: roundMatchNumber++,
            startTime: null,
            homeTeamId: awayTeamId,
            awayTeamId: homeTeamId,
            homeTeamPlaceholder: awayTeamPlaceholder,
            awayTeamPlaceholder: homeTeamPlaceholder,
            status: 'SCHEDULED',
            ...(options.stage && { stage: options.stage }),
          };
          allRoundFixtures.push(leg2Data as unknown as Fixture);
          fixturesToInsert.push(leg2Data);
          currentTime = new Date(
            currentTime.getTime() + options.intervalMinutes * 60 * 1000,
          );
        }
      }

      if (round === totalRounds && tournament.thirdPlaceMatch) {
        const thirdPlaceData = {
          id: crypto.randomUUID(),
          tournament_id: tournament.id,
          round,
          roundName: 'Third Place Match',
          matchNumber: roundMatchNumber++,
          startTime: null,
          homeTeamPlaceholder: 'SF1 Loser',
          awayTeamPlaceholder: 'SF2 Loser',
          status: 'SCHEDULED',
          ...(options.stage && { stage: options.stage }),
        };
        allRoundFixtures.push(thirdPlaceData as unknown as Fixture);
        fixturesToInsert.push(thirdPlaceData);
        currentTime = new Date(
          currentTime.getTime() + options.intervalMinutes * 60 * 1000,
        );
      }

      if (allRoundFixtures.length > 0) {
        rounds.push({
          round,
          roundName,
          fixtures: allRoundFixtures,
          bracketFixtures,
        });
      }

      // Halve the matches for the next round
      matchesInCurrentRound = matchesInCurrentRound / 2;
    }

    // Link fixtures to their next round matches (bracket progression)
    for (let roundIndex = 0; roundIndex < rounds.length - 1; roundIndex++) {
      const currentRound = rounds[roundIndex];
      const nextRound = rounds[roundIndex + 1];

      if (!currentRound.bracketFixtures || !nextRound.bracketFixtures) continue;
      const currentBracket = currentRound.bracketFixtures;
      const nextBracket = nextRound.bracketFixtures;

      for (let i = 0; i < currentBracket.length; i++) {
        // Every 2 fixtures in current round feed into 1 fixture in next round
        const nextFixtureIndex = Math.floor(i / 2);
        const nextFixture = nextBracket[nextFixtureIndex];

        if (nextFixture) {
          currentBracket[i].nextFixtureId = nextFixture.id;

          // If two-legged, also link the Leg 2 fixture to the same next fixture
          if (tournament.twoLegsKnockout) {
            const leg2 = currentRound.fixtures.find(
              (f) =>
                f.round === currentBracket[i].round &&
                f.matchNumber === currentBracket[i].matchNumber + 1 &&
                f.id !== currentBracket[i].id,
            );
            if (leg2) {
              leg2.nextFixtureId = nextFixture.id;
            }
          }
        }
      }
    }

    // Handle initial Byes (Auto-progress teams without opponents)
    for (const round of rounds) {
      if (!round.bracketFixtures) continue;
      if (round.round !== 1) continue; // Only process initial byes in Round 1
      for (let i = 0; i < round.bracketFixtures.length; i++) {
        const fixture = round.bracketFixtures[i];
        const targetFixture = fixturesToInsert.find((f) => f.id === fixture.id);

        const hasHome = !!targetFixture.homeTeamId;
        const hasAway = !!targetFixture.awayTeamId;

        if (hasHome !== hasAway) {
          // XOR: Only one team exists
          const winnerId = hasHome
            ? targetFixture.homeTeamId
            : targetFixture.awayTeamId;

          // 1. Mark current fixture as COMPLETED
          targetFixture.status = 'COMPLETED';
          targetFixture.homeScore = hasHome ? 3 : 0; // Award 3-0 win for walkover
          targetFixture.awayScore = hasAway ? 3 : 0;

          // 2. Advance winner to next fixture
          if (targetFixture.nextFixtureId) {
            // Determine feed direction correctly using index in bracket layout
            const isHomeFeed = i % 2 === 0;
            const nextTarget = fixturesToInsert.find(
              (f) => f.id === targetFixture.nextFixtureId,
            );

            if (nextTarget) {
              if (isHomeFeed) {
                nextTarget.homeTeamId = winnerId;
                nextTarget.homeTeamPlaceholder = null;
              } else {
                nextTarget.awayTeamId = winnerId;
                nextTarget.awayTeamPlaceholder = null;
              }

              // For two-legged knockouts, also update Leg 2 of the next round (swapped position)
              if (
                tournament.twoLegsKnockout &&
                nextTarget.roundName?.includes('Leg 1')
              ) {
                const leg2OfNext = fixturesToInsert.find(
                  (f) =>
                    f.round === nextTarget.round &&
                    f.matchNumber === nextTarget.matchNumber + 1,
                );
                if (leg2OfNext) {
                  if (isHomeFeed) {
                    leg2OfNext.awayTeamId = winnerId;
                    leg2OfNext.awayTeamPlaceholder = null;
                  } else {
                    leg2OfNext.homeTeamId = winnerId;
                    leg2OfNext.homeTeamPlaceholder = null;
                  }
                }
              }
            }
          }
        }
      }
    }

    if (fixturesToInsert.length > 0) {
      await this.db.fixture.createMany({ data: fixturesToInsert });
    }

    // Clean up internal bracketFixtures mapping before returning
    const finalRounds = rounds.map(({ bracketFixtures, ...rest }) => rest);
    return finalRounds;
  }

  // Get round abbreviation for placeholder labels
  private getRoundAbbreviation(roundName: string): string {
    switch (roundName) {
      case 'Final':
        return 'F';
      case 'Semi Final':
        return 'SF';
      case 'Quarter Final':
        return 'QF';
      case 'Round of 16':
        return 'R16';
      case 'Round of 32':
        return 'R32';
      case 'Round of 64':
        return 'R64';
      default:
        // Extract number from "Round of X"
        const match = roundName.match(/Round of (\d+)/);
        return match ? `R${match[1]}` : roundName.substring(0, 3).toUpperCase();
    }
  }

  // Get descriptive round name for knockout tournaments

  // Generate Hybrid Knockout bracket with group placeholders
  private async generateHybridKnockoutPlaceholders(
    tournament: any,
    options: {
      numberOfGroups: number;
      advancingPerGroup: number;
      hasThirdPlace: boolean;
      startDate: Date;
      intervalMinutes: number;
      knockoutMatchups?: {
        home?: string;
        away?: string;
        homePlaceholder?: string;
        awayPlaceholder?: string;
      }[];
      isUnifiedStandings?: boolean;
      hasKnockoutPlayoffs?: boolean;
    },
  ) {
    const totalQualifiers = options.numberOfGroups * options.advancingPerGroup;
    if (totalQualifiers < 2) return [];

    const totalRounds = Math.ceil(Math.log2(totalQualifiers));
    const perfectBracketSize = Math.pow(2, totalRounds);
    const matchesInRound1 = perfectBracketSize / 2;

    // Build round 1 cross-group placeholders
    const round1Pairs: { homePlaceholder: string; awayPlaceholder: string }[] = [];

    if (options.knockoutMatchups && options.knockoutMatchups.length > 0) {
      for (const m of options.knockoutMatchups) {
        round1Pairs.push({
          homePlaceholder: m.homePlaceholder || m.home || 'TBD',
          awayPlaceholder: m.awayPlaceholder || m.away || 'TBD',
        });
      }
    } else if (options.isUnifiedStandings && options.hasKnockoutPlayoffs) {
      let B = 16;
      if (totalQualifiers < 12) B = 4;
      else if (totalQualifiers < 24) B = 8;

      const playoffMatches = B / 2;

      const round1PairsPlayoffs: [number, number][] = [];
      if (B === 16) {
        round1PairsPlayoffs.push([9, 24], [16, 17], [13, 20], [12, 21], [14, 19], [11, 22], [15, 18], [10, 23]);
      } else if (B === 8) {
        round1PairsPlayoffs.push([5, 12], [8, 9], [6, 11], [7, 10]);
      } else {
        round1PairsPlayoffs.push([3, 6], [4, 5]);
      }

      const round2DirectSeeds: number[] = [];
      if (B === 16) {
        round2DirectSeeds.push(1, 8, 4, 5, 2, 7, 3, 6);
      } else if (B === 8) {
        round2DirectSeeds.push(1, 4, 2, 3);
      } else {
        round2DirectSeeds.push(1, 2);
      }

      const playoffRounds: {
        round: number;
        roundName: string;
        fixtures: Fixture[];
        bracketFixtures?: Fixture[];
      }[] = [];
      const playoffFixturesToInsert: any[] = [];

      // Round 1: Knockout Play-offs
      const r1RoundName = 'Knockout Play-offs';
      const r1Bracket: Fixture[] = [];
      const r1All: Fixture[] = [];
      let r1MatchNumber = 1;

      for (let m = 0; m < playoffMatches; m++) {
        const [sHome, sAway] = round1PairsPlayoffs[m];
        const isTwoLegs = tournament.twoLegsKnockout;
        const fix1 = {
          id: crypto.randomUUID(),
          tournament_id: tournament.id,
          round: 1,
          roundName: isTwoLegs ? `${r1RoundName} - Leg 1` : r1RoundName,
          matchNumber: r1MatchNumber++,
          startTime: null,
          homeTeamId: null,
          awayTeamId: null,
          homeTeamPlaceholder: `Seed ${sHome}`,
          awayTeamPlaceholder: `Seed ${sAway}`,
          status: 'SCHEDULED' as any,
          stage: FixtureStage.KNOCKOUT,
        };
        r1Bracket.push(fix1 as unknown as Fixture);
        r1All.push(fix1 as unknown as Fixture);
        playoffFixturesToInsert.push(fix1);

        if (isTwoLegs) {
          const fix2 = {
            id: crypto.randomUUID(),
            tournament_id: tournament.id,
            round: 1,
            roundName: `${r1RoundName} - Leg 2`,
            matchNumber: r1MatchNumber++,
            startTime: null,
            homeTeamId: null,
            awayTeamId: null,
            homeTeamPlaceholder: `Seed ${sAway}`,
            awayTeamPlaceholder: `Seed ${sHome}`,
            status: 'SCHEDULED' as any,
            stage: FixtureStage.KNOCKOUT,
          };
          r1All.push(fix2 as unknown as Fixture);
          playoffFixturesToInsert.push(fix2);
        }
      }
      playoffRounds.push({ round: 1, roundName: r1RoundName, fixtures: r1All, bracketFixtures: r1Bracket });

      // Round 2: Main Round (Round of 16 / QF / SF)
      const r2RoundName = B === 16 ? 'Round of 16' : B === 8 ? 'Quarter Final' : 'Semi Final';
      const r2Bracket: Fixture[] = [];
      const r2All: Fixture[] = [];
      let r2MatchNumber = 1;

      for (let m = 0; m < playoffMatches; m++) {
        const seed = round2DirectSeeds[m];
        const isTwoLegs = tournament.twoLegsKnockout;
        const fix1 = {
          id: crypto.randomUUID(),
          tournament_id: tournament.id,
          round: 2,
          roundName: isTwoLegs ? `${r2RoundName} - Leg 1` : r2RoundName,
          matchNumber: r2MatchNumber++,
          startTime: null,
          homeTeamId: null,
          awayTeamId: null,
          homeTeamPlaceholder: `Seed ${seed}`,
          awayTeamPlaceholder: `PO(${m + 1}) Winner`,
          status: 'SCHEDULED' as any,
          stage: FixtureStage.KNOCKOUT,
        };
        r2Bracket.push(fix1 as unknown as Fixture);
        r2All.push(fix1 as unknown as Fixture);
        playoffFixturesToInsert.push(fix1);

        if (isTwoLegs) {
          const fix2 = {
            id: crypto.randomUUID(),
            tournament_id: tournament.id,
            round: 2,
            roundName: `${r2RoundName} - Leg 2`,
            matchNumber: r2MatchNumber++,
            startTime: null,
            homeTeamId: null,
            awayTeamId: null,
            homeTeamPlaceholder: `PO(${m + 1}) Winner`,
            awayTeamPlaceholder: `Seed ${seed}`,
            status: 'SCHEDULED' as any,
            stage: FixtureStage.KNOCKOUT,
          };
          r2All.push(fix2 as unknown as Fixture);
          playoffFixturesToInsert.push(fix2);
        }
      }
      playoffRounds.push({ round: 2, roundName: r2RoundName, fixtures: r2All, bracketFixtures: r2Bracket });

      // Link R1 -> R2
      for (let m = 0; m < playoffMatches; m++) {
        r1Bracket[m].nextFixtureId = r2Bracket[m].id;
        if (tournament.twoLegsKnockout) {
          const leg2 = r1All.find((f) => f.round === 1 && f.matchNumber === r1Bracket[m].matchNumber + 1);
          if (leg2) leg2.nextFixtureId = r2Bracket[m].id;
        }
      }

      // Subsequent rounds: QF, SF, Final
      let curMatches = playoffMatches / 2;
      let prevBracket = r2Bracket;
      let prevAll = r2All;
      let roundNum = 3;

      while (curMatches >= 1) {
        const curRoundName = curMatches === 4 ? 'Quarter Final' : curMatches === 2 ? 'Semi Final' : 'Final';
        const curBracket: Fixture[] = [];
        const curAll: Fixture[] = [];
        const isFinal = curMatches === 1;
        const isTwoLegs = tournament.twoLegsKnockout && !isFinal;
        const prevAbbrev = prevBracket[0].roundName?.includes('Round of 16')
          ? 'R16'
          : prevBracket[0].roundName?.includes('Quarter Final')
          ? 'QF'
          : 'SF';
        let roundMatchNumber = 1;

        for (let m = 0; m < curMatches; m++) {
          const prevM1 = m * 2 + 1;
          const prevM2 = m * 2 + 2;
          const fix1 = {
            id: crypto.randomUUID(),
            tournament_id: tournament.id,
            round: roundNum,
            roundName: isTwoLegs ? `${curRoundName} - Leg 1` : curRoundName,
            matchNumber: roundMatchNumber++,
            startTime: null,
            homeTeamId: null,
            awayTeamId: null,
            homeTeamPlaceholder: `${prevAbbrev}(${prevM1}) Winner`,
            awayTeamPlaceholder: `${prevAbbrev}(${prevM2}) Winner`,
            status: 'SCHEDULED' as any,
            stage: FixtureStage.KNOCKOUT,
          };
          curBracket.push(fix1 as unknown as Fixture);
          curAll.push(fix1 as unknown as Fixture);
          playoffFixturesToInsert.push(fix1);

          if (isTwoLegs) {
            const fix2 = {
              id: crypto.randomUUID(),
              tournament_id: tournament.id,
              round: roundNum,
              roundName: `${curRoundName} - Leg 2`,
              matchNumber: roundMatchNumber++,
              startTime: null,
              homeTeamId: null,
              awayTeamId: null,
              homeTeamPlaceholder: `${prevAbbrev}(${prevM2}) Winner`,
              awayTeamPlaceholder: `${prevAbbrev}(${prevM1}) Winner`,
              status: 'SCHEDULED' as any,
              stage: FixtureStage.KNOCKOUT,
            };
            curAll.push(fix2 as unknown as Fixture);
            playoffFixturesToInsert.push(fix2);
          }
        }

        // Link previous round bracket to this round
        for (let i = 0; i < prevBracket.length; i++) {
          const targetNext = curBracket[Math.floor(i / 2)];
          if (targetNext) {
            prevBracket[i].nextFixtureId = targetNext.id;
            if (tournament.twoLegsKnockout) {
              const leg2 = prevAll.find(
                (f) => f.round === prevBracket[i].round && f.matchNumber === prevBracket[i].matchNumber + 1
              );
              if (leg2) leg2.nextFixtureId = targetNext.id;
            }
          }
        }

        if (isFinal && (options.hasThirdPlace || tournament.thirdPlaceMatch)) {
          const thirdPlace = {
            id: crypto.randomUUID(),
            tournament_id: tournament.id,
            round: roundNum,
            roundName: 'Third Place Match',
            matchNumber: roundMatchNumber++,
            startTime: null,
            homeTeamId: null,
            awayTeamId: null,
            homeTeamPlaceholder: 'SF(1) Loser',
            awayTeamPlaceholder: 'SF(2) Loser',
            status: 'SCHEDULED' as any,
            stage: FixtureStage.KNOCKOUT,
          };
          curAll.push(thirdPlace as unknown as Fixture);
          playoffFixturesToInsert.push(thirdPlace);
        }

        playoffRounds.push({ round: roundNum, roundName: curRoundName, fixtures: curAll, bracketFixtures: curBracket });
        prevBracket = curBracket;
        prevAll = curAll;
        curMatches /= 2;
        roundNum++;
      }

      if (playoffFixturesToInsert.length > 0) {
        await this.db.fixture.createMany({ data: playoffFixturesToInsert });
      }

      return playoffRounds.map(({ bracketFixtures, ...rest }) => rest);
    } else if (options.isUnifiedStandings) {
      const K = totalQualifiers;
      const seedPairs: [number, number][] = [];
      if (K === 4) {
        seedPairs.push([1, 4], [2, 3]);
      } else if (K === 8) {
        seedPairs.push([1, 8], [4, 5], [2, 7], [3, 6]);
      } else if (K === 16) {
        seedPairs.push(
          [1, 16], [8, 9], [4, 13], [5, 12],
          [2, 15], [7, 10], [3, 14], [6, 11]
        );
      } else {
        for (let i = 0; i < matchesInRound1; i++) {
          seedPairs.push([i + 1, perfectBracketSize - i]);
        }
      }

      for (const [sHome, sAway] of seedPairs) {
        round1Pairs.push({
          homePlaceholder: `Seed ${sHome}`,
          awayPlaceholder: `Seed ${sAway}`,
        });
      }
    } else if (options.numberOfGroups === 2 && options.advancingPerGroup === 2) {
      round1Pairs.push({ homePlaceholder: 'Winner Group A', awayPlaceholder: 'Runner-up Group B' });
      round1Pairs.push({ homePlaceholder: 'Winner Group B', awayPlaceholder: 'Runner-up Group A' });
    } else if (options.numberOfGroups === 4 && options.advancingPerGroup === 2) {
      round1Pairs.push({ homePlaceholder: 'Winner Group A', awayPlaceholder: 'Runner-up Group B' });
      round1Pairs.push({ homePlaceholder: 'Winner Group C', awayPlaceholder: 'Runner-up Group D' });
      round1Pairs.push({ homePlaceholder: 'Winner Group B', awayPlaceholder: 'Runner-up Group A' });
      round1Pairs.push({ homePlaceholder: 'Winner Group D', awayPlaceholder: 'Runner-up Group C' });
    } else if (options.advancingPerGroup === 1) {
      for (let i = 0; i < options.numberOfGroups; i += 2) {
        const g1 = String.fromCharCode(65 + i);
        const g2 = i + 1 < options.numberOfGroups ? String.fromCharCode(65 + i + 1) : null;
        round1Pairs.push({
          homePlaceholder: `Winner Group ${g1}`,
          awayPlaceholder: g2 ? `Winner Group ${g2}` : 'BYE',
        });
      }
    } else {
      for (let i = 0; i < options.numberOfGroups; i++) {
        const gHome = String.fromCharCode(65 + i);
        const targetGroup = (i + 1) % options.numberOfGroups;
        const gAway = String.fromCharCode(65 + targetGroup);
        round1Pairs.push({
          homePlaceholder: `Winner Group ${gHome}`,
          awayPlaceholder: `Runner-up Group ${gAway}`,
        });
      }
    }

    const rounds: {
      round: number;
      roundName: string;
      fixtures: Fixture[];
      bracketFixtures?: Fixture[];
    }[] = [];

    let matchesInCurrentRound = matchesInRound1;
    let currentTime = new Date(options.startDate);
    const fixturesToInsert: any[] = [];

    for (let round = 1; round <= totalRounds; round++) {
      const roundName = this.getKnockoutRoundName(
        round,
        totalRounds,
        perfectBracketSize,
      );
      const prevRoundName =
        round > 1
          ? this.getKnockoutRoundName(
              round - 1,
              totalRounds,
              perfectBracketSize,
            )
          : null;
      const prevRoundAbbrev = prevRoundName
        ? this.getRoundAbbreviation(prevRoundName)
        : null;

      const bracketFixtures: Fixture[] = [];
      const allRoundFixtures: Fixture[] = [];
      let roundMatchNumber = 1;

      for (let matchIndex = 0; matchIndex < matchesInCurrentRound; matchIndex++) {
        let homeTeamPlaceholder = 'TBD';
        let awayTeamPlaceholder = 'TBD';

        if (round === 1) {
          homeTeamPlaceholder = round1Pairs[matchIndex]?.homePlaceholder || 'TBD';
          awayTeamPlaceholder = round1Pairs[matchIndex]?.awayPlaceholder || 'TBD';
        } else {
          const prevMatch1 = matchIndex * 2 + 1;
          const prevMatch2 = matchIndex * 2 + 2;
          homeTeamPlaceholder = `${prevRoundAbbrev}(${prevMatch1}) Winner`;
          awayTeamPlaceholder = `${prevRoundAbbrev}(${prevMatch2}) Winner`;
        }

        const isTwoLegs = tournament.twoLegsKnockout && round < totalRounds;

        const fixtureData = {
          id: crypto.randomUUID(),
          tournament_id: tournament.id,
          round,
          roundName: isTwoLegs ? `${roundName} - Leg 1` : roundName,
          matchNumber: roundMatchNumber++,
          startTime: null,
          homeTeamId: null,
          awayTeamId: null,
          homeTeamPlaceholder,
          awayTeamPlaceholder,
          status: 'SCHEDULED',
          stage: FixtureStage.KNOCKOUT,
        };

        bracketFixtures.push(fixtureData as unknown as Fixture);
        allRoundFixtures.push(fixtureData as unknown as Fixture);
        fixturesToInsert.push(fixtureData);

        if (isTwoLegs) {
          const leg2Data = {
            id: crypto.randomUUID(),
            tournament_id: tournament.id,
            round,
            roundName: `${roundName} - Leg 2`,
            matchNumber: roundMatchNumber++,
            startTime: null,
            homeTeamId: null,
            awayTeamId: null,
            homeTeamPlaceholder: awayTeamPlaceholder,
            awayTeamPlaceholder: homeTeamPlaceholder,
            status: 'SCHEDULED',
            stage: FixtureStage.KNOCKOUT,
          };
          allRoundFixtures.push(leg2Data as unknown as Fixture);
          fixturesToInsert.push(leg2Data);
        }
      }

      if (round === totalRounds && (options.hasThirdPlace || tournament.thirdPlaceMatch)) {
        const thirdPlaceData = {
          id: crypto.randomUUID(),
          tournament_id: tournament.id,
          round,
          roundName: 'Third Place Match',
          matchNumber: roundMatchNumber++,
          startTime: null,
          homeTeamPlaceholder: 'SF1 Loser',
          awayTeamPlaceholder: 'SF2 Loser',
          homeTeamId: null,
          awayTeamId: null,
          status: 'SCHEDULED',
          stage: FixtureStage.KNOCKOUT,
        };
        allRoundFixtures.push(thirdPlaceData as unknown as Fixture);
        fixturesToInsert.push(thirdPlaceData);
      }

      if (allRoundFixtures.length > 0) {
        rounds.push({
          round,
          roundName,
          fixtures: allRoundFixtures,
          bracketFixtures,
        });
      }

      matchesInCurrentRound = matchesInCurrentRound / 2;
    }

    // Link nextFixtureId
    for (let roundIndex = 0; roundIndex < rounds.length - 1; roundIndex++) {
      const currentRound = rounds[roundIndex];
      const nextRound = rounds[roundIndex + 1];

      if (!currentRound.bracketFixtures || !nextRound.bracketFixtures) continue;
      const currentBracket = currentRound.bracketFixtures;
      const nextBracket = nextRound.bracketFixtures;

      for (let i = 0; i < currentBracket.length; i++) {
        const nextFixtureIndex = Math.floor(i / 2);
        const nextFixture = nextBracket[nextFixtureIndex];

        if (nextFixture) {
          currentBracket[i].nextFixtureId = nextFixture.id;

          if (tournament.twoLegsKnockout) {
            const leg2 = currentRound.fixtures.find(
              (f) =>
                f.round === currentBracket[i].round &&
                f.matchNumber === currentBracket[i].matchNumber + 1 &&
                f.id !== currentBracket[i].id,
            );
            if (leg2) {
              leg2.nextFixtureId = nextFixture.id;
            }
          }
        }
      }
    }

    if (fixturesToInsert.length > 0) {
      await this.db.fixture.createMany({ data: fixturesToInsert });
    }

    const finalRounds = rounds.map(({ bracketFixtures, ...rest }) => rest);
    return finalRounds;
  }

  private getKnockoutRoundName(
    round: number,
    totalRounds: number,
    bracketSize: number,
  ): string {
    const roundsFromFinal = totalRounds - round;

    switch (roundsFromFinal) {
      case 0:
        return 'Final';
      case 1:
        return 'Semi Final';
      case 2:
        return 'Quarter Final';
      default:
        // Calculate teams remaining at this round
        const teamsInRound = bracketSize / Math.pow(2, round - 1);
        return `Round of ${teamsInRound}`;
    }
  }

  // Group Stage fixture generation
  private async generateGroupStageFixtures(
    tournament: Tournament,
    participants: Participant[],
    options: {
      startDate: Date;
      intervalMinutes: number;
      numberOfGroups: number;
      groupAssignments?: Record<string, string[]>;
      useExistingGroups?: boolean;
      doubleRoundRobin?: boolean;
    },
  ) {
    const numGroups = Math.max(1, options.numberOfGroups);
    let createdGroups: Group[] = [];

    if (options.useExistingGroups) {
      // Find existing groups for this tournament
      const existingGroups = await this.db.group.findMany({
        where: { tournament_id: tournament.id },
        include: { participants: true },
        orderBy: { created_at: 'asc' },
      });

      if (existingGroups.length === 0) {
        throw new BadRequestException(
          'No existing groups found for this tournament. Please create groups first or disable "Use Existing Groups".',
        );
      }
      createdGroups = existingGroups;
    } else {
      // Use labels from manual group assignments if provided; otherwise fall back to Group A, B...
      const assignmentLabels =
        options.groupAssignments &&
        Object.keys(options.groupAssignments).length > 0
          ? Object.keys(options.groupAssignments)
          : Array.from(
              { length: numGroups },
              (_, i) => `Group ${String.fromCharCode(65 + i)}`,
            );

      // create or find existing groups
      for (const name of assignmentLabels) {
        const group = await this.db.group.create({
          data: {
            name,
            tournament_id: tournament.id,
          },
        });
        createdGroups.push(group);
      }
    }

    const actualNumGroups = createdGroups.length;

    // Distribute participants into groups
    const distributedParticipants: Participant[][] = Array.from(
      { length: actualNumGroups },
      () => [],
    );

    if (options.useExistingGroups) {
      // Use existing assignments
      for (let g = 0; g < actualNumGroups; g++) {
        const group = createdGroups[g];
        // Participants already assigned to this group in the database
        const existingParticipantIds = group['participants'].map((p) => p.id);

        for (const pid of existingParticipantIds) {
          const participant = participants.find((p) => p.id === pid);
          if (participant) {
            distributedParticipants[g].push(participant);
          }
        }
      }

      // Handle unassigned participants by distributing them among existing groups
      const assignedIds = new Set(
        distributedParticipants.flat().map((p) => p.id),
      );
      const unassigned = participants.filter((p) => !assignedIds.has(p.id));

      for (let i = 0; i < unassigned.length; i++) {
        const groupIndex = i % actualNumGroups;
        const participant = unassigned[i];

        await this.db.participant.update({
          where: { id: participant.id },
          data: { groupId: createdGroups[groupIndex].id },
        });
        distributedParticipants[groupIndex].push(participant);
      }
    } else if (
      options.groupAssignments &&
      Object.keys(options.groupAssignments).length > 0
    ) {
      // Manual group assignment mode
      const groupNames = createdGroups.map((g) => g.name);
      for (let g = 0; g < actualNumGroups; g++) {
        const groupLabel = groupNames[g];
        const assignedIds = options.groupAssignments[groupLabel] || [];

        for (const pid of assignedIds) {
          const participant = participants.find((p) => p.id === pid);
          if (participant) {
            // Update participant with group ID
            await this.db.participant.update({
              where: { id: participant.id },
              data: { groupId: createdGroups[g].id },
            });
            distributedParticipants[g].push(participant);
          }
        }
      }

      // Also assign any unassigned participants to groups using round-robin
      const assignedIds = new Set(
        Object.values(options.groupAssignments).flat(),
      );
      const unassigned = participants.filter((p) => !assignedIds.has(p.id));
      for (let i = 0; i < unassigned.length; i++) {
        const groupIndex = i % actualNumGroups;
        const participant = unassigned[i];

        await this.db.participant.update({
          where: { id: participant.id },
          data: { groupId: createdGroups[groupIndex].id },
        });
        distributedParticipants[groupIndex].push(participant);
      }
    } else {
      // Automatic round-robin distribution: 1->A, 2->B, 3->C, 4->D, 5->A...
      for (let i = 0; i < participants.length; i++) {
        const groupIndex = i % actualNumGroups;
        const participant = participants[i];

        // Update participant with group ID
        await this.db.participant.update({
          where: { id: participant.id },
          data: { groupId: createdGroups[groupIndex].id },
        });

        distributedParticipants[groupIndex].push(participant);
      }
    }

    const allRounds: {
      round: number;
      roundName: string;
      fixtures: Fixture[];
    }[] = [];
    let matchNumber = 1;
    let currentTime = new Date(options.startDate);
    const fixturesToInsert: any[] = [];

    // First, map rounds to a temporary structure to aggregation
    // roundsMap[roundNum] = [fixtures from all groups]
    const roundsMap: Record<number, Fixture[]> = {};

    for (let g = 0; g < actualNumGroups; g++) {
      const group = createdGroups[g];
      const groupParticipants = distributedParticipants[g];

      const n = groupParticipants.length;
      if (n < 2) continue; // Need at least 2 teams to play

      const teams = [...groupParticipants];
      if (n % 2 !== 0) {
        teams.push(null as unknown as Participant); // Dummy for bye
      }

      const numTeams = teams.length;
      const numRounds = numTeams - 1;
      const matchesPerRound = numTeams / 2;

      const tempTeams = [...teams]; // Working copy for rotation

      for (let round = 1; round <= numRounds; round++) {
        if (!roundsMap[round]) roundsMap[round] = [];

        for (let match = 0; match < matchesPerRound; match++) {
          const home = tempTeams[match];
          const away = tempTeams[numTeams - 1 - match];

          // Skip bye
          // Note: using strict null check if teams can be null
          if (home && away) {
            const fixtureData = {
              id: crypto.randomUUID(),
              tournament_id: tournament.id,
              groupId: group.id,
              round,
              roundName: `Group Stage - Matchday ${round}`,
              matchNumber: matchNumber++, // We'll re-number later or just increment global
              startTime: null,
              homeTeamId: home.id,
              awayTeamId: away.id,
              status: 'SCHEDULED',
              stage: FixtureStage.GROUP_STAGE,
            };

            fixturesToInsert.push(fixtureData);
            roundsMap[round].push(fixtureData as unknown as Fixture);

            // Increment time for every match generated (sequential scheduling)
            currentTime = new Date(
              currentTime.getTime() + options.intervalMinutes * 60 * 1000,
            );
          }
        }

        // Rotate teams (keep first team fixed)
        const lastTeam = tempTeams.pop()!;
        tempTeams.splice(1, 0, lastTeam);
      }
    }

    // Convert map to array
    const sortedRounds = Object.keys(roundsMap)
      .map(Number)
      .sort((a, b) => a - b);
    for (const roundNum of sortedRounds) {
      allRounds.push({
        round: roundNum,
        roundName: `Group Stage - Matchday ${roundNum}`,
        fixtures: roundsMap[roundNum],
      });
    }

    // Handle Double Round Robin (Second Leg)
    const hasGroupDoubleRound =
      options.doubleRoundRobin !== undefined
        ? options.doubleRoundRobin
        : !!(tournament as any).doubleRoundRobin;
    if (hasGroupDoubleRound) {
      const numRoundsSingle = sortedRounds.length;

      for (const roundNum of sortedRounds) {
        const firstLegFixtures = roundsMap[roundNum];
        const secondLegRoundNum = roundNum + numRoundsSingle;
        const secondLegFixtures: Fixture[] = [];

        for (const f of firstLegFixtures) {
          const fixtureData = {
            id: crypto.randomUUID(),
            tournament_id: tournament.id,
            round: secondLegRoundNum,
            roundName: `Group Stage - Matchday ${secondLegRoundNum}`,
            matchNumber: matchNumber++,
            startTime: null,
            homeTeamId: f.awayTeamId, // Swap home/away
            awayTeamId: f.homeTeamId,
            status: 'SCHEDULED',
            groupId: f.groupId,
            stage: FixtureStage.GROUP_STAGE,
          };

          fixturesToInsert.push(fixtureData);
          secondLegFixtures.push(fixtureData as unknown as Fixture);

          // Increment time
          currentTime = new Date(
            currentTime.getTime() + options.intervalMinutes * 60 * 1000,
          );
        }

        allRounds.push({
          round: secondLegRoundNum,
          roundName: `Group Stage - Matchday ${secondLegRoundNum}`,
          fixtures: secondLegFixtures,
        });
      }
    }

    if (fixturesToInsert.length > 0) {
      await this.db.fixture.createMany({ data: fixturesToInsert });
    }

    return allRounds;
  }

  // Round-robin generation (each team plays every other once) - returns fixtures grouped by rounds
  private async generateRoundRobinFixtures(
    tournament: Tournament,
    participants: Participant[],
    options: {
      startDate: Date;
      intervalMinutes: number;
      doubleRoundRobin?: boolean;
    },
  ) {
    const rounds: { round: number; roundName: string; fixtures: Fixture[] }[] =
      [];
    const fixturesToInsert: any[] = [];
    const n = participants.length;

    // Add a "bye" participant if odd number
    const teams = [...participants];
    if (n % 2 !== 0) {
      teams.push(null as unknown as Participant);
    }

    const numTeams = teams.length;
    const numRounds = numTeams - 1;
    const matchesPerRound = numTeams / 2;

    let matchNumber = 1;
    let currentTime = new Date(options.startDate);

    // Circle method for round-robin scheduling
    for (let round = 1; round <= numRounds; round++) {
      const roundName = `Matchday ${round}`;
      const roundFixtures: Fixture[] = [];

      for (let match = 0; match < matchesPerRound; match++) {
        const home = teams[match];
        const away = teams[numTeams - 1 - match];

        // Skip bye matches
        if (home === null || away === null) continue;

        const fixtureData = {
          id: crypto.randomUUID(),
          tournament_id: tournament.id,
          round,
          roundName,
          matchNumber: matchNumber++,
          startTime: null,
          homeTeamId: home.id,
          awayTeamId: away.id,
          status: 'SCHEDULED',
        };

        fixturesToInsert.push(fixtureData);
        roundFixtures.push(fixtureData as unknown as Fixture);

        currentTime = new Date(
          currentTime.getTime() + options.intervalMinutes * 60 * 1000,
        );
      }

      if (roundFixtures.length > 0) {
        rounds.push({ round, roundName, fixtures: roundFixtures });
      }

      // Rotate teams (keep first team fixed)
      const lastTeam = teams.pop()!;
      teams.splice(1, 0, lastTeam);
    }

    // Handle Double Round Robin
    const hasRRDoubleRound =
      options.doubleRoundRobin !== undefined
        ? options.doubleRoundRobin
        : !!(tournament as any).doubleRoundRobin;
    if (hasRRDoubleRound) {
      const secondLegRounds: {
        round: number;
        roundName: string;
        fixtures: Fixture[];
      }[] = [];

      // We can generate second leg based on the first leg rounds
      for (const firstLegRound of rounds) {
        const roundNum = firstLegRound.round + numRounds;
        const roundName = `Matchday ${roundNum}`;
        const roundFixtures: Fixture[] = [];

        for (const f of firstLegRound.fixtures) {
          const fixtureData = {
            id: crypto.randomUUID(),
            tournament_id: tournament.id,
            round: roundNum,
            roundName,
            matchNumber: matchNumber++,
            startTime: null,
            homeTeamId: f.awayTeamId, // Swap home/away
            awayTeamId: f.homeTeamId,
            status: 'SCHEDULED',
          };

          fixturesToInsert.push(fixtureData);
          roundFixtures.push(fixtureData as unknown as Fixture);
          currentTime = new Date(
            currentTime.getTime() + options.intervalMinutes * 60 * 1000,
          );
        }
        secondLegRounds.push({
          round: roundNum,
          roundName,
          fixtures: roundFixtures,
        });
      }
      rounds.push(...secondLegRounds);
    }

    if (fixturesToInsert.length > 0) {
      await this.db.fixture.createMany({ data: fixturesToInsert });
    }

    return rounds;
  }

  // League generation (double round-robin: home and away) - returns fixtures grouped by rounds
  private async generateLeagueFixtures(
    tournament: Tournament,
    participants: Participant[],
    options: { startDate: Date; intervalMinutes: number },
  ) {
    // First leg (same as round-robin)
    const firstLegRounds = await this.generateRoundRobinFixtures(
      tournament,
      participants,
      options,
    );

    // Get all first leg fixtures to calculate timing and match numbers
    const allFirstLegFixtures = firstLegRounds.flatMap((r) => r.fixtures);

    // Second leg (reverse home/away) - grouped by rounds
    const secondLegRounds: {
      round: number;
      roundName: string;
      fixtures: Fixture[];
    }[] = [];
    let matchNumber = allFirstLegFixtures.length + 1;
    const fixturesToInsert: any[] = [];

    const numFirstLegRounds = firstLegRounds.length;

    for (const firstLegRound of firstLegRounds) {
      const secondLegRoundNum = firstLegRound.round + numFirstLegRounds;
      const roundName = `Matchday ${secondLegRoundNum}`;
      const roundFixtures: Fixture[] = [];

      for (const firstLegFixture of firstLegRound.fixtures) {
        const fixtureData = {
          id: crypto.randomUUID(),
          tournament_id: tournament.id,
          round: secondLegRoundNum,
          roundName,
          matchNumber: matchNumber++,
          startTime: null,
          homeTeamId: firstLegFixture.awayTeamId, // Swap home/away
          awayTeamId: firstLegFixture.homeTeamId,
          status: 'SCHEDULED',
        };

        fixturesToInsert.push(fixtureData);
        roundFixtures.push(fixtureData as unknown as Fixture);
      }

      if (roundFixtures.length > 0) {
        secondLegRounds.push({
          round: secondLegRoundNum,
          roundName,
          fixtures: roundFixtures,
        });
      }
    }

    if (fixturesToInsert.length > 0) {
      await this.db.fixture.createMany({ data: fixturesToInsert });
    }

    return [...firstLegRounds, ...secondLegRounds];
  }

  // Utility: Shuffle array (Fisher-Yates)
  private shuffleArray<T>(array: T[]): T[] {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  // Utility: Seed bracket for knockout (1v8, 4v5, 2v7, 3v6 pattern)
  private seedBracket(
    participants: Participant[],
    bracketSize: number,
  ): (Participant | null)[] {
    const seeded: (Participant | null)[] = new Array(bracketSize).fill(null);

    // Simple seeding: place participants in bracket order
    // Top half seeds vs bottom half seeds
    for (let i = 0; i < participants.length; i++) {
      if (i < bracketSize / 2) {
        seeded[i * 2] = participants[i];
      } else {
        const position = (i - bracketSize / 2) * 2 + 1;
        if (position < bracketSize) {
          seeded[position] = participants[i];
        }
      }
    }

    return seeded;
  }

  // Initialize standings for a tournament
  private async initializeStandings(tournament: Tournament) {
    if (
      tournament.type === TournamentType.KNOCKOUT ||
      tournament.type === TournamentType.FRIENDLY
    ) {
      return;
    }
    const participants = await this.db.participant.findMany({
      where: {
        tournament_id: tournament.id,
        status: 'CONFIRMED',
      },
      include: { group: true },
    });

    const isUnified = !!(tournament as any).unifiedStandings;

    for (let i = 0; i < participants.length; i++) {
      const participant = participants[i];
      const existing = await this.db.standing.findUnique({
        where: {
          tournament_id_participant_id: {
            tournament_id: tournament.id,
            participant_id: participant.id,
          },
        },
      });

      if (!existing) {
        await this.db.standing.create({
          data: {
            tournament_id: tournament.id,
            participant_id: participant.id,
            group: isUnified ? null : participant.group?.name,
            position: isUnified ? i + 1 : null,
            played: 0,
            wins: 0,
            draws: 0,
            losses: 0,
            goalsFor: 0,
            goalsAgainst: 0,
            goalDiff: 0,
            points: 0,
          },
        });
      }
    }
  }

  // Race generation — one fixture ("Final") holding no head-to-head teams;
  // all tournament participants get ranked via result entries instead.
  private async generateRaceFixtures(tournament: Tournament) {
    const fixtureData = {
      id: crypto.randomUUID(),
      tournament_id: tournament.id,
      round: 1,
      roundName: 'Final',
      matchNumber: 1,
      startTime: null,
      homeTeamId: null,
      awayTeamId: null,
      status: FixtureStatus.SCHEDULED,
    };

    await this.db.fixture.create({ data: fixtureData });

    return [
      {
        round: 1,
        roundName: 'Final',
        fixtures: [fixtureData as unknown as Fixture],
      },
    ];
  }

  // Friendly match generation - Pair up participants for single matches
  private async generateFriendlyFixtures(
    tournament: Tournament,
    participants: Participant[],
    _options: { startDate: Date; intervalMinutes: number },
  ) {
    const rounds: { round: number; roundName: string; fixtures: Fixture[] }[] =
      [];
    const roundFixtures: Fixture[] = [];
    const fixturesToInsert: any[] = [];

    let matchNumber = 1;

    const numPairs = Math.floor(participants.length / 2);

    for (let i = 0; i < numPairs; i++) {
      const home = participants[i * 2];
      const away = participants[i * 2 + 1];

      const fixtureData = {
        id: crypto.randomUUID(),
        tournament_id: tournament.id,
        round: 1,
        roundName: 'Friendlies',
        matchNumber: matchNumber++,
        startTime: null,
        homeTeamId: home.id,
        awayTeamId: away.id,
        status: 'SCHEDULED',
      };

      fixturesToInsert.push(fixtureData);
      roundFixtures.push(fixtureData as unknown as Fixture);
    }

    if (fixturesToInsert.length > 0) {
      await this.db.fixture.createMany({ data: fixturesToInsert });
    }

    if (roundFixtures.length > 0) {
      rounds.push({
        round: 1,
        roundName: 'Friendlies',
        fixtures: roundFixtures,
      });
    }

    return rounds;
  }
  // Champions League / Swiss Pots fixture generation
  private async generateChampionsLeagueFixtures(
    tournament: Tournament,
    participants: Participant[],
    options: {
      startDate: Date;
      intervalMinutes: number;
      numberOfPots?: number;
      matchesPerPot?: number;
      groupAssignments?: Record<string, string[]>;
      useExistingGroups?: boolean;
    },
  ) {
    const numPots = Math.max(2, options.numberOfPots ?? 4);
    let createdPots: Group[] = [];

    if (options.useExistingGroups) {
      const existingGroups = await this.db.group.findMany({
        where: { tournament_id: tournament.id },
        include: { participants: true },
        orderBy: { created_at: 'asc' },
      });
      if (existingGroups.length === 0) {
        throw new BadRequestException('No existing pots/groups found for this tournament');
      }
      createdPots = existingGroups;
    } else {
      const potLabels = options.groupAssignments && Object.keys(options.groupAssignments).length > 0
        ? Object.keys(options.groupAssignments)
        : Array.from({ length: numPots }, (_, i) => `Pot ${i + 1}`);

      for (const name of potLabels) {
        const group = await this.db.group.create({
          data: { name, tournament_id: tournament.id },
        });
        createdPots.push(group);
      }
    }

    const actualNumPots = createdPots.length;
    const distributedParticipants: Participant[][] = Array.from(
      { length: actualNumPots },
      () => [],
    );

    if (options.useExistingGroups) {
      for (let g = 0; g < actualNumPots; g++) {
        const group = createdPots[g];
        const existingParticipantIds = group['participants'].map((p) => p.id);
        for (const pid of existingParticipantIds) {
          const participant = participants.find((p) => p.id === pid);
          if (participant) distributedParticipants[g].push(participant);
        }
      }
      const assignedIds = new Set(distributedParticipants.flat().map((p) => p.id));
      const unassigned = participants.filter((p) => !assignedIds.has(p.id));
      for (let i = 0; i < unassigned.length; i++) {
        const groupIndex = i % actualNumPots;
        const participant = unassigned[i];
        await this.db.participant.update({
          where: { id: participant.id },
          data: { groupId: createdPots[groupIndex].id },
        });
        distributedParticipants[groupIndex].push(participant);
      }
    } else if (options.groupAssignments && Object.keys(options.groupAssignments).length > 0) {
      const groupNames = createdPots.map((g) => g.name);
      for (let g = 0; g < actualNumPots; g++) {
        const groupLabel = groupNames[g];
        const assignedIds = options.groupAssignments[groupLabel] || [];
        for (const pid of assignedIds) {
          const participant = participants.find((p) => p.id === pid);
          if (participant) {
            await this.db.participant.update({
              where: { id: participant.id },
              data: { groupId: createdPots[g].id },
            });
            distributedParticipants[g].push(participant);
          }
        }
      }
      const assignedIds = new Set(Object.values(options.groupAssignments).flat());
      const unassigned = participants.filter((p) => !assignedIds.has(p.id));
      for (let i = 0; i < unassigned.length; i++) {
        const groupIndex = i % actualNumPots;
        const participant = unassigned[i];
        await this.db.participant.update({
          where: { id: participant.id },
          data: { groupId: createdPots[groupIndex].id },
        });
        distributedParticipants[groupIndex].push(participant);
      }
    } else {
      // Pot distribution: chunks of equal size
      const teamsPerPot = Math.ceil(participants.length / actualNumPots);
      for (let i = 0; i < participants.length; i++) {
        const groupIndex = Math.floor(i / teamsPerPot);
        const potIdx = Math.min(groupIndex, actualNumPots - 1);
        const participant = participants[i];
        await this.db.participant.update({
          where: { id: participant.id },
          data: { groupId: createdPots[potIdx].id },
        });
        distributedParticipants[potIdx].push(participant);
      }
    }

    // Now generate fixtures between and within pots
    const allFixtures: { home: Participant; away: Participant; potHome: number; potAway: number }[] = [];

    // 1. Intra-pot fixtures (1 Home, 1 Away inside each pot)
    for (let p = 0; p < actualNumPots; p++) {
      const pot = distributedParticipants[p];
      const S = pot.length;
      if (S < 2) continue;
      for (let i = 0; i < S; i++) {
        allFixtures.push({
          home: pot[i],
          away: pot[(i + 1) % S],
          potHome: p,
          potAway: p,
        });
      }
    }

    // 2. Inter-pot fixtures (1 Home, 1 Away between each pair of pots)
    for (let a = 0; a < actualNumPots; a++) {
      for (let b = a + 1; b < actualNumPots; b++) {
        const potA = distributedParticipants[a];
        const potB = distributedParticipants[b];
        const S = Math.min(potA.length, potB.length);
        if (S < 1) continue;
        const off = (a * 2 + b * 3) % S;

        for (let i = 0; i < S; i++) {
          allFixtures.push({
            home: potA[i],
            away: potB[(i + off) % S],
            potHome: a,
            potAway: b,
          });
        }
        for (let i = 0; i < S; i++) {
          allFixtures.push({
            home: potB[(i + off + 1) % S],
            away: potA[i],
            potHome: b,
            potAway: a,
          });
        }
      }
    }

    // Allocate into rounds
    const totalTeams = participants.length;
    const matchesPerRound = Math.max(1, Math.floor(totalTeams / 2));
    const numRounds = Math.max(1, Math.round(allFixtures.length / matchesPerRound));

    let scheduledRounds: { home: Participant; away: Participant }[][] | null = null;

    for (let trial = 0; trial < 100; trial++) {
      const tempRounds: { home: Participant; away: Participant }[][] = Array.from(
        { length: numRounds },
        () => [],
      );
      let remaining = [...allFixtures];
      let failed = false;

      for (let r = 0; r < numRounds; r++) {
        if (r === numRounds - 1) {
          tempRounds[r] = remaining;
          break;
        }

        let foundMatching: typeof allFixtures | null = null;
        for (let attempt = 0; attempt < 200; attempt++) {
          const shuffled = [...remaining].sort(() => Math.random() - 0.5);
          const currentMatching: typeof allFixtures = [];
          const usedTeams = new Set<string>();

          for (const fix of shuffled) {
            if (!usedTeams.has(fix.home.id) && !usedTeams.has(fix.away.id)) {
              currentMatching.push(fix);
              usedTeams.add(fix.home.id);
              usedTeams.add(fix.away.id);
              if (currentMatching.length === matchesPerRound) break;
            }
          }

          if (currentMatching.length === matchesPerRound) {
            foundMatching = currentMatching;
            break;
          }
        }

        if (!foundMatching) {
          failed = true;
          break;
        }

        tempRounds[r] = foundMatching;
        const matchingSet = new Set(foundMatching);
        remaining = remaining.filter((f) => !matchingSet.has(f));
      }

      if (!failed) {
        scheduledRounds = tempRounds;
        break;
      }
    }

    if (!scheduledRounds) {
      scheduledRounds = [];
      for (let i = 0; i < allFixtures.length; i += matchesPerRound) {
        scheduledRounds.push(allFixtures.slice(i, i + matchesPerRound));
      }
    }

    const rounds: {
      round: number;
      roundName: string;
      fixtures: Fixture[];
    }[] = [];
    const fixturesToInsert: any[] = [];
    let matchNumber = 1;
    let currentTime = new Date(options.startDate);

    for (let r = 0; r < scheduledRounds.length; r++) {
      const roundFixtures: Fixture[] = [];
      const roundNum = r + 1;
      const roundName = `League Phase - Matchday ${roundNum}`;

      for (const pair of scheduledRounds[r]) {
        const fixtureData = {
          id: crypto.randomUUID(),
          tournament_id: tournament.id,
          round: roundNum,
          roundName,
          matchNumber: matchNumber++,
          startTime: currentTime ? new Date(currentTime) : null,
          homeTeamId: pair.home.id,
          awayTeamId: pair.away.id,
          status: 'SCHEDULED' as any,
          stage: FixtureStage.GROUP_STAGE,
        };

        fixturesToInsert.push(fixtureData);
        roundFixtures.push(fixtureData as unknown as Fixture);
      }

      rounds.push({
        round: roundNum,
        roundName,
        fixtures: roundFixtures,
      });

      if (currentTime) {
        currentTime = new Date(
          currentTime.getTime() + options.intervalMinutes * 60000,
        );
      }
    }

    if (fixturesToInsert.length > 0) {
      await this.db.fixture.createMany({ data: fixturesToInsert });
    }

    return rounds;
  }

}
