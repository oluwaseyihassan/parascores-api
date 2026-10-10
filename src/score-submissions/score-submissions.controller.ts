import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Public } from 'src/auth/decorators/public.decorator';
import { jwtConstants } from 'src/auth/constants';
import { ResponseUtil } from 'src/utils/api-response';
import { ScoreSubmissionsService } from './score-submissions.service';
import {
  CreateScoreSubmissionDto,
  ResolveDisputeDto,
} from './dto/score-submission.dto';

@ApiTags('score-submissions')
@Controller()
export class ScoreSubmissionsController {
  constructor(
    private readonly submissions: ScoreSubmissionsService,
    private readonly jwt: JwtService,
  ) {}

  private async optionalUserId(req: Request): Promise<string | null> {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ')
      ? header.slice(7)
      : req.cookies?.access_token;
    if (!token) return null;
    try {
      const payload = await this.jwt.verifyAsync(token, { secret: jwtConstants.secret });
      return payload.sub ?? null;
    } catch {
      return null;
    }
  }

  @Post('fixtures/:fixtureId/score-submissions')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Submit (or edit) your score entry for a fixture — double-entry' })
  async submit(
    @Param('fixtureId') fixtureId: string,
    @Req() req: any,
    @Body() dto: CreateScoreSubmissionDto,
  ) {
    const result = await this.submissions.submit(fixtureId, req.user.sub, dto);
    return ResponseUtil.success(result, 'Score submitted');
  }

  @Public()
  @Get('fixtures/:fixtureId/score-submissions')
  @ApiOperation({ summary: 'Read both entries + submission state (participants + organizers)' })
  async getForFixture(@Param('fixtureId') fixtureId: string, @Req() req: Request) {
    const userId = await this.optionalUserId(req);
    const data = await this.submissions.getForFixture(fixtureId, userId);
    return ResponseUtil.success(data, 'Score submissions retrieved');
  }

  @Get('tournaments/:tournamentId/score-disputes')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Open score conflicts for a tournament (org moderation)' })
  async listDisputes(@Param('tournamentId') tournamentId: string, @Req() req: any) {
    const data = await this.submissions.listDisputes(tournamentId, req.user.sub);
    return ResponseUtil.success(data, 'Score disputes retrieved');
  }

  @Post('fixtures/:fixtureId/score-submissions/resolve')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Resolve a score conflict — accept an entry or set the correct score (org)' })
  async resolve(
    @Param('fixtureId') fixtureId: string,
    @Req() req: any,
    @Body() dto: ResolveDisputeDto,
  ) {
    const data = await this.submissions.resolve(fixtureId, req.user.sub, dto);
    return ResponseUtil.success(data, 'Result applied');
  }

  @Post('fixtures/:fixtureId/score-submissions/dismiss')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Dismiss a score conflict — void both entries (org)' })
  async dismiss(@Param('fixtureId') fixtureId: string, @Req() req: any) {
    const data = await this.submissions.dismiss(fixtureId, req.user.sub);
    return ResponseUtil.success(data, 'Conflict dismissed');
  }
}
