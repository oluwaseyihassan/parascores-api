import { Injectable } from '@nestjs/common';
import { Resend } from 'resend';
import * as handlebars from 'handlebars';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class EmailService {
  private resend: Resend;
  private readonly fromOluwaseyiEmail: string;
  private readonly fromAdminEmail: string;

  constructor() {
    this.resend = new Resend(process.env.RESEND_API_KEY);
    this.fromAdminEmail =
      process.env.EMAIL_FROM_ADMIN || 'ParaScores admin <admin@parascores.com>';
    this.fromOluwaseyiEmail =
      process.env.EMAIL_FROM_OLUWASEYI ||
      'Oluwaseyi - ParaScores <oluwaseyi@parascores.com>';
  }

  private async compileTemplate(
    templateName: string,
    context: Record<string, unknown>,
  ): Promise<string> {
    const templatePath = path.join(
      __dirname,
      'templates',
      `${templateName}.hbs`,
    );
    const templateSource = fs.readFileSync(templatePath, 'utf-8');
    const template = handlebars.compile(templateSource);
    return template(context);
  }

  async sendVerificationEmail(
    email: string,
    token: string,
    name: string,
  ): Promise<void> {
    const verificationUrl = `${process.env.CLIENT_URL || 'http://lvh.me:3001'}/auth/verify-email?token=${token}`;

    const html = await this.compileTemplate('verification', {
      name,
      verificationUrl,
    });

    const { error } = await this.resend.emails.send({
      from: this.fromAdminEmail,
      to: email,
      subject: 'Verify your Parascores account',
      html,
    });

    if (error) {
      console.error('Failed to send verification email:', error);
      throw new Error(`Failed to send verification email: ${error.message}`);
    }

    console.log(`Verification email sent to ${email}`);
  }

  async sendPasswordResetEmail(
    email: string,
    token: string,
    name: string,
  ): Promise<void> {
    const resetUrl = `${process.env.CLIENT_URL || 'http://lvh.me:3001'}/reset-password?token=${token}`;

    const html = await this.compileTemplate('password-reset', {
      name,
      resetUrl,
    });

    const { error } = await this.resend.emails.send({
      from: this.fromAdminEmail,
      to: email,
      subject: 'Reset your Parascores password',
      html,
    });

    if (error) {
      console.error('Failed to send password reset email:', error);
      throw new Error(`Failed to send password reset email: ${error.message}`);
    }

    console.log(`Password reset email sent to ${email}`);
  }

  async sendOAuthPasswordResetEmail(
    email: string,
    name: string,
  ): Promise<void> {
    const html = await this.compileTemplate('oauth-reset', {
      name,
    });

    const { error } = await this.resend.emails.send({
      from: this.fromAdminEmail,
      to: email,
      subject: 'Reset your Parascores password',
      html,
    });

    if (error) {
      console.error('Failed to send OAuth password reset alert email:', error);
      throw new Error(
        `Failed to send OAuth password reset alert email: ${error.message}`,
      );
    }

    console.log(`OAuth password reset alert email sent to ${email}`);
  }

  async sendWelcomeEmail(email: string, name: string): Promise<void> {
    const dashboardUrl = `${process.env.CLIENT_DASHBOARD_URL || 'http://manage.lvh.me:3001'}`;

    const html = await this.compileTemplate('welcome', {
      name,
      dashboardUrl,
    });

    const { error } = await this.resend.emails.send({
      from: this.fromOluwaseyiEmail,
      to: email,
      subject: 'Welcome to Parascores! 🎉',
      html,
    });

    if (error) {
      console.error('Failed to send welcome email:', error);
      throw new Error(`Failed to send welcome email: ${error.message}`);
    }

    console.log(`Welcome email sent to ${email}`);
  }

  async sendNewUserAlertEmail(
    userEmail: string,
    userName: string,
  ): Promise<void> {
    const adminEmail = process.env.ADMIN_ALERT_EMAIL || 'admin@parascores.com';
    const timestamp = new Date().toLocaleString('en-US', {
      dateStyle: 'full',
      timeStyle: 'long',
    });

    const html = `
      <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px;">
        <h2 style="color: #4F46E5;">🎉 New User Signup Alert</h2>
        <p>A new user has signed up on ParaScores!</p>
        <div style="background-color: #F3F4F6; padding: 15px; border-radius: 8px; margin: 20px 0;">
          <p style="margin: 5px 0;"><strong>Name:</strong> ${userName}</p>
          <p style="margin: 5px 0;"><strong>Email:</strong> ${userEmail}</p>
          <p style="margin: 5px 0;"><strong>Signed up at:</strong> ${timestamp}</p>
        </div>
        <p style="color: #6B7280; font-size: 14px;">This is an automated notification from ParaScores.</p>
      </div>
    `;

    const { error } = await this.resend.emails.send({
      from: this.fromAdminEmail,
      to: adminEmail,
      subject: `🆕 New User Signup: ${userName}`,
      html,
    });

    if (error) {
      console.error('Failed to send new user alert email:', error);
      // Don't throw - this is a non-critical notification
    } else {
      console.log(
        `New user alert email sent to ${adminEmail} for user: ${userEmail}`,
      );
    }
  }

  async sendContactEmail(
    name: string,
    email: string,
    subject: string,
    message: string,
  ): Promise<void> {
    const adminEmail = process.env.ADMIN_ALERT_EMAIL || 'admin@parascores.com';
    const timestamp = new Date().toLocaleString('en-US', {
      dateStyle: 'full',
      timeStyle: 'long',
    });

    const html = `
      <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px;">
        <h2 style="color: #4F46E5;">📬 New Contact Form Submission</h2>
        <div style="background-color: #F3F4F6; padding: 15px; border-radius: 8px; margin: 20px 0;">
          <p style="margin: 5px 0;"><strong>Name:</strong> ${name}</p>
          <p style="margin: 5px 0;"><strong>Email:</strong> ${email}</p>
          <p style="margin: 5px 0;"><strong>Subject:</strong> ${subject}</p>
          <p style="margin: 5px 0;"><strong>Submitted at:</strong> ${timestamp}</p>
        </div>
        <p style="margin-top: 20px;"><strong>Message:</strong></p>
        <div style="background-color: #F3F4F6; padding: 15px; border-radius: 8px; margin: 10px 0; white-space: pre-wrap;">${message}</div>
      </div>
    `;

    const { error } = await this.resend.emails.send({
      from: this.fromAdminEmail,
      to: adminEmail,
      replyTo: email,
      subject: `📨 Contact Form: ${subject}`,
      html,
    });

    if (error) {
      console.error('Failed to send contact email:', error);
      throw new Error(`Failed to send contact email: ${error.message}`);
    }
    console.log(`Contact email sent from ${email}`);
  }

  async sendPlayerJoinRequestAlert(
    organizerEmail: string,
    organizerName: string,
    playerName: string,
    teamName: string,
    tournamentName: string,
  ): Promise<void> {
    const timestamp = new Date().toLocaleString('en-US', {
      dateStyle: 'full',
      timeStyle: 'long',
    });

    const html = `
      <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px;">
        <h2 style="color: #4F46E5;">📋 New Player Join Request</h2>
        <p>Hello ${organizerName},</p>
        <p>A new player has requested to join <strong>${teamName}</strong> in <strong>${tournamentName}</strong>.</p>
        <div style="background-color: #F3F4F6; padding: 15px; border-radius: 8px; margin: 20px 0;">
          <p style="margin: 5px 0;"><strong>Player Name:</strong> ${playerName}</p>
          <p style="margin: 5px 0;"><strong>Team:</strong> ${teamName}</p>
          <p style="margin: 5px 0;"><strong>Tournament:</strong> ${tournamentName}</p>
          <p style="margin: 5px 0;"><strong>Received at:</strong> ${timestamp}</p>
        </div>
        <p>Please log in to your dashboard to approve or reject this request.</p>
        <div style="margin-top: 25px;">
          <a href="${process.env.CLIENT_DASHBOARD_URL || 'http://manage.lvh.me:3001'}" style="background-color: #4F46E5; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold;">Go to Dashboard</a>
        </div>
        <p style="color: #6B7280; font-size: 14px; margin-top: 30px;">This is an automated notification from ParaScores.</p>
      </div>
    `;

    const { error } = await this.resend.emails.send({
      from: this.fromAdminEmail,
      to: organizerEmail,
      subject: `📋 New Join Request: ${playerName} for ${teamName}`,
      html,
    });

    if (error) {
      console.error('Failed to send player join alert email:', error);
    } else {
      console.log(`Player join alert email sent to ${organizerEmail}`);
    }
  }

  async sendPlayerJoinApprovalAlert(
    playerEmail: string,
    playerName: string,
    teamName: string,
    tournamentName: string,
    customName: string,
  ): Promise<void> {
    const timestamp = new Date().toLocaleString('en-US', {
      dateStyle: 'full',
      timeStyle: 'long',
    });

    const html = `
      <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; border: 1px solid #E5E7EB; border-radius: 12px;">
        <h2 style="color: #10B981;">🎉 Welcome to the Team!</h2>
        <p>Hello ${playerName},</p>
        <p>Great news! Your request to join <strong>${teamName}</strong> for the <strong>${tournamentName}</strong> tournament has been <strong>APPROVED</strong> by the organizer.</p>
        <div style="background-color: #F0FDF4; padding: 15px; border-radius: 8px; margin: 20px 0; border: 1px solid #DCFCE7;">
          <p style="margin: 5px 0;"><strong>Team:</strong> ${teamName}</p>
          <p style="margin: 5px 0;"><strong>Tournament:</strong> ${tournamentName}</p>
          <p style="margin: 5px 0;"><strong>Approved at:</strong> ${timestamp}</p>
        </div>
        <p>You can now see your team on the tournament page and prepare for your matches!</p>
        <div style="margin-top: 25px;">
          <a href="${process.env.CLIENT_URL + '/t/' + customName || 'http://lvh.me:3001/t/' + customName}" style="background-color: #10B981; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold;">View Tournament</a>
        </div>
        <p style="color: #6B7280; font-size: 14px; margin-top: 30px;">This is an automated notification from ParaScores.</p>
      </div>
    `;

    const { error } = await this.resend.emails.send({
      from: this.fromAdminEmail,
      to: playerEmail,
      subject: `✅ Approved: You've joined ${teamName}!`,
      html,
    });

    if (error) {
      console.error('Failed to send player approval email:', error);
    } else {
      console.log(`Player approval email sent to ${playerEmail}`);
    }
  }

  async sendPlayerJoinRejectionAlert(
    playerEmail: string,
    playerName: string,
    teamName: string,
    tournamentName: string,
  ): Promise<void> {
    const timestamp = new Date().toLocaleString('en-US', {
      dateStyle: 'full',
      timeStyle: 'long',
    });

    const html = `
      <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; border: 1px solid #E5E7EB; border-radius: 12px;">
        <h2 style="color: #EF4444;">📋 Join Request Update</h2>
        <p>Hello ${playerName},</p>
        <p>We're writing to inform you that your request to join <strong>${teamName}</strong> for the <strong>${tournamentName}</strong> tournament has been <strong>DECLINED</strong> by the tournament organizer at this time.</p>
        <div style="background-color: #FEF2F2; padding: 15px; border-radius: 8px; margin: 20px 0; border: 1px solid #FEE2E2;">
          <p style="margin: 5px 0;"><strong>Team:</strong> ${teamName}</p>
          <p style="margin: 5px 0;"><strong>Tournament:</strong> ${tournamentName}</p>
          <p style="margin: 5px 0;"><strong>Processed at:</strong> ${timestamp}</p>
        </div>
        <p>Don't worry! You can still explore other tournaments or teams looking for players on our platform.</p>
        <div style="margin-top: 25px;">
          <a href="${process.env.CLIENT_URL || 'http://lvh.me:3001'}" style="background-color: #4F46E5; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold;">Explore More</a>
        </div>
        <p style="color: #6B7280; font-size: 14px; margin-top: 30px;">This is an automated notification from ParaScores.</p>
      </div>
    `;

    const { error } = await this.resend.emails.send({
      from: this.fromAdminEmail,
      to: playerEmail,
      subject: `📋 Update: Join request for ${teamName}`,
      html,
    });

    if (error) {
      console.error('Failed to send player rejection email:', error);
    } else {
      console.log(`Player rejection email sent to ${playerEmail}`);
    }
  }
}
