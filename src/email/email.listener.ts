import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EmailService } from './email.service';
import {
  EmailEvents,
  UserSignupPayload,
  UserEmailVerifiedPayload,
  UserPasswordResetPayload,
  UserOAuthPasswordResetPayload,
  UserGoogleSignupPayload,
  TeamJoinRequestPayload,
  TeamJoinApprovalPayload,
  TeamJoinRejectionPayload,
} from './email.events';

@Injectable()
export class EmailListener {
  constructor(private readonly emailService: EmailService) {}

  @OnEvent(EmailEvents.USER_SIGNUP, { async: true })
  async handleUserSignup(payload: UserSignupPayload) {
    try {
      await this.emailService.sendVerificationEmail(
        payload.email,
        payload.verificationToken,
        payload.name,
      );
    } catch (error) {
      console.error('Failed to send verification email:', error);
    }

    try {
      await this.emailService.sendNewUserAlertEmail(
        payload.email,
        payload.name,
      );
    } catch (error) {
      console.error('Failed to send new user alert:', error);
    }
  }

  @OnEvent(EmailEvents.USER_EMAIL_VERIFIED, { async: true })
  async handleEmailVerified(payload: UserEmailVerifiedPayload) {
    try {
      await this.emailService.sendWelcomeEmail(payload.email, payload.name);
    } catch (error) {
      console.error('Failed to send welcome email:', error);
    }
  }

  @OnEvent(EmailEvents.USER_PASSWORD_RESET, { async: true })
  async handlePasswordReset(payload: UserPasswordResetPayload) {
    try {
      await this.emailService.sendPasswordResetEmail(
        payload.email,
        payload.resetToken,
        payload.name,
      );
    } catch (error) {
      console.error('Failed to send password reset email:', error);
    }
  }

  @OnEvent(EmailEvents.USER_OAUTH_PASSWORD_RESET, { async: true })
  async handleOAuthPasswordReset(payload: UserOAuthPasswordResetPayload) {
    try {
      await this.emailService.sendOAuthPasswordResetEmail(
        payload.email,
        payload.name,
      );
    } catch (error) {
      console.error('Failed to send OAuth password reset alert email:', error);
    }
  }

  @OnEvent(EmailEvents.USER_GOOGLE_SIGNUP, { async: true })
  async handleGoogleSignup(payload: UserGoogleSignupPayload) {
    try {
      await this.emailService.sendWelcomeEmail(payload.email, payload.name);
    } catch (error) {
      console.error('Failed to send welcome email:', error);
    }

    try {
      await this.emailService.sendNewUserAlertEmail(
        payload.email,
        payload.name,
      );
    } catch (error) {
      console.error('Failed to send new user alert:', error);
    }
  }

  @OnEvent(EmailEvents.TEAM_JOIN_REQUEST, { async: true })
  async handleTeamJoinRequest(payload: TeamJoinRequestPayload) {
    try {
      await this.emailService.sendPlayerJoinRequestAlert(
        payload.organizerEmail,
        payload.organizerName,
        payload.playerName,
        payload.teamName,
        payload.tournamentName,
      );
    } catch (error) {
      console.error('Failed to send player join request email:', error);
    }
  }

  @OnEvent(EmailEvents.TEAM_JOIN_APPROVAL, { async: true })
  async handleTeamJoinApproval(payload: TeamJoinApprovalPayload) {
    try {
      await this.emailService.sendPlayerJoinApprovalAlert(
        payload.playerEmail,
        payload.playerName,
        payload.teamName,
        payload.tournamentName,
        payload.customName,
      );
    } catch (error) {
      console.error('Failed to send player join approval email:', error);
    }
  }

  @OnEvent(EmailEvents.TEAM_JOIN_REJECTION, { async: true })
  async handleTeamJoinRejection(payload: TeamJoinRejectionPayload) {
    try {
      await this.emailService.sendPlayerJoinRejectionAlert(
        payload.playerEmail,
        payload.playerName,
        payload.teamName,
        payload.tournamentName,
      );
    } catch (error) {
      console.error('Failed to send player join rejection email:', error);
    }
  }
}
