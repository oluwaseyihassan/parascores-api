import { Module } from '@nestjs/common';
import { MatchEventsService } from './match-events.service';
import { MatchEventsController } from './match-events.controller';
import { DatabaseModule } from 'src/database/database.module';
import { FixturesModule } from 'src/fixtures/fixtures.module';
import { OrganizationsModule } from 'src/organizations/organizations.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PulseModule } from '../pulse/pulse.module';

@Module({
  imports: [
    DatabaseModule,
    FixturesModule,
    OrganizationsModule,
    NotificationsModule,
    PulseModule,
  ],
  controllers: [MatchEventsController],
  providers: [MatchEventsService],
})
export class MatchEventsModule {}
