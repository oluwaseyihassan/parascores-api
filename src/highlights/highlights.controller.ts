import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Request } from 'express';
import { Public } from 'src/auth/decorators/public.decorator';
import { HighlightsService } from './highlights.service';
import { CreateHighlightDto } from './dto/create-highlight.dto';

interface AuthenticatedRequest extends Request {
  user: { sub: string };
}

@ApiTags('highlights')
@Controller('highlights')
export class HighlightsController {
  constructor(private readonly highlightsService: HighlightsService) {}

  @Post('fixture/:fixtureId')
  @ApiOperation({ summary: 'Add a highlight to a fixture' })
  create(
    @Param('fixtureId') fixtureId: string,
    @Body() createHighlightDto: CreateHighlightDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.highlightsService.create(
      fixtureId,
      req.user.sub,
      createHighlightDto,
    );
  }

  @Public()
  @Get('fixture/:fixtureId')
  @ApiOperation({ summary: 'Get all highlights for a fixture' })
  findAllByFixture(@Param('fixtureId') fixtureId: string) {
    return this.highlightsService.findAllByFixture(fixtureId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove a highlight' })
  remove(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.highlightsService.remove(id, req.user.sub);
  }
}
