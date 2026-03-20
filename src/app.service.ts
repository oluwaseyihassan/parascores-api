import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { DatabaseService } from './database/database.service';
import { EmailService } from './email/email.service';

@Injectable()
export class AppService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly emailService: EmailService,
  ) {}

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

  async handleContactForm(dto: {
    name: string;
    email: string;
    subject: string;
    message: string;
  }) {
    try {
      await this.emailService.sendContactEmail(
        dto.name,
        dto.email,
        dto.subject,
        dto.message,
      );
      return { success: true, message: 'Message sent successfully.' };
    } catch (error) {
      throw new InternalServerErrorException('Failed to process contact form.');
    }
  }
}
