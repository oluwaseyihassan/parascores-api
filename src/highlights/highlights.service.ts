import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import { OrganizationsService } from 'src/organizations/organizations.service';
import { CreateHighlightDto } from './dto/create-highlight.dto';
import { ResponseUtil } from 'src/utils/api-response';
import {
  detectHighlightPlatform,
  getHighlightEmbedUrl,
  getHighlightThumbnailUrl,
  normalizeHighlightUrl,
} from './utils/highlight-platform';

@Injectable()
export class HighlightsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly organizationsService: OrganizationsService,
  ) {}

  async create(
    fixtureId: string,
    userId: string,
    createHighlightDto: CreateHighlightDto,
  ) {
    const fixture = await this.db.fixture.findUnique({
      where: { id: fixtureId },
      include: { tournament: true },
    });

    if (!fixture) {
      throw new NotFoundException('Fixture not found');
    }

    await this.assertCanManageFixture(
      userId,
      fixture.tournament.organization_id,
    );

    const normalizedUrl = normalizeHighlightUrl(createHighlightDto.externalUrl);
    if (!normalizedUrl) {
      throw new BadRequestException('Invalid highlight URL');
    }

    const detectedPlatform = detectHighlightPlatform(normalizedUrl);
    if (!detectedPlatform) {
      throw new BadRequestException(
        'Unsupported highlight URL. Only YouTube Shorts, Instagram Reels, and TikTok videos are supported.',
      );
    }

    if (createHighlightDto.platform !== detectedPlatform) {
      throw new BadRequestException(
        `URL does not match the selected platform. Detected: ${detectedPlatform}`,
      );
    }

    const embedUrl = getHighlightEmbedUrl(normalizedUrl, detectedPlatform);
    if (!embedUrl) {
      throw new BadRequestException(
        'Could not generate an embed URL from the provided link.',
      );
    }

    const thumbnailUrl =
      getHighlightThumbnailUrl(normalizedUrl, detectedPlatform) || null;

    const highlight = await this.db.highlight.create({
      data: {
        fixture_id: fixtureId,
        platform: detectedPlatform,
        externalUrl: normalizedUrl,
        embedUrl,
        thumbnailUrl,
        caption: createHighlightDto.caption || null,
        duration: createHighlightDto.duration || null,
        createdById: userId,
      },
    });

    return ResponseUtil.success(highlight, 'Highlight added successfully');
  }

  async findAllByFixture(fixtureId: string) {
    const fixture = await this.db.fixture.findUnique({
      where: { id: fixtureId },
    });

    if (!fixture) {
      throw new NotFoundException('Fixture not found');
    }

    const highlights = await this.db.highlight.findMany({
      where: { fixture_id: fixtureId },
      orderBy: { created_at: 'desc' },
    });

    return ResponseUtil.success(highlights);
  }

  async remove(id: string, userId: string) {
    const highlight = await this.db.highlight.findUnique({
      where: { id },
      include: { fixture: { include: { tournament: true } } },
    });

    if (!highlight) {
      throw new NotFoundException('Highlight not found');
    }

    await this.assertCanManageFixture(
      userId,
      highlight.fixture.tournament.organization_id,
    );

    await this.db.highlight.delete({ where: { id } });

    return ResponseUtil.success(
      { deleted: true },
      'Highlight removed successfully',
    );
  }

  private async assertCanManageFixture(
    userId: string,
    organizationId: string | null,
  ) {
    if (organizationId) {
      await this.organizationsService.validateMemberRole(
        organizationId,
        userId,
        ['OWNER', 'ADMIN', 'MEMBER'],
      );
    } else {
      throw new ForbiddenException(
        'You do not have the required permissions to perform this action.',
      );
    }
  }
}
