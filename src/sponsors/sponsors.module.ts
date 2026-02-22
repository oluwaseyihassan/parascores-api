import { Module } from '@nestjs/common';
import { SponsorsService } from './sponsors.service';
import { SponsorsController } from './sponsors.controller';

@Module({
  providers: [SponsorsService],
  controllers: [SponsorsController]
})
export class SponsorsModule {}
