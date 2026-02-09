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
    this.fromOluwaseyiEmail = process.env.EMAIL_FROM_OLUWASEYI || 'Oluwaseyi - ParaScores <oluwaseyi@parascores.com>'
  }

  private async compileTemplate(
    templateName: string,
    context: Record<string, unknown>,
  ): Promise<string> {
    const templatePath = path.join(__dirname, 'templates', `${templateName}.hbs`);
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

  async sendNewUserAlertEmail(userEmail: string, userName: string): Promise<void> {
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
      console.log(`New user alert email sent to ${adminEmail} for user: ${userEmail}`);
    }
  }
}
