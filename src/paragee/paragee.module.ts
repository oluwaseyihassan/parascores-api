import { Module } from '@nestjs/common';
import { ChatModule } from 'src/chat/chat.module';
import { RedisModule } from 'src/redis/redis.module';
import { ParageeService } from './paragee.service';

@Module({
  imports: [ChatModule, RedisModule],
  providers: [ParageeService],
})
export class ParageeModule {}
