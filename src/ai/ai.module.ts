import { Global, Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';
import { OrganizationsModule } from 'src/organizations/organizations.module';

@Global()
@Module({
  imports: [OrganizationsModule],
  controllers: [AiController],
  providers: [AiService],
  exports: [AiService],
})
export class AiModule {}
