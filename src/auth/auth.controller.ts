import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Res,
  Get,
  Req,
  UseGuards,
  NotFoundException,
  UnauthorizedException,
  Query,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { Public } from './decorators/public.decorator';
import { SignUpDto } from './dto/sign-up.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { UpgradeToOrganizerDto } from './dto/upgrade-to-organizer.dto';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Response } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { ResponseUtil } from 'src/utils/api-response';
import { Throttle } from '@nestjs/throttler';
import { GoogleAuthGuard } from './guards/google-auth.guard';
import { ChangePasswordDto } from './dto/change-password.dto';

@ApiTags('auth')
@Controller('auth')
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Change user password' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Password changed' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Bad Request' })
  changePassword(
    @Req() req: any,
    @Body() changePasswordDto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(
      req.user.sub,
      changePasswordDto.currentPassword,
      changePasswordDto.newPassword,
    );
  }

  @Post('upgrade-to-organizer')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Upgrade user to organizer' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Upgraded successfully' })
  upgradeToOrganizer(
    @Req() req: any,
    @Body() dto: UpgradeToOrganizerDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.authService.upgradeToOrganizer(req.user.sub, dto, response);
  }

  @Public()
  @Throttle({ default: { ttl: 60000, limit: 3 } }) // 3 signups per minute
  @Post('signup')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a new user' })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'User successfully registered',
  })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Bad Request' })
  signup(@Body() signUpDto: SignUpDto) {
    return this.authService.signUp(signUpDto);
  }

  @Public()
  @Get('verify-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify user email address' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Email verified successfully',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid or expired token',
  })
  verifyEmail(@Query('token') token: string) {
    return this.authService.verifyEmail(token);
  }

  @Public()
  @Throttle({ default: { ttl: 60000, limit: 3 } }) // 3 resends per minute
  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resend verification email' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Verification email sent',
  })
  resendVerification(@Body('email') email: string) {
    return this.authService.resendVerificationEmail(email);
  }

  @Public()
  @Throttle({ default: { ttl: 60000, limit: 3 } }) // 3 requests per minute
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request password reset email' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Password reset email sent if account exists',
  })
  forgotPassword(@Body() forgotPasswordDto: ForgotPasswordDto) {
    return this.authService.forgotPassword(forgotPasswordDto.email);
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset password with token' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Password reset successfully',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid or expired token',
  })
  resetPassword(@Body() resetPasswordDto: ResetPasswordDto) {
    return this.authService.resetPassword(
      resetPasswordDto.token,
      resetPasswordDto.password,
    );
  }

  @Public()
  @Get('google')
  @UseGuards(GoogleAuthGuard)
  async googleAuth(@Req() req) {}

  @Public()
  @Get('google/callback')
  @UseGuards(GoogleAuthGuard)
  async googleAuthRedirect(@Req() req, @Res() response: Response) {
    console.log('🔥 CALLBACK HIT AT:', new Date().toISOString());
    // req.user is populated by the strategy validation
    const user = await this.authService.validateGoogleUser(req.user);

    const payload = {
      email: user.email,
      sub: user.id,
      role: user.role,
      name: user.name,
    };
    const access_token = await this.authService.generateToken(payload, '2m');
    const refresh_token = await this.authService.generateToken(payload, '1d');

    this.authService.setAccessTokenCookie(response, access_token);
    this.authService.setRefreshTokenCookie(response, refresh_token);

    // Extract redirect_url from state
    // Note: Passport might not put state in req.query if it consumes it?
    // Actually, req.query.state should be present.
    const redirectUrl = req.query.state as string;

    console.log('redirectUrl from state:', redirectUrl);
    console.log('User logged in successfully, redirecting to frontend');
    const frontendUrl = redirectUrl || 'http://manage.lvh.me:3001';
    response.redirect(frontendUrl);
  }

  @Public()
  @Throttle({ default: { ttl: 60000, limit: 5 } }) // 5 login attempts per minute
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login user' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Login successful' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  login(
    @Body() loginDto: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.authService.login(loginDto, response);
  }

  @Get('profile')
  @ApiOperation({ summary: 'Get user profile' })
  @ApiResponse({ status: HttpStatus.OK, description: 'User profile retrieved' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  getProfile(@Req() req: any) {
    console.log(req.user);
    return this.authService.getProfile(req.user.sub);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access tokens' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Tokens refreshed' })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Invalid refresh token',
  })
  refresh(@Req() req: any, @Res({ passthrough: true }) response: Response) {
    const refreshToken = req.cookies['refresh_token'];
    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token not found');
    }
    return this.authService.refreshTokens(refreshToken, response);
  }

  @Public()
  @Get('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Logout user' })
  @ApiResponse({ status: HttpStatus.OK, description: 'User logged out' })
  logout(@Res({ passthrough: true }) response: Response) {
    const domain =
      process.env.NODE_ENV === 'production' ? '.parascores.com' : '.lvh.me';
    response.clearCookie('access_token', { domain, path: '/' });
    response.clearCookie('refresh_token', { domain, path: '/' });
    console.log('User logged out');
    return ResponseUtil.success({}, 'User logged out');
  }
}
