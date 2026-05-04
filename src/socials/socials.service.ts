import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import { ResponseUtil } from 'src/utils/api-response';
import { AddSocialDto, UpdateSocialDto } from 'src/socials/dto/add-social.dto';

@Injectable()
export class SocialsService {
  constructor(private readonly db: DatabaseService) {}

  // Add a social link to a tournament
  async addSocial(tournamentId: string, dto: AddSocialDto) {
    const tournament = await this.db.tournament.findFirst({
      where: { OR: [{ id: tournamentId }, { customName: tournamentId }] },
    });

    if (!tournament) {
      throw new NotFoundException('Tournament not found');
    }

    const social = await this.db.social.create({
      data: {
        platform: dto.platform,
        url: dto.url,
        handle: dto.handle,
        tournament_id: tournament.id,
      },
    });

    return ResponseUtil.success(social);
  }

  // Get all socials for a tournament
  async getSocials(tournamentId: string) {
    const tournament = await this.db.tournament.findFirst({
      where: { OR: [{ id: tournamentId }, { customName: tournamentId }] },
    });

    if (!tournament) {
      throw new NotFoundException('Tournament not found');
    }

    const socials = await this.db.social.findMany({
      where: { tournament_id: tournament.id },
      orderBy: { created_at: 'asc' },
    });

    return ResponseUtil.success(socials);
  }

  // Add a social link to an organization
  async addOrganizationSocial(organizationId: string, dto: AddSocialDto) {
    const organization = await this.db.organization.findUnique({
      where: { id: organizationId },
    });

    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    const social = await this.db.social.create({
      data: {
        platform: dto.platform,
        url: dto.url,
        handle: dto.handle,
        organization_id: organization.id,
      },
    });

    return ResponseUtil.success(social);
  }

  // Get all socials for an organization
  async getOrganizationSocials(organizationId: string) {
    const organization = await this.db.organization.findUnique({
      where: { id: organizationId },
    });

    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    const socials = await this.db.social.findMany({
      where: { organization_id: organization.id },
      orderBy: { created_at: 'asc' },
    });

    return ResponseUtil.success(socials);
  }

  // Update a social
  async updateSocial(socialId: string, dto: UpdateSocialDto) {
    const social = await this.db.social.findUnique({
      where: { id: socialId },
    });

    if (!social) {
      throw new NotFoundException('Social not found');
    }

    const updated = await this.db.social.update({
      where: { id: socialId },
      data: {
        ...(dto.platform && { platform: dto.platform }),
        ...(dto.url && { url: dto.url }),
        ...(dto.handle !== undefined && { handle: dto.handle }),
      },
    });

    return ResponseUtil.success(updated);
  }

  // Remove a social
  async removeSocial(socialId: string) {
    const social = await this.db.social.findUnique({
      where: { id: socialId },
    });

    if (!social) {
      throw new NotFoundException('Social not found');
    }

    await this.db.social.delete({
      where: { id: socialId },
    });

    return ResponseUtil.success({ message: 'Social removed successfully' });
  }
}
