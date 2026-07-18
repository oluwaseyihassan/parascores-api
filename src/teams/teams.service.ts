import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import { ResponseUtil } from 'src/utils/api-response';
import { CreateTeamDto } from './dto/create-team.dto';
import { UpdateTeamDto } from './dto/update-team.dto';

@Injectable()
export class TeamsService {
  constructor(private readonly db: DatabaseService) {}

  async createTeam(dto: CreateTeamDto, userId?: string) {
    const team = await this.db.team.create({
      data: {
        name: dto.name,
        logoUrl: dto.logoUrl,
        ownerId: userId || null,
      },
    });
    return ResponseUtil.success(team);
  }

  async getMyTeams(userId: string) {
    const teams = await this.db.team.findMany({
      where: { ownerId: userId },
      orderBy: { created_at: 'desc' },
    });
    return ResponseUtil.success(teams);
  }

  async searchTeams(query?: string) {
    const teams = await this.db.team.findMany({
      where: query
        ? {
            name: { contains: query, mode: 'insensitive' },
          }
        : {},
      orderBy: { name: 'asc' },
      take: 20,
    });
    return ResponseUtil.success(teams);
  }

  async getTeamById(id: string, userId: string) {
    const team = await this.db.team.findUnique({
      where: { id },
    });

    if (!team) {
      throw new NotFoundException('Team not found');
    }

    if (team.ownerId !== userId) {
      throw new ForbiddenException(
        'You do not have access to this team profile',
      );
    }

    return ResponseUtil.success(team);
  }

  async getPublicTeamProfile(id: string) {
    const team = await this.db.team.findUnique({
      where: { id },
      include: {
        participants: {
          include: {
            tournament: {
              select: {
                id: true,
                name: true,
                customName: true,
                logoUrl: true,
                start_date: true,
                end_date: true,
                sport: true,
                type: true,
              },
            },
            standings: true,
          },
          orderBy: { created_at: 'desc' },
        },
      },
    });

    if (!team) throw new NotFoundException('Team not found');

    return ResponseUtil.success(team);
  }

  async updateTeam(id: string, dto: UpdateTeamDto, userId: string) {
    const team = await this.db.team.findUnique({ where: { id } });

    if (!team) throw new NotFoundException('Team not found');
    if (team.ownerId !== userId) throw new ForbiddenException('Not authorized');

    const updated = await this.db.team.update({
      where: { id },
      data: dto,
    });

    // Sync all linked participants in active and upcoming tournaments
    // (We include all participants to ensure consistency as requested)
    try {
      await this.db.participant.updateMany({
        where: { team_id: id },
        data: {
          customName: dto.name,
          logoUrl: dto.logoUrl,
        },
      });
    } catch (error) {
      console.error(
        `Failed to sync team updates to participants for team ${id}:`,
        error,
      );
    }

    return ResponseUtil.success(updated);
  }

  async claimParticipant(teamId: string, code: string, userId: string) {
    const team = await this.db.team.findUnique({ where: { id: teamId } });
    if (!team) throw new NotFoundException('Team profile not found');
    if (team.ownerId !== userId)
      throw new ForbiddenException(
        'You are not the owner of this team profile',
      );

    const participant = await this.db.participant.findUnique({
      where: { linkCode: code.toUpperCase() },
    });

    if (!participant) {
      throw new NotFoundException('Invalid claim code');
    }

    if (
      participant.linkCodeExpires &&
      participant.linkCodeExpires < new Date()
    ) {
      throw new ForbiddenException('Claim code has expired');
    }

    if (participant.team_id) {
      throw new ForbiddenException(
        'This participant is already linked to a team profile',
      );
    }

    const updatedParticipant = await this.db.participant.update({
      where: { id: participant.id },
      data: {
        team_id: team.id,
        linkCode: null,
        linkCodeExpires: null,
        customName: team.name,
        logoUrl: team.logoUrl,
      },
    });

    return ResponseUtil.success(
      updatedParticipant,
      'Team profile linked successfully',
    );
  }

  async deleteTeam(id: string, userId: string) {
    const team = await this.db.team.findUnique({ where: { id } });

    if (!team) throw new NotFoundException('Team not found');
    if (team.ownerId !== userId) throw new ForbiddenException('Not authorized');

    // Check if team is active in any ongoing tournaments
    const activeParticipation = await this.db.participant.findFirst({
      where: {
        team_id: id,
        tournament: {
          end_date: { gte: new Date() },
        },
      },
    });

    if (activeParticipation) {
      throw new ForbiddenException(
        'This team profile cannot be deleted because it is currently registered in an active tournament. Please withdraw from the tournament first.',
      );
    }

    await this.db.team.delete({ where: { id } });
    return ResponseUtil.success({
      message: 'Team profile deleted successfully',
    });
  }
}
