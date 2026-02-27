import { Module } from '@nestjs/common';
import { StandingsService } from './standings.service';
import { StandingsController } from './standings.controller';
import { DatabaseModule } from 'src/database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [StandingsController],
  providers: [StandingsService],
  exports: [StandingsService]
})
export class StandingsModule {}
