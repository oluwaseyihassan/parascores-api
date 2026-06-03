import { Module } from '@nestjs/common';
import { DatabaseModule } from 'src/database/database.module';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { NotificationListener } from './notification.listener';

@Module({
  imports: [DatabaseModule],
  providers: [NotificationsService, NotificationListener],
  controllers: [NotificationsController],
  exports: [NotificationsService],
})
export class NotificationsModule {}
