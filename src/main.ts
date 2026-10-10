import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
// import './instrument';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });

  // Set global prefix
  app.setGlobalPrefix('api');

  // Set global cors
  app.enableCors({
    origin: (origin, callback) => {
      const allowedOrigins = [
        'http://localhost:3001', // Localhost Frontend
        'https://parascores-web.vercel.app',
      ];
      // Allow the base domains and ANY subdomain (event hubs are dynamic slugs)
      const dynamicPatterns = [
        /^http:\/\/([a-z0-9-]+\.)*lvh\.me:3001$/, // local: lvh.me + subdomains
        /^https:\/\/([a-z0-9-]+\.)*parascores\.com(:\d+)?$/, // prod + subdomains
      ];
      if (
        !origin || // non-browser clients (curl, server-to-server)
        allowedOrigins.includes(origin) ||
        dynamicPatterns.some((re) => re.test(origin))
      ) {
        callback(null, true);
      } else {
        callback(new Error(`Origin ${origin} not allowed by CORS`));
      }
    },
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
  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('ParaScores API')
      .setDescription('ParaScores API documentation')
      .setVersion('1.0')
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api-docs', app, document, {
      customfavIcon:
        'https://res.cloudinary.com/djsnerfzp/image/upload/q_auto/f_auto/v1780327900/parascores-logo.png',
      customSiteTitle: 'ParaScores API',
      customCss: `
        .swagger-ui .topbar { background-color: #16a34a; }
        .swagger-ui .topbar-wrapper a span { display: none; }
        .swagger-ui .topbar-wrapper a::before {
          content: '';
          display: inline-block;
          background-image: url('https://res.cloudinary.com/djsnerfzp/image/upload/q_auto/f_auto/v1780327900/parascores-logo.png');
          background-size: contain;
          background-repeat: no-repeat;
          width: 40px;
          height: 40px;
        }
      `,
    });
  }

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
