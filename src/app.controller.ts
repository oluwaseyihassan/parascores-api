import { Controller, Get, Post, Body } from '@nestjs/common';
import { Public } from './auth/decorators/public.decorator';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  home(): string {
    return this.appService.home();
  }

  @Get('health')
  getHealth() {
    return this.appService.getHealth();
  }

  @Public()
  @Post('contact')
  async submitContactForm(
    @Body()
    dto: {
      name: string;
      email: string;
      subject: string;
      message: string;
    },
  ) {
    return this.appService.handleContactForm(dto);
  }
}
