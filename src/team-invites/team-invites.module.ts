import { Module } from '@nestjs/common';
import { TeamInvitesService } from './team-invites.service';
import { TeamInvitesController } from './team-invites.controller';
import { DatabaseModule } from 'src/database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [TeamInvitesController],
  providers: [TeamInvitesService],
  exports: [TeamInvitesService],
})
export class TeamInvitesModule {}
