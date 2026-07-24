import { Module } from '@nestjs/common';
import { HighlightsService } from './highlights.service';
import { HighlightsController } from './highlights.controller';
import { OrganizationsModule } from 'src/organizations/organizations.module';

@Module({
  imports: [OrganizationsModule],
  controllers: [HighlightsController],
  providers: [HighlightsService],
  exports: [HighlightsService],
})
export class HighlightsModule {}
