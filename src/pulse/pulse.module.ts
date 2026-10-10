import { Module } from '@nestjs/common';
import { DatabaseModule } from 'src/database/database.module';
import { OrganizationsModule } from 'src/organizations/organizations.module';
import { PulseService } from './pulse.service';
import { PulseController } from './pulse.controller';

@Module({
  imports: [DatabaseModule, OrganizationsModule],
  controllers: [PulseController],
  providers: [PulseService],
  exports: [PulseService],
})
export class PulseModule {}
