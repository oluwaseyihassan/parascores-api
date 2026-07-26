import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AuditLogsModule } from 'src/audit-logs/audit-logs.module';

@Module({
  imports: [AuditLogsModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
