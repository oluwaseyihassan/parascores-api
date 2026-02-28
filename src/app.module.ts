import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { AuthGuard } from './auth/auth.guard';
import { RolesGuard } from './auth/roles.guard';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { DatabaseModule } from './database/database.module';
import { TournamentsModule } from './tournaments/tournaments.module';
import { FixturesModule } from './fixtures/fixtures.module';
import { UploadModule } from './upload/upload.module';
import { SponsorsModule } from './sponsors/sponsors.module';
import { SocialsModule } from './socials/socials.module';
import { ParticipantsModule } from './participants/participants.module';
import { PlayersModule } from './players/players.module';
import { MatchEventsModule } from './match-events/match-events.module';
import { StandingsModule } from './standings/standings.module';

@Module({
  imports: [
    // Rate limiting - default: 100 requests per 60 seconds
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60000, // 60 seconds in milliseconds
        limit: 100,
      },
    ]),
    AuthModule,
    UsersModule,
    DatabaseModule,
    TournamentsModule,
    FixturesModule,
    UploadModule,
    SponsorsModule,
    SocialsModule,
    ParticipantsModule,
    PlayersModule,
    MatchEventsModule,
    StandingsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
})
export class AppModule {}
