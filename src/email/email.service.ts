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

  private readonly logoUrl: string;

  constructor() {
    this.resend = new Resend(process.env.RESEND_API_KEY);
    this.fromAdminEmail =
      process.env.EMAIL_FROM_ADMIN || 'ParaScores admin <admin@parascores.com>';
    this.fromOluwaseyiEmail =
      process.env.EMAIL_FROM_OLUWASEYI ||
      'Oluwaseyi - ParaScores <oluwaseyi@parascores.com>';
    this.logoUrl = 'https://res.cloudinary.com/djsnerfzp/image/upload/q_auto/f_auto/v1780327900/parascores-logo.png';
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
      logoUrl: this.logoUrl,
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
      logoUrl: this.logoUrl,
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
      logoUrl: this.logoUrl,
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
    const homepageUrl = `${process.env.CLIENT_URL || 'http://lvh.me:3001'}`;

    const html = await this.compileTemplate('welcome', {
      name,
      homepageUrl,
      logoUrl: this.logoUrl,
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
    tournamentLogoUrl?: string,
  ): Promise<void> {
    const timestamp = new Date().toLocaleString('en-US', {
      dateStyle: 'full',
      timeStyle: 'long',
    });

    const logoHtml = tournamentLogoUrl
      ? `<div style="text-align: center; margin-bottom: 20px;">
           <img src="${tournamentLogoUrl}" alt="${tournamentName}" style="width: 64px; height: 64px; border-radius: 12px; object-fit: cover;" />
         </div>`
      : '';

    const html = `
      <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px;">
        ${logoHtml}
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
    tournamentLogoUrl?: string,
  ): Promise<void> {
    const timestamp = new Date().toLocaleString('en-US', {
      dateStyle: 'full',
      timeStyle: 'long',
    });

    const logoHtml = tournamentLogoUrl
      ? `<div style="text-align: center; margin-bottom: 20px;">
           <img src="${tournamentLogoUrl}" alt="${tournamentName}" style="width: 64px; height: 64px; border-radius: 12px; object-fit: cover;" />
         </div>`
      : '';

    const html = `
      <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; border: 1px solid #E5E7EB; border-radius: 12px;">
        ${logoHtml}
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
    tournamentLogoUrl?: string,
  ): Promise<void> {
    const timestamp = new Date().toLocaleString('en-US', {
      dateStyle: 'full',
      timeStyle: 'long',
    });

    const logoHtml = tournamentLogoUrl
      ? `<div style="text-align: center; margin-bottom: 20px;">
           <img src="${tournamentLogoUrl}" alt="${tournamentName}" style="width: 64px; height: 64px; border-radius: 12px; object-fit: cover;" />
         </div>`
      : '';

    const html = `
      <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; border: 1px solid #E5E7EB; border-radius: 12px;">
        ${logoHtml}
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

  async sendOrganizationMemberAddedEmail(
    email: string,
    name: string,
    organizationName: string,
    role: string,
  ): Promise<void> {
    const timestamp = new Date().toLocaleString('en-US', {
      dateStyle: 'full',
      timeStyle: 'long',
    });

    const roleDescription = this.getRoleDescription(role);

    const html = `
      <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; border: 1px solid #E5E7EB; border-radius: 12px;">
        <h2 style="color: #4F46E5;">🏢 Welcome to ${organizationName}!</h2>
        <p>Hello ${name},</p>
        <p>You have been added to the <strong>${organizationName}</strong> organization on ParaScores.</p>
        <div style="background-color: #F3F4F6; padding: 15px; border-radius: 8px; margin: 20px 0;">
          <p style="margin: 5px 0;"><strong>Organization:</strong> ${organizationName}</p>
          <p style="margin: 5px 0;"><strong>Your Role:</strong> ${role}</p>
          <p style="margin: 10px 0 5px 0; color: #4B5563; font-size: 14px;"><strong>Authorized Actions:</strong><br/>${roleDescription}</p>
          <p style="margin: 10px 0 0 0; font-size: 12px; color: #9CA3AF;">Added at: ${timestamp}</p>
        </div>
        <p>You can now collaborate within this workspace based on your assigned permissions.</p>
        <div style="margin-top: 25px;">
          <a href="${process.env.CLIENT_DASHBOARD_URL || 'http://manage.lvh.me:3001'}/organizations" style="background-color: #4F46E5; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold;">Go to Organizations</a>
        </div>
        <p style="color: #6B7280; font-size: 14px; margin-top: 30px;">This is an automated notification from ParaScores.</p>
      </div>
    `;

    const { error } = await this.resend.emails.send({
      from: this.fromAdminEmail,
      to: email,
      subject: `🏢 Welcome to ${organizationName} on ParaScores`,
      html,
    });

    if (error) {
      console.error('Failed to send organization member added email:', error);
    } else {
      console.log(`Organization member added email sent to ${email}`);
    }
  }

  async sendOrganizationMemberRoleUpdatedEmail(
    email: string,
    name: string,
    organizationName: string,
    newRole: string,
  ): Promise<void> {
    const timestamp = new Date().toLocaleString('en-US', {
      dateStyle: 'full',
      timeStyle: 'long',
    });

    const roleDescription = this.getRoleDescription(newRole);

    const html = `
      <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; border: 1px solid #E5E7EB; border-radius: 12px;">
        <h2 style="color: #4F46E5;">🛡️ Role Updated: ${organizationName}</h2>
        <p>Hello ${name},</p>
        <p>Your role in the <strong>${organizationName}</strong> organization has been updated.</p>
        <div style="background-color: #F3F4F6; padding: 15px; border-radius: 8px; margin: 20px 0;">
          <p style="margin: 5px 0;"><strong>Organization:</strong> ${organizationName}</p>
          <p style="margin: 5px 0;"><strong>New Role:</strong> ${newRole}</p>
          <p style="margin: 10px 0 5px 0; color: #4B5563; font-size: 14px;"><strong>Your New Permissions:</strong><br/>${roleDescription}</p>
          <p style="margin: 10px 0 0 0; font-size: 12px; color: #9CA3AF;">Updated at: ${timestamp}</p>
        </div>
        <p>This change appropriately adjusts your access within the workspace.</p>
        <div style="margin-top: 25px;">
          <a href="${process.env.CLIENT_DASHBOARD_URL || 'http://manage.lvh.me:3001'}/organizations" style="background-color: #4F46E5; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold;">View Organization</a>
        </div>
        <p style="color: #6B7280; font-size: 14px; margin-top: 30px;">This is an automated notification from ParaScores.</p>
      </div>
    `;

    const { error } = await this.resend.emails.send({
      from: this.fromAdminEmail,
      to: email,
      subject: `🛡️ Role Updated in ${organizationName}`,
      html,
    });

    if (error) {
      console.error('Failed to send organization role update email:', error);
    } else {
      console.log(`Organization role update email sent to ${email}`);
    }
  }

  async sendOrganizationMemberRemovedEmail(
    email: string,
    name: string,
    organizationName: string,
  ): Promise<void> {
    const timestamp = new Date().toLocaleString('en-US', {
      dateStyle: 'full',
      timeStyle: 'long',
    });

    const html = `
      <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; border: 1px solid #E5E7EB; border-radius: 12px;">
        <h2 style="color: #EF4444;">👋 Organization Membership Update</h2>
        <p>Hello ${name},</p>
        <p>We're writing to inform you that you have been removed from the <strong>${organizationName}</strong> organization.</p>
        <div style="background-color: #FEF2F2; padding: 15px; border-radius: 8px; margin: 20px 0; border: 1px solid #FEE2E2;">
          <p style="margin: 5px 0;"><strong>Organization:</strong> ${organizationName}</p>
          <p style="margin: 5px 0;"><strong>Status:</strong> Membership Revoked</p>
          <p style="margin: 5px 0;"><strong>Processed at:</strong> ${timestamp}</p>
        </div>
        <p>If you believe this was an error, please contact the organization owner.</p>
        <p style="color: #6B7280; font-size: 14px; margin-top: 30px;">This is an automated notification from ParaScores.</p>
      </div>
    `;

    const { error } = await this.resend.emails.send({
      from: this.fromAdminEmail,
      to: email,
      subject: `👋 Update: Membership in ${organizationName}`,
      html,
    });

    if (error) {
      console.error('Failed to send organization removal email:', error);
    } else {
      console.log(`Organization removal email sent to ${email}`);
    }
  }


  async sendOrganizationDeleteCodeEmail(
    email: string,
    name: string,
    organizationName: string,
    code: string,
    tournamentCount: number,
  ): Promise<void> {
    const html = `
      <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; border: 1px solid #E5E7EB; border-radius: 12px;">
        <h2 style="color: #EF4444;">⚠️ Organization Deletion Request</h2>
        <p>Hello ${name},</p>
        <p>You have requested to <strong>permanently delete</strong> the <strong>${organizationName}</strong> organization from ParaScores.</p>
        <div style="background-color: #FEF2F2; padding: 15px; border-radius: 8px; margin: 20px 0; border: 1px solid #FEE2E2;">
          <p style="margin: 5px 0; color: #991B1B; font-weight: bold;">⚠️ This action is IRREVERSIBLE. The following will be permanently deleted:</p>
          <ul style="color: #991B1B; margin: 10px 0;">
            <li>The organization "<strong>${organizationName}</strong>"</li>
            <li><strong>${tournamentCount}</strong> tournament${tournamentCount !== 1 ? 's' : ''} and all associated data</li>
            <li>All fixtures, standings, participants, and match events</li>
            <li>All team invites and player registrations</li>
          </ul>
        </div>
        <p>Enter this verification code to confirm the deletion:</p>
        <div style="background-color: #F3F4F6; padding: 20px; border-radius: 8px; margin: 20px 0; text-align: center;">
          <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #1F2937; font-family: monospace;">${code}</span>
        </div>
        <p style="color: #6B7280; font-size: 13px;">This code expires in <strong>10 minutes</strong>. If you did not request this, please ignore this email — no changes will be made.</p>
        <p style="color: #6B7280; font-size: 14px; margin-top: 30px;">This is an automated notification from ParaScores.</p>
      </div>
    `;

    const { error } = await this.resend.emails.send({
      from: this.fromAdminEmail,
      to: email,
      subject: `⚠️ Deletion Code for ${organizationName}`,
      html,
    });

    if (error) {
      console.error('Failed to send organization delete code email:', error);
      throw new Error(`Failed to send delete code email: ${error.message}`);
    }

    console.log(`Organization delete code email sent to ${email}`);
  }

  async sendTournamentJoinRequestAlert(
    organizerEmail: string,
    organizerName: string,
    teamName: string,
    tournamentName: string,
    dashboardUrl: string,
    tournamentLogoUrl?: string,
  ): Promise<void> {
    const timestamp = new Date().toLocaleString('en-US', {
      dateStyle: 'full',
      timeStyle: 'long',
    });

    const logoHtml = tournamentLogoUrl
      ? `<div style="text-align: center; margin-bottom: 20px;">
           <img src="${tournamentLogoUrl}" alt="${tournamentName}" style="width: 64px; height: 64px; border-radius: 12px; object-fit: cover;" />
         </div>`
      : '';

    const html = `
      <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; border: 1px solid #E5E7EB; border-radius: 12px;">
        ${logoHtml}
        <h2 style="color: #4F46E5;">📋 New Team Join Request</h2>
        <p>Hello ${organizerName},</p>
        <p>A new team has requested to join <strong>${tournamentName}</strong>.</p>
        <div style="background-color: #F3F4F6; padding: 15px; border-radius: 8px; margin: 20px 0;">
          <p style="margin: 5px 0;"><strong>Team Name:</strong> ${teamName}</p>
          <p style="margin: 5px 0;"><strong>Tournament:</strong> ${tournamentName}</p>
          <p style="margin: 5px 0;"><strong>Received at:</strong> ${timestamp}</p>
        </div>
        <p>Please log in to your dashboard to approve or reject this request.</p>
        <div style="margin-top: 25px;">
          <a href="${dashboardUrl}" style="background-color: #4F46E5; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold;">Go to Dashboard</a>
        </div>
        <p style="color: #6B7280; font-size: 14px; margin-top: 30px;">This is an automated notification from ParaScores.</p>
      </div>
    `;

    const { error } = await this.resend.emails.send({
      from: this.fromAdminEmail,
      to: organizerEmail,
      subject: `📋 New Join Request: ${teamName} for ${tournamentName}`,
      html,
    });

    if (error) {
      console.error('Failed to send tournament join alert email:', error);
    } else {
      console.log(`Tournament join alert email sent to ${organizerEmail}`);
    }
  }

  async sendTournamentJoinApprovalAlert(
    userEmail: string,
    userName: string,
    teamName: string,
    tournamentName: string,
    tournamentUrl: string,
    tournamentLogoUrl?: string,
  ): Promise<void> {
    const timestamp = new Date().toLocaleString('en-US', {
      dateStyle: 'full',
      timeStyle: 'long',
    });

    const logoHtml = tournamentLogoUrl
      ? `<div style="text-align: center; margin-bottom: 20px;">
           <img src="${tournamentLogoUrl}" alt="${tournamentName}" style="width: 64px; height: 64px; border-radius: 12px; object-fit: cover;" />
         </div>`
      : '';

    const html = `
      <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; border: 1px solid #E5E7EB; border-radius: 12px;">
        ${logoHtml}
        <h2 style="color: #10B981;">🎉 Welcome to the Tournament!</h2>
        <p>Hello ${userName},</p>
        <p>Great news! Your team <strong>${teamName}</strong> has been <strong>APPROVED</strong> to participate in <strong>${tournamentName}</strong>.</p>
        <div style="background-color: #F0FDF4; padding: 15px; border-radius: 8px; margin: 20px 0; border: 1px solid #DCFCE7;">
          <p style="margin: 5px 0;"><strong>Team:</strong> ${teamName}</p>
          <p style="margin: 5px 0;"><strong>Tournament:</strong> ${tournamentName}</p>
          <p style="margin: 5px 0;"><strong>Approved at:</strong> ${timestamp}</p>
        </div>
        <p>You can now view your team and matches on the tournament page!</p>
        <div style="margin-top: 25px;">
          <a href="${tournamentUrl}" style="background-color: #10B981; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold;">View Tournament</a>
        </div>
        <p style="color: #6B7280; font-size: 14px; margin-top: 30px;">This is an automated notification from ParaScores.</p>
      </div>
    `;

    const { error } = await this.resend.emails.send({
      from: this.fromAdminEmail,
      to: userEmail,
      subject: `✅ Approved: ${teamName} joined ${tournamentName}!`,
      html,
    });

    if (error) {
      console.error('Failed to send tournament approval email:', error);
    } else {
      console.log(`Tournament approval email sent to ${userEmail}`);
    }
  }

  async sendTournamentJoinRejectionAlert(
    userEmail: string,
    userName: string,
    teamName: string,
    tournamentName: string,
    tournamentLogoUrl?: string,
  ): Promise<void> {
    const timestamp = new Date().toLocaleString('en-US', {
      dateStyle: 'full',
      timeStyle: 'long',
    });

    const logoHtml = tournamentLogoUrl
      ? `<div style="text-align: center; margin-bottom: 20px;">
           <img src="${tournamentLogoUrl}" alt="${tournamentName}" style="width: 64px; height: 64px; border-radius: 12px; object-fit: cover;" />
         </div>`
      : '';

    const html = `
      <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; border: 1px solid #E5E7EB; border-radius: 12px;">
        ${logoHtml}
        <h2 style="color: #EF4444;">📋 Tournament Registration Update</h2>
        <p>Hello ${userName},</p>
        <p>We're writing to inform you that your request for <strong>${teamName}</strong> to join <strong>${tournamentName}</strong> has been <strong>DECLINED</strong> by the tournament organizer.</p>
        <div style="background-color: #FEF2F2; padding: 15px; border-radius: 8px; margin: 20px 0; border: 1px solid #FEE2E2;">
          <p style="margin: 5px 0;"><strong>Team:</strong> ${teamName}</p>
          <p style="margin: 5px 0;"><strong>Tournament:</strong> ${tournamentName}</p>
          <p style="margin: 5px 0;"><strong>Processed at:</strong> ${timestamp}</p>
        </div>
        <p>You can still explore other upcoming tournaments on our platform.</p>
        <div style="margin-top: 25px;">
          <a href="${process.env.CLIENT_URL || 'http://lvh.me:3001'}" style="background-color: #4F46E5; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold;">Explore More</a>
        </div>
        <p style="color: #6B7280; font-size: 14px; margin-top: 30px;">This is an automated notification from ParaScores.</p>
      </div>
    `;

    const { error } = await this.resend.emails.send({
      from: this.fromAdminEmail,
      to: userEmail,
      subject: `📋 Update: Registration for ${tournamentName}`,
      html,
    });

    if (error) {
      console.error('Failed to send tournament rejection email:', error);
    } else {
      console.log(`Tournament rejection email sent to ${userEmail}`);
    }
  }

  private getRoleDescription(role: string): string {
    switch (role.toUpperCase()) {
      case 'OWNER':
        return 'Full administrative access to the organization, including billing, member management, and all tournaments.';
      case 'ADMIN':
        return 'High-level access to manage tournaments, organization branding, and member roles.';
      case 'MEMBER':
        return 'Authorized to update match scores and match status only. Structural tournament changes are restricted.';
      default:
        return 'Standard access to organization resources.';
    }
  }
}
