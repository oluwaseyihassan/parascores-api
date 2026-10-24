import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import { CreatePredictionDto } from './dto/create-prediction.dto';
import { ResponseUtil } from 'src/utils/api-response';

@Injectable()
export class PredictionsService {
  constructor(private readonly db: DatabaseService) {}

  async createOrUpdate(userId: string, dto: CreatePredictionDto) {
    const fixture = await this.db.fixture.findUnique({
      where: { id: dto.fixtureId },
      include: { tournament: true },
    });

    if (!fixture) {
      throw new NotFoundException('Fixture not found');
    }

    const predictionConfig = (fixture.tournament?.scoringRules as any)?.prediction;
    if (!predictionConfig || predictionConfig.enabled !== true) {
      throw new BadRequestException('Predictions are not enabled for this tournament.');
    }

    if (fixture.status !== 'SCHEDULED') {
      throw new BadRequestException('Predictions are locked because the match has already started or ended.');
    }

    if (fixture.startTime && new Date(fixture.startTime).getTime() <= Date.now()) {
      throw new BadRequestException('Predictions are locked as the match has already kicked off.');
    }

    const prediction = await this.db.prediction.upsert({
      where: {
        userId_fixtureId: {
          userId,
          fixtureId: dto.fixtureId,
        },
      },
      update: {
        homeScore: dto.homeScore,
        awayScore: dto.awayScore,
        tournamentId: dto.tournamentId,
      },
      create: {
        userId,
        fixtureId: dto.fixtureId,
        tournamentId: dto.tournamentId,
        homeScore: dto.homeScore,
        awayScore: dto.awayScore,
      },
      include: {
        user: { select: { id: true, name: true, picture: true } },
      },
    });

    return ResponseUtil.success(prediction, 'Prediction saved successfully');
  }

  async getTournamentPredictions(tournamentId: string) {
    const predictions = await this.db.prediction.findMany({
      where: { tournamentId },
      include: {
        user: { select: { id: true, name: true, picture: true } },
      },
    });
    return ResponseUtil.success(predictions);
  }

  async getFixturePredictions(fixtureId: string) {
    const predictions = await this.db.prediction.findMany({
      where: { fixtureId },
      include: {
        user: { select: { id: true, name: true, picture: true } },
      },
    });
    return ResponseUtil.success(predictions);
  }

  async evaluateFixturePredictions(fixtureId: string) {
    const fixture = await this.db.fixture.findUnique({
      where: { id: fixtureId },
      include: { tournament: true },
    });

    if (!fixture || fixture.status !== 'COMPLETED') return;

    const scoringRules = (fixture.tournament?.scoringRules as any)?.prediction || {};
    const exactPts = Number(scoringRules.exactScorePoints ?? 3);
    const outcomePts = Number(scoringRules.correctResultPoints ?? 1);

    const actualHome = fixture.homeScore ?? 0;
    const actualAway = fixture.awayScore ?? 0;
    const actualDiff = actualHome - actualAway;
    const actualResult = Math.sign(actualDiff);

    const predictions = await this.db.prediction.findMany({
      where: { fixtureId },
    });

    for (const pred of predictions) {
      let points = 0;
      let status = 'INCORRECT';

      if (pred.homeScore === actualHome && pred.awayScore === actualAway) {
        points = exactPts;
        status = 'EXACT';
      } else {
        const predDiff = pred.homeScore - pred.awayScore;
        const predResult = Math.sign(predDiff);
        if (predResult === actualResult) {
          points = outcomePts;
          status = 'CORRECT_RESULT';
        }
      }

      await this.db.prediction.update({
        where: { id: pred.id },
        data: { points, status },
      });
    }
  }

  async getTournamentLeaderboard(tournamentId: string) {
    const predictions = await this.db.prediction.findMany({
      where: { tournamentId },
      include: {
        user: { select: { id: true, name: true, picture: true } },
      },
    });

    const userMap = new Map<string, any>();

    for (const pred of predictions) {
      if (!userMap.has(pred.userId)) {
        userMap.set(pred.userId, {
          userId: pred.userId,
          user: pred.user,
          totalPoints: 0,
          exactScoresCount: 0,
          correctResultsCount: 0,
          totalPredictions: 0,
          evaluatedPredictions: 0,
        });
      }

      const entry = userMap.get(pred.userId);
      entry.totalPredictions++;

      if (pred.status && pred.status !== 'PENDING' && pred.status !== 'VOID') {
        entry.evaluatedPredictions++;
        entry.totalPoints += pred.points ?? 0;
        if (pred.status === 'EXACT') entry.exactScoresCount++;
        else if (pred.status === 'CORRECT_RESULT') entry.correctResultsCount++;
      }
    }

    const leaderboard = Array.from(userMap.values()).map((entry) => {
      const accuracyRate =
        entry.evaluatedPredictions > 0
          ? Math.round(
              ((entry.exactScoresCount + entry.correctResultsCount) /
                entry.evaluatedPredictions) *
                100,
            )
          : 0;
      return {
        ...entry,
        accuracyRate,
      };
    });

    leaderboard.sort((a, b) => {
      if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
      if (b.exactScoresCount !== a.exactScoresCount)
        return b.exactScoresCount - a.exactScoresCount;
      if (b.accuracyRate !== a.accuracyRate) return b.accuracyRate - a.accuracyRate;
      return b.totalPredictions - a.totalPredictions;
    });

    let currentRank = 1;
    for (let i = 0; i < leaderboard.length; i++) {
      if (i > 0) {
        const prev = leaderboard[i - 1];
        const curr = leaderboard[i];
        if (
          curr.totalPoints === prev.totalPoints &&
          curr.exactScoresCount === prev.exactScoresCount &&
          curr.accuracyRate === prev.accuracyRate
        ) {
          curr.rank = prev.rank;
        } else {
          curr.rank = currentRank;
        }
      } else {
        leaderboard[i].rank = currentRank;
      }
      currentRank++;
    }

    return ResponseUtil.success(leaderboard);
  }
}
