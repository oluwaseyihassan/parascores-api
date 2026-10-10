import { Module } from '@nestjs/common';
import { FixturesController } from './fixtures.controller';
import { FixturesService } from './fixtures.service';
import { DatabaseModule } from 'src/database/database.module';
import { FixtureGeneratorService } from './fixture-generator/fixture-generator.service';
import { OrganizationsModule } from 'src/organizations/organizations.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PulseModule } from '../pulse/pulse.module';

@Module({
  imports: [OrganizationsModule, NotificationsModule, PulseModule],
  controllers: [FixturesController],
  providers: [FixturesService, FixtureGeneratorService],
  exports: [FixturesService],
})
export class FixturesModule {}
