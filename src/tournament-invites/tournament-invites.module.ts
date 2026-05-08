import { Module } from '@nestjs/common';
import { TournamentInvitesService } from './tournament-invites.service';
import { TournamentInvitesController } from './tournament-invites.controller';
import { DatabaseModule } from 'src/database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [TournamentInvitesController],
  providers: [TournamentInvitesService],
})
export class TournamentInvitesModule {}
