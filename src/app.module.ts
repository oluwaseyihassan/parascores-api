import { Module } from '@nestjs/common';
import { EmailModule } from './email/email.module';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AuthGuard } from './auth/auth.guard';
import { RolesGuard } from './auth/roles.guard';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { DatabaseModule } from './database/database.module';
import { TournamentsModule } from './tournaments/tournaments.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { FixturesModule } from './fixtures/fixtures.module';
import { UploadModule } from './upload/upload.module';
import { SponsorsModule } from './sponsors/sponsors.module';
import { SocialsModule } from './socials/socials.module';
import { ParticipantsModule } from './participants/participants.module';
import { PlayersModule } from './players/players.module';
import { MatchEventsModule } from './match-events/match-events.module';
import { HighlightsModule } from './highlights/highlights.module';
import { StandingsModule } from './standings/standings.module';
import { VenuesModule } from './venues/venues.module';
import { TeamInvitesModule } from './team-invites/team-invites.module';
import { GroupsModule } from './groups/groups.module';
import { TournamentInvitesModule } from './tournament-invites/tournament-invites.module';
import { TeamsModule } from './teams/teams.module';
import { PaymentsModule } from './payments/payments.module';
import { AdminModule } from './admin/admin.module';
import { RedisModule } from './redis/redis.module';
import { NotificationsModule } from './notifications/notifications.module';
// import { SentryModule } from '@sentry/nestjs/setup';
// import { SentryGlobalFilter } from '@sentry/nestjs/setup';
import { APP_FILTER } from '@nestjs/core';
@Module({
  imports: [
    // SentryModule.forRoot(),
    // Rate limiting - default: 100 requests per 60 seconds
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60000, // 60 seconds in milliseconds
        limit: 100,
      },
    ]),
    EventEmitterModule.forRoot(),
    AuthModule,
    UsersModule,
    DatabaseModule,
    TournamentsModule,
    OrganizationsModule,
    FixturesModule,
    UploadModule,
    SponsorsModule,
    SocialsModule,
    ParticipantsModule,
    PlayersModule,
    MatchEventsModule,
    HighlightsModule,
    StandingsModule,
    EmailModule,
    VenuesModule,
    TeamInvitesModule,
    GroupsModule,
    TournamentInvitesModule,
    TeamsModule,
    PaymentsModule,
    AdminModule,
    RedisModule,
    NotificationsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    /*
    {
      provide: APP_FILTER,
      useClass: SentryGlobalFilter,
    },
    */
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
