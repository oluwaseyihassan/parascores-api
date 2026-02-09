import { BadRequestException, ConflictException, HttpStatus, Injectable, InternalServerErrorException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import { UsersService } from 'src/users/users.service';
import { SignUpDto } from './dto/sign-up.dto';
import { LoginDto } from './dto/login.dto';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { JwtService } from '@nestjs/jwt';
import { ResponseUtil } from 'src/utils/api-response';
import { Response } from 'express';
import { EmailService } from 'src/email/email.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly db: DatabaseService,
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly emailService: EmailService,
  ) { }

  async signUp(dto: SignUpDto) {
    const existingUser = await this.usersService.findByEmail(dto.email);

    if (existingUser) {
      throw new ConflictException('Email already in use');
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);
    
    // Generate verification token
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const verificationExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    const user = await this.usersService.create({
      ...dto,
      password: hashedPassword,
      isEmailVerified: false,
      emailVerificationToken: verificationToken,
      emailVerificationExpiry: verificationExpiry,
    });

    // Send verification email
    try {
      await this.emailService.sendVerificationEmail(
        user.email,
        verificationToken,
        user.name,
      );
    } catch (error) {
      console.error('Failed to send verification email:', error);
      // Don't fail signup if email fails, user can resend
    }

    // Remove password from response
    const { password, emailVerificationToken, ...result } = user;
    return ResponseUtil.success(result, 'User registered successfully. Please check your email to verify your account.');
  }

  async verifyEmail(token: string) {
    const user = await this.db.user.findFirst({
      where: { emailVerificationToken: token },
    });

    console.log('Verifying email for user:', user);
    if (!user) {
      throw new BadRequestException('Invalid verification token');
    }

    if (user.emailVerificationExpiry && user.emailVerificationExpiry < new Date()) {
      throw new BadRequestException('Verification token has expired. Please request a new one.');
    }

    if (user.isEmailVerified) {
      return ResponseUtil.success({}, 'Email already verified');
    }
    await this.db.user.update({
      where: { id: user.id },
      data: {
        isEmailVerified: true,
        emailVerificationToken: null,
        emailVerificationExpiry: null,
      },
    });

    // Send welcome email
    try {
      await this.emailService.sendWelcomeEmail(user.email, user.name);
    } catch (error) {
      console.error('Failed to send welcome email:', error);
      // Don't fail verification if welcome email fails
    }

    return ResponseUtil.success(null, 'Email verified successfully. You can now login.');
  }

  async resendVerificationEmail(email: string) {
    const user = await this.usersService.findByEmail(email);

    if (!user) {
      // Don't reveal if email exists
      return ResponseUtil.success({}, 'If an account with this email exists, a verification email will be sent.');
    }

    if (user.isEmailVerified) {
      throw new BadRequestException('Email is already verified');
    }

    // Generate new verification token
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const verificationExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    await this.db.user.update({
      where: { id: user.id },
      data: {
        emailVerificationToken: verificationToken,
        emailVerificationExpiry: verificationExpiry,
      },
    });

    try {
      await this.emailService.sendVerificationEmail(
        user.email,
        verificationToken,
        user.name,
      );
    } catch (error) {
      console.error('Failed to send verification email:', error);
      throw new InternalServerErrorException('Failed to send verification email. Please try again.');
    }

    return ResponseUtil.success({}, 'Verification email sent successfully.');
  }

  async forgotPassword(email: string) {
    const user = await this.usersService.findByEmail(email);

    // Always return success message for security (don't reveal if email exists)
    if (!user) {
      return ResponseUtil.success({}, 'If an account with this email exists, a password reset link will be sent.');
    }

    // Only allow password reset for users who have a password (not OAuth-only)
    if (!user.password) {
      return ResponseUtil.success({}, 'If an account with this email exists, a password reset link will be sent.');
    }

    // Generate password reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await this.db.user.update({
      where: { id: user.id },
      data: {
        passwordResetToken: resetToken,
        passwordResetExpiry: resetExpiry,
      },
    });

    try {
      await this.emailService.sendPasswordResetEmail(
        user.email,
        resetToken,
        user.name,
      );
    } catch (error) {
      console.error('Failed to send password reset email:', error);
      throw new InternalServerErrorException('Failed to send password reset email. Please try again.');
    }

    return ResponseUtil.success({}, 'If an account with this email exists, a password reset link will be sent.');
  }

  async resetPassword(token: string, newPassword: string) {
    const user = await this.db.user.findFirst({
      where: { passwordResetToken: token },
    });

    if (!user) {
      throw new BadRequestException('Invalid or expired password reset token');
    }

    if (user.passwordResetExpiry && user.passwordResetExpiry < new Date()) {
      throw new BadRequestException('Password reset token has expired. Please request a new one.');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await this.db.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        passwordResetToken: null,
        passwordResetExpiry: null,
      },
    });

    return ResponseUtil.success(null, 'Password reset successfully. You can now login with your new password.');
  }

  async validateGoogleUser(details: any) {
    console.log(details)
    let user = await this.usersService.findByEmail(details.email);
    console.log('User found in db?', user)
    if (user) {
      if (user.password) {
        // user already exists with password, we can link or just login. 
        // For now, just login.
        if (!user.picture && details.picture) {
        await this.usersService.update(user.id, { picture: details.picture });
      }
      }
      return user;
    }
    console.log('Creating new user from google profile')
    const newUser = await this.usersService.create({
      email: details.email,
      name: details.firstName,
      password: null, // No password for OAuth users
      role: 'USER', // Default role
      picture: details.picture,
      isEmailVerified: true, // Google accounts are pre-verified
    });
    await this.emailService.sendWelcomeEmail(newUser.email, newUser.name);
    return newUser;
  }


  async login(dto: LoginDto, response: Response) {
    const user = await this.usersService.findByEmail(dto.email);
    if (!user) {
      return ResponseUtil.error('Invalid credentials', HttpStatus.UNAUTHORIZED);
    }

    if (user.password) {
      const isPasswordValid = await bcrypt.compare(dto.password, user.password);
      if (!isPasswordValid) {
        return ResponseUtil.error('Invalid credentials', HttpStatus.UNAUTHORIZED);
      }
    } else {
      return ResponseUtil.error('Invalid credentials', HttpStatus.UNAUTHORIZED);
    }

    // Check if email is verified
    if (!user.isEmailVerified) {
      return ResponseUtil.error('Please verify your email before logging in. Check your inbox for the verification link.', HttpStatus.FORBIDDEN);
    }

    const payload = { email: user.email, sub: user.id, role: user.role, name: user.name };
    const access_token = await this.generateToken(payload, "7d")
    const refresh_token = await this.generateToken(payload, "30d")


    // set http-only cookies
    this.setAccessTokenCookie(response, access_token)
    this.setRefreshTokenCookie(response, refresh_token)


    return ResponseUtil.success(
      { id: user.id, email: user.email, name: user.name, role: user.role },
      'Login successful',
    );
  }

  async refreshTokens(refreshToken: string, response: Response) {
    try {
      const payload = await this.jwtService.verifyAsync(refreshToken);
      // We want to keep the same payload info (sub, email, role) for the new tokens
      // ideally we should fetch the user from DB to ensure they still exist and have same role
      // but for now reusing payload is acceptable for MVP, though fetching user is safer.
      // Let's safe fetch user to be sure.

      const user = await this.usersService.findOne(payload.sub);
      if (!user) {
        throw new NotFoundException('User not found');
      }

      const newPayload = { email: user.email, sub: user.id, role: user.role };
      const access_token = await this.generateToken(newPayload, "7d");
      const refresh_token = await this.generateToken(newPayload, "30d");

      this.setAccessTokenCookie(response, access_token);
      this.setRefreshTokenCookie(response, refresh_token);

      return ResponseUtil.success({ access_token }, 'Tokens refreshed successfully');
    } catch (e) {
      if (e instanceof NotFoundException) {
          throw new UnauthorizedException('User no longer exists'); 
      }
      console.log(e.message);
      throw new UnauthorizedException('Invalid Refresh Token');
    }
  }

  async getProfile(userId: string) {
    const user = await this.usersService.findOne(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    const { password, ...result } = user;
    return ResponseUtil.success(result, 'User profile retrieved');
  }

  async generateToken(payload: any, expiresIn: string | number): Promise<string> {
    const token = await this.jwtService.signAsync(payload, { expiresIn: expiresIn as any })
    return token
  }
  async verifyToken(token: string) {
    return this.jwtService.verifyAsync(token)
  }
  setAccessTokenCookie(res: Response, token: string) {
    const isProduction = process.env.NODE_ENV === 'production';
    const domain = process.env.NODE_ENV === 'production' ? '.parascores.com' : '.lvh.me';
    res.cookie('access_token', token, {
      domain: domain,
      path: '/',
      httpOnly: true,
      secure: isProduction,
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });
  }
  setRefreshTokenCookie(res: Response, token: string) {
    const isProduction = process.env.NODE_ENV === 'production';
    const domain = process.env.NODE_ENV === 'production' ? '.parascores.com' : '.lvh.me';
    res.cookie('refresh_token', token, {
      domain: domain,
      path: '/',
      httpOnly: true,
      secure: isProduction,
      sameSite: 'strict',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 day
    });
  }
}
