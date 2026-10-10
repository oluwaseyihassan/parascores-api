import { Module } from '@nestjs/common';
import { OrganizationsModule } from 'src/organizations/organizations.module';
import { FixturesModule } from 'src/fixtures/fixtures.module';
import { ChatModule } from 'src/chat/chat.module';
import { ScoreSubmissionsController } from './score-submissions.controller';
import { ScoreSubmissionsService } from './score-submissions.service';

@Module({
  imports: [OrganizationsModule, FixturesModule, ChatModule],
  controllers: [ScoreSubmissionsController],
  providers: [ScoreSubmissionsService],
  exports: [ScoreSubmissionsService],
})
export class ScoreSubmissionsModule {}
