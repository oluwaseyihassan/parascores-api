import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Request } from 'express';
import { Public } from 'src/auth/decorators/public.decorator';
import { PredictionsService } from './predictions.service';
import { CreatePredictionDto } from './dto/create-prediction.dto';

interface AuthenticatedRequest extends Request {
  user: { sub: string };
}

@ApiTags('predictions')
@Controller('predictions')
export class PredictionsController {
  constructor(private readonly predictionsService: PredictionsService) {}

  @Post()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Submit or update a match score prediction' })
  async createOrUpdate(
    @Body() dto: CreatePredictionDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.predictionsService.createOrUpdate(req.user.sub, dto);
  }

  @Public()
  @Get('tournament/:tournamentId')
  @ApiOperation({ summary: 'Get all predictions for a tournament' })
  async getTournamentPredictions(@Param('tournamentId') tournamentId: string) {
    return this.predictionsService.getTournamentPredictions(tournamentId);
  }

  @Public()
  @Get('fixture/:fixtureId')
  @ApiOperation({ summary: 'Get all predictions for a specific fixture' })
  async getFixturePredictions(@Param('fixtureId') fixtureId: string) {
    return this.predictionsService.getFixturePredictions(fixtureId);
  }

  @Public()
  @Get('leaderboard/:tournamentId')
  @ApiOperation({ summary: 'Get the prediction leaderboard for a tournament' })
  async getTournamentLeaderboard(@Param('tournamentId') tournamentId: string) {
    return this.predictionsService.getTournamentLeaderboard(tournamentId);
  }
}
