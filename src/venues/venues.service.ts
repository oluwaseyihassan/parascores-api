import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import { ResponseUtil } from 'src/utils/api-response';

@Injectable()
export class VenuesService {
  constructor(private readonly db: DatabaseService) {}

  // Add a venue to a tournament
  async addVenue(tournamentId: string, name: string) {
    const tournament = await this.db.tournament.findFirst({
      where: { OR: [{ id: tournamentId }, { customName: tournamentId }] },
    });

    if (!tournament) {
      throw new NotFoundException('Tournament not found');
    }

    const venue = await this.db.venue.create({
      data: {
        name,
        tournament_id: tournament.id,
      },
    });

    return ResponseUtil.success(venue);
  }

  // Get all venues for a tournament
  async getVenues(tournamentId: string) {
    const tournament = await this.db.tournament.findFirst({
      where: { OR: [{ id: tournamentId }, { customName: tournamentId }] },
    });

    if (!tournament) {
      throw new NotFoundException('Tournament not found');
    }

    const venues = await this.db.venue.findMany({
      where: { tournament_id: tournament.id },
      orderBy: { created_at: 'asc' },
    });

    return ResponseUtil.success(venues);
  }

  // Remove a venue
  async removeVenue(venueId: string) {
    const venue = await this.db.venue.findUnique({
      where: { id: venueId },
    });

    if (!venue) {
      throw new NotFoundException('Venue not found');
    }

    await this.db.venue.delete({
      where: { id: venueId },
    });

    return ResponseUtil.success({ message: 'Venue removed successfully' });
  }
}
