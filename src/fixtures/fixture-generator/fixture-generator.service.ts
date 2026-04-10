import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import { GenerateFixturesDto } from 'src/fixtures/dto/generate-fixtures.dto';
import { AdvanceGroupStageDto } from 'src/fixtures/dto/advance-group-stage.dto';
import {
  Fixture,
  Participant,
  Tournament,
  Group,
  FixtureStage,
  TournamentType,
} from 'prisma/generated/client';
import { ResponseUtil } from 'src/utils/api-response';
import * as crypto from 'crypto';

@Injectable()
export class FixtureGeneratorService {
  constructor(private readonly db: DatabaseService) {}

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
      },
    });

    if (!tournament) {
      throw new NotFoundException('Tournament not found');
    }

    // Authorization check
    const membership = tournament.organization?.members[0];
    const isAuthorized =
      membership && (membership.role === 'OWNER' || membership.role === 'ADMIN');

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
    if (dto.clearExisting && tournament.fixtures.length > 0) {
      await this.db.fixture.deleteMany({
        where: { tournament_id: tournament.id },
      });
      await this.db.standing.deleteMany({
        where: { tournament_id: tournament.id },
      });
    }

    let participants = [...tournament.participants];

    // Validate minimum participants
    const minParticipants =
      tournament.type === TournamentType.KNOCKOUT ||
      tournament.type === TournamentType.FRIENDLY
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

    const options = {
      startDate: dto.startDate
        ? new Date(dto.startDate)
        : new Date(tournament.start_date),
      intervalMinutes: dto.intervalMinutes ?? 90,
    };

    let rounds: { round: number; roundName: string; fixtures: Fixture[] }[];

    switch (tournament.type) {
      case TournamentType.KNOCKOUT:
        rounds = await this.generateKnockoutFixtures(
          tournament,
          participants,
          options,
        );
        break;
      case TournamentType.ROUND_ROBIN:
        rounds = await this.generateRoundRobinFixtures(
          tournament,
          participants,
          {
            ...options,
            doubleRoundRobin: dto.doubleRoundRobin,
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
      case TournamentType.HYBRID:
      case TournamentType.GROUP:
        let numGroups = dto.numberOfGroups ?? tournament.numberOfGroups;
        const teamsPerGroup = dto.teamsPerGroup ?? tournament.teamsPerGroup;

        if (!numGroups && teamsPerGroup) {
          numGroups = Math.ceil(participants.length / teamsPerGroup);
        }

        const validNumGroups = numGroups ?? 4;

        if (participants.length % validNumGroups !== 0) {
          throw new BadRequestException(
            `Cannot evenly distribute ${participants.length} teams into ${validNumGroups} groups. Please adjust the number of groups or teams.`,
          );
        }

        rounds = await this.generateGroupStageFixtures(
          tournament,
          participants,
          {
            ...options,
            numberOfGroups: validNumGroups, // Default to 4 groups if neither specified
            doubleRoundRobin: dto.doubleRoundRobin,
          },
        );
        break;
      default:
        throw new BadRequestException(
          `Unsupported tournament type: ${tournament.type}`,
        );
    }

    // Initialize standings for non-knockout tournaments
    if (tournament.type !== TournamentType.KNOCKOUT) {
      await this.initializeStandings(tournament);
    }

    const totalFixtures = rounds.reduce((sum, r) => sum + r.fixtures.length, 0);

    return ResponseUtil.success({
      message: `Generated ${totalFixtures} fixtures for ${tournament.type} tournament`,
      rounds,
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
      membership && (membership.role === 'OWNER' || membership.role === 'ADMIN');

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
    // If we have "rounds", we could check round numbers, but easiest is to check if there are ANY uncompleted fixtures
    // that belong to a group.
    const groupFixtures = tournament.fixtures.filter(
      (f) => f.stage === FixtureStage.GROUP_STAGE,
    );

    if (groupFixtures.length === 0) {
      throw new BadRequestException(
        'No group stage fixtures found. Generate fixtures first.',
      );
    }

    const uncompleted = groupFixtures.filter((f) => f.status !== 'COMPLETED');
    if (uncompleted.length > 0) {
      throw new BadRequestException(
        `Group stage not finished. ${uncompleted.length} matches remaining.`,
      );
      // For testing purposes or manual override, maybe we allow it?
      // User asked for "manual progression", usually implies "I say when".
      // But standard logic implies matches must be done.
      // Let's enforce it for now unless we want a "force" flag.
      // Actually, if manual qualified IDs are provided, maybe we ignore completion?
      // Let's stick to enforce completion to avoid weird states, unless user explicitly asked to skip checks.
      // "I want option for the progression logic to be manual" -> implies the *trigger* is manual, and *who* qualifies can be manual.
    }

    let qualifiedParticipants: Participant[] = [];

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
    } else {
      // Auto selection (Top 2 from each group)
      // We need to calculate standings first or trust current standings.
      // Let's recalculate/ensure valid standings.
      // (Assuming getStandings logic is robust or we just use simple logic here)

      // This is complex to do "on the fly" perfectly without code duplication from `getStandings`.
      // For this task, let's assume we fetch standings via internal method or just calculate quickly.
      // Actually, `initializeStandings` created them. We can fetch them.

      const standings = await this.db.standing.findMany({
        where: { tournament_id: tournament.id },
        orderBy: [
          { points: 'desc' },
          { goalDiff: 'desc' },
          { goalsFor: 'desc' },
        ],
      });

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

    // Check if knockout fixtures already exist?
    // Maybe verify round > group rounds?
    // For now, let's just generate.

    const knockoutRounds = await this.generateKnockoutFixtures(
      tournament,
      qualifiedParticipants,
      {
        startDate: new Date(Date.now() + 24 * 60 * 60 * 1000), // Start tomorrow? Or use end of group stage?
        intervalMinutes: 120, // Standard knockout time
        stage: FixtureStage.KNOCKOUT,
      },
    );

    const totalNew = knockoutRounds.reduce(
      (sum, r) => sum + r.fixtures.length,
      0,
    );

    return ResponseUtil.success({
      message: `Advanced to knockout stage. Generated ${totalNew} fixtures with ${qualifiedParticipants.length} qualifiers.`,
      qualifiers: qualifiedParticipants.map((p: any) => ({
        id: p.id,
        name: p.customName || p.user?.name || p.team?.name,
      })),
      rounds: knockoutRounds,
    });
  }

  // Knockout bracket generation - returns fixtures grouped by rounds
  private async generateKnockoutFixtures(
    tournament: Tournament,
    participants: Participant[],
    options: { startDate: Date; intervalMinutes: number; stage?: FixtureStage },
  ) {
    const rounds: { round: number; roundName: string; fixtures: Fixture[]; bracketFixtures?: Fixture[] }[] = [];
    const n = participants.length;

    // Calculate number of rounds needed
    const totalRounds = Math.ceil(Math.log2(n));
    const perfectBracketSize = Math.pow(2, totalRounds);

    // Reorder for proper bracket seeding (1v8, 4v5, 2v7, 3v6 pattern)
    const seededParticipants = this.seedBracket(
      participants,
      perfectBracketSize,
    );

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
          startTime: new Date(currentTime),
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
            startTime: new Date(currentTime),
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
            startTime: new Date(currentTime),
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
        rounds.push({ round, roundName, fixtures: allRoundFixtures, bracketFixtures });
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
              f => f.round === currentBracket[i].round &&
                   f.matchNumber === currentBracket[i].matchNumber + 1 &&
                   f.id !== currentBracket[i].id
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
      for (let i = 0; i < round.bracketFixtures.length; i++) {
        const fixture = round.bracketFixtures[i];
        const targetFixture = fixturesToInsert.find(f => f.id === fixture.id);

        const hasHome = !!targetFixture.homeTeamId;
        const hasAway = !!targetFixture.awayTeamId;

        if (hasHome !== hasAway) {
          // XOR: Only one team exists
          const winnerId = hasHome ? targetFixture.homeTeamId : targetFixture.awayTeamId;

          // 1. Mark current fixture as COMPLETED
          targetFixture.status = 'COMPLETED';
          targetFixture.homeScore = hasHome ? 3 : 0; // Award 3-0 win for walkover
          targetFixture.awayScore = hasAway ? 3 : 0;

          // 2. Advance winner to next fixture
          if (targetFixture.nextFixtureId) {
            // Determine feed direction correctly using index in bracket layout
            const isHomeFeed = i % 2 === 0;
            const nextTarget = fixturesToInsert.find(f => f.id === targetFixture.nextFixtureId);
            
            if (nextTarget) {
              if (isHomeFeed) {
                nextTarget.homeTeamId = winnerId;
                nextTarget.homeTeamPlaceholder = null;
              } else {
                nextTarget.awayTeamId = winnerId;
                nextTarget.awayTeamPlaceholder = null;
              }

              // For two-legged knockouts, also update Leg 2 of the next round (swapped position)
              if (tournament.twoLegsKnockout && nextTarget.roundName?.includes('Leg 1')) {
                 const leg2OfNext = fixturesToInsert.find(
                   f => f.round === nextTarget.round &&
                        f.matchNumber === nextTarget.matchNumber + 1
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
      doubleRoundRobin?: boolean;
    },
  ) {
    const numGroups = Math.max(1, options.numberOfGroups);
    // const groups: any[] = [];
    const groupNames = Array.from(
      { length: numGroups },
      (_, i) => `Group ${String.fromCharCode(65 + i)}`,
    ); // Group A, Group B, etc.

    // create or find existing groups
    // For now, let's just create new groups.
    const createdGroups: Group[] = [];
    for (const name of groupNames) {
      const group = await this.db.group.create({
        data: {
          name,
          tournament_id: tournament.id,
        },
      });
      createdGroups.push(group);
    }

    // Distribute participants into groups (simple round robin distribution)
    // 1->A, 2->B, 3->C, 4->D, 5->A...
    const distributedParticipants: Participant[][] = Array.from(
      { length: numGroups },
      () => [],
    );

    for (let i = 0; i < participants.length; i++) {
      const groupIndex = i % numGroups;
      const participant = participants[i];

      // Update participant with group ID
      await this.db.participant.update({
        where: { id: participant.id },
        data: { groupId: createdGroups[groupIndex].id },
      });

      distributedParticipants[groupIndex].push(participant);
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

    for (let g = 0; g < numGroups; g++) {
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
              startTime: new Date(currentTime),
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
    if (options.doubleRoundRobin) {
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
            startTime: new Date(currentTime),
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
    const rounds: { round: number; roundName: string; fixtures: Fixture[] }[] = [];
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
          startTime: new Date(currentTime),
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
    if (options.doubleRoundRobin) {
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
            startTime: new Date(currentTime),
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

    // Calculate start time for second leg
    const lastFixtureTime =
      allFirstLegFixtures.length > 0
        ? new Date(
            allFirstLegFixtures[allFirstLegFixtures.length - 1].startTime!,
          )
        : new Date(options.startDate);

    const secondLegStartTime = new Date(
      lastFixtureTime.getTime() + options.intervalMinutes * 60 * 1000,
    );

    // Second leg (reverse home/away) - grouped by rounds
    const secondLegRounds: {
      round: number;
      roundName: string;
      fixtures: Fixture[];
    }[] = [];
    let matchNumber = allFirstLegFixtures.length + 1;
    let currentTime = secondLegStartTime;
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
          startTime: new Date(currentTime),
          homeTeamId: firstLegFixture.awayTeamId, // Swap home/away
          awayTeamId: firstLegFixture.homeTeamId,
          status: 'SCHEDULED',
        };

        fixturesToInsert.push(fixtureData);
        roundFixtures.push(fixtureData as unknown as Fixture);
        
        currentTime = new Date(
          currentTime.getTime() + options.intervalMinutes * 60 * 1000,
        );
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
    const participants = await this.db.participant.findMany({
      where: {
        tournament_id: tournament.id,
        status: 'CONFIRMED',
      },
      include: { group: true },
    });

    for (const participant of participants) {
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
            group: participant.group?.name,
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

  // Friendly match generation - Pair up participants for single matches
  private async generateFriendlyFixtures(
    tournament: Tournament,
    participants: Participant[],
    options: { startDate: Date; intervalMinutes: number },
  ) {
    const rounds: { round: number; roundName: string; fixtures: Fixture[] }[] = [];
    const roundFixtures: Fixture[] = [];
    const fixturesToInsert: any[] = [];

    let matchNumber = 1;
    let currentTime = new Date(options.startDate);

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
        startTime: new Date(currentTime),
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
}
