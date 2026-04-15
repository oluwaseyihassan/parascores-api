import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Set global prefix
  app.setGlobalPrefix('api');

  // Set global cors
  app.enableCors({
    origin: [
      'http://localhost:3001', // Localhost Frontend
      'http://lvh.me:3001', // Main Site Frontend
      'http://app.lvh.me:3001', // 🟢 Dashboard Frontend (MISSING BEFORE)
      'https://parascores.com', // Production Main
      'https://www.parascores.com', // Production Main (www)
      'https://app.parascores.com', // Production Dashboard
      'https://parascores-web.vercel.app',
      'http://manage.lvh.me:3001',
      'https://manage.parascores.com',
    ],
    credentials: true, // Required for cookies to work
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Origin', 'Accept'],
  });

  app.use(cookieParser());

// Set global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  // SWAGGER SETUP
  const config = new DocumentBuilder()
    .setTitle('ParaScores API')
    .setDescription('ParaScores API documentation')
    .setVersion('1.0')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document, {
    customfavIcon: 'https://res.cloudinary.com/djsnerfzp/image/upload/q_auto/f_auto/v1776229862/Screenshot_2026-04-15_060233_wexzxq.png',
    customSiteTitle: 'ParaScores API',
    customCss: `
      .swagger-ui .topbar { background-color: #16a34a; }
      .swagger-ui .topbar-wrapper a span { display: none; }
      .swagger-ui .topbar-wrapper a::before {
        content: '';
        display: inline-block;
        background-image: url('https://res.cloudinary.com/djsnerfzp/image/upload/q_auto/f_auto/v1776229862/Screenshot_2026-04-15_060233_wexzxq.png');
        background-size: contain;
        background-repeat: no-repeat;
        width: 40px;
        height: 40px;
      }
    `,
  });

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
