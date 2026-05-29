import { Injectable, OnModuleDestroy, OnModuleInit, Logger } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;
  private isConnected = false;

  onModuleInit() {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    this.logger.log(`Connecting to Redis at: ${redisUrl}`);

    try {
      this.client = new Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        // Quietly try to reconnect but don't blow up the app if it fails
        retryStrategy: (times) => {
          const delay = Math.min(times * 200, 5000);
          return delay;
        },
      });

      this.client.on('connect', () => {
        this.isConnected = true;
        this.logger.log('Successfully connected to Redis!');
      });

      this.client.on('error', (err) => {
        this.isConnected = false;
        this.logger.warn('Redis is offline or encountered a connection error. Caching will be disabled.');
      });
    } catch (err) {
      this.logger.error('Failed to initialize Redis client:', err);
      this.client = null;
      this.isConnected = false;
    }
  }

  async get<T>(key: string): Promise<T | null> {
    if (!this.client || !this.isConnected) {
      return null;
    }
    try {
      const data = await this.client.get(key);
      if (!data) return null;
      return JSON.parse(data) as T;
    } catch (err) {
      this.logger.error(`Error reading key "${key}" from Redis:`, err);
      return null;
    }
  }

  async set(key: string, value: any, ttlSeconds?: number): Promise<void> {
    if (!this.client || !this.isConnected) {
      return;
    }
    try {
      const data = JSON.stringify(value);
      if (ttlSeconds) {
        await this.client.set(key, data, 'EX', ttlSeconds);
      } else {
        await this.client.set(key, data);
      }
    } catch (err) {
      this.logger.error(`Error writing key "${key}" to Redis:`, err);
    }
  }

  async del(key: string): Promise<void> {
    if (!this.client || !this.isConnected) {
      return;
    }
    try {
      await this.client.del(key);
    } catch (err) {
      this.logger.error(`Error deleting key "${key}" from Redis:`, err);
    }
  }

  async delPattern(pattern: string): Promise<void> {
    if (!this.client || !this.isConnected) {
      return;
    }
    try {
      const keys = await this.client.keys(pattern);
      if (keys && keys.length > 0) {
        await this.client.del(...keys);
      }
    } catch (err) {
      this.logger.error(`Error deleting pattern "${pattern}" from Redis:`, err);
    }
  }

  onModuleDestroy() {
    if (this.client) {
      this.client.disconnect();
    }
  }
}
