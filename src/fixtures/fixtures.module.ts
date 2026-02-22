import { Module } from '@nestjs/common';
import { FixturesController } from './fixtures.controller';
import { FixturesService } from './fixtures.service';
import { DatabaseModule } from 'src/database/database.module';
import { FixtureGeneratorService } from './fixture-generator/fixture-generator.service';

@Module({
  imports: [DatabaseModule],
  controllers: [FixturesController],
  providers: [FixturesService, FixtureGeneratorService],
  exports: [FixturesService],
})
export class FixturesModule {}
