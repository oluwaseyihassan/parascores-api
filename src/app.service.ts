import { Injectable } from '@nestjs/common';
import { DatabaseService } from './database/database.service';

@Injectable()
export class AppService {
  constructor(private readonly databaseService: DatabaseService) {}

  home(): string {
    return 'Welcome to ParaScores API!';
  }

  async getHealth() {
    try {
      // Simple query to check database connectivity
      await this.databaseService.$queryRaw`SELECT 1`;
      return {
        status: 'ok',
        database: 'up',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        status: 'error',
        database: 'down',
        message: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }
}
