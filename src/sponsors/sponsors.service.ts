import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import { ResponseUtil } from 'src/utils/api-response';
import {
  AddSponsorDto,
  UpdateSponsorDto,
} from 'src/sponsors/dto/add-sponsor.dto';

@Injectable()
export class SponsorsService {
  constructor(private readonly db: DatabaseService) {}

  // Add a sponsor to a tournament
  async addSponsor(tournamentId: string, dto: AddSponsorDto) {
    const tournament = await this.db.tournament.findFirst({
      where: { OR: [{ id: tournamentId }, { customName: tournamentId }] },
    });

    if (!tournament) {
      throw new NotFoundException('Tournament not found');
    }

    const sponsor = await this.db.sponsor.create({
      data: {
        name: dto.name,
        logoUrl: dto.logoUrl,
        websiteUrl: dto.websiteUrl,
        tournament_id: tournament.id,
      },
    });

    return ResponseUtil.success(sponsor);
  }

  // Get all sponsors for a tournament
  async getSponsors(tournamentId: string) {
    const tournament = await this.db.tournament.findFirst({
      where: { OR: [{ id: tournamentId }, { customName: tournamentId }] },
    });

    if (!tournament) {
      throw new NotFoundException('Tournament not found');
    }

    const sponsors = await this.db.sponsor.findMany({
      where: { tournament_id: tournament.id },
      orderBy: { created_at: 'asc' },
    });

    return ResponseUtil.success(sponsors);
  }

  // Update a sponsor
  async updateSponsor(sponsorId: string, dto: UpdateSponsorDto) {
    const sponsor = await this.db.sponsor.findUnique({
      where: { id: sponsorId },
    });

    if (!sponsor) {
      throw new NotFoundException('Sponsor not found');
    }

    const updated = await this.db.sponsor.update({
      where: { id: sponsorId },
      data: {
        ...(dto.name && { name: dto.name }),
        ...(dto.logoUrl !== undefined && { logoUrl: dto.logoUrl }),
        ...(dto.websiteUrl !== undefined && { websiteUrl: dto.websiteUrl }),
      },
    });

    return ResponseUtil.success(updated);
  }

  // Remove a sponsor
  async removeSponsor(sponsorId: string) {
    const sponsor = await this.db.sponsor.findUnique({
      where: { id: sponsorId },
    });

    if (!sponsor) {
      throw new NotFoundException('Sponsor not found');
    }

    await this.db.sponsor.delete({
      where: { id: sponsorId },
    });

    return ResponseUtil.success({ message: 'Sponsor removed successfully' });
  }
}
