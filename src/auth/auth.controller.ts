import { Controller, Post, Body, HttpCode, HttpStatus, Res, Get, Req, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { Public } from './decorators/public.decorator';
import { SignUpDto } from './dto/sign-up.dto';
import { LoginDto } from './dto/login.dto';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Response } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { ResponseUtil } from 'src/utils/api-response';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) { }

  @Public()
  @Post('signup')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a new user' })
  @ApiResponse({ status: HttpStatus.CREATED, description: 'User successfully registered' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Bad Request' })
  signup(@Body() signUpDto: SignUpDto) {
    return this.authService.signUp(signUpDto);
  }

  @Public()
  @Get('google')
  @UseGuards(AuthGuard('google'))
  async googleAuth(@Req() req) { }

  @Public()
  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  async googleAuthRedirect(@Req() req, @Res({ passthrough: true }) response: Response) {
    const user = await this.authService.validateGoogleUser(req.user);
    console.log(user)
    const payload = { email: user.email, sub: user.id, role: user.role, name: user.name };
    const access_token = await this.authService.generateToken(payload, "15m")
    const refresh_token = await this.authService.generateToken(payload, "7d")

    this.authService.setAccessTokenCookie(response, access_token)
    this.authService.setRefreshTokenCookie(response, refresh_token)

    response.redirect(process.env.CLIENT_URL + '/dashboard' || 'http://localhost:3001/dashboard');
  }


  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login user' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Login successful' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  login(@Body() loginDto: LoginDto, @Res({ passthrough: true }) response: Response) {
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
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Invalid refresh token' })
  refresh(@Req() req: any, @Res({ passthrough: true }) response: Response) {
    const refreshToken = req.cookies['refresh_token'];
    if (!refreshToken) {
      return response.status(HttpStatus.UNAUTHORIZED).json({ message: 'Refresh token not found' });
    }
    return this.authService.refreshTokens(refreshToken, response);
  }

  @Public()
  @Get('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Logout user' })
  @ApiResponse({ status: HttpStatus.OK, description: 'User logged out' })
  logout(@Res({ passthrough: true }) response: Response) {
    response.clearCookie('access_token');
    response.clearCookie('refresh_token');
    console.log('User logged out');
    return ResponseUtil.success({}, 'User logged out');
  }
}
