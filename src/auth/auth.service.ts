import { HttpStatus, Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import { UsersService } from 'src/users/users.service';
import { SignUpDto } from './dto/sign-up.dto';
import { LoginDto } from './dto/login.dto';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { ResponseUtil } from 'src/utils/api-response';
import { Response } from 'express';

@Injectable()
export class AuthService {
  constructor(
    private readonly db: DatabaseService,
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) { }

  async signUp(dto: SignUpDto) {
    const existingUser = await this.usersService.findByEmail(dto.email);
    if (existingUser) {
      return ResponseUtil.error('Email already in use', HttpStatus.BAD_REQUEST);
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);
    const user = await this.usersService.create({
      ...dto,
      password: hashedPassword,
    });

    // Remove password from response
    const { password, ...result } = user;
    return ResponseUtil.success(result, 'User registered successfully');
  }

  async validateGoogleUser(details: any) {
    console.log(details)
    const user = await this.usersService.findByEmail(details.email);
    console.log('User found in db?', user)
    if (user) {
      if (user.password) {
        // user already exists with password, we can link or just login. 
        // For now, just login.
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
    });
    return newUser;
  }


  async login(dto: LoginDto, response: Response) {
    const user = await this.usersService.findByEmail(dto.email);
    if (!user) {
      return ResponseUtil.error('Invalid credentials', HttpStatus.UNAUTHORIZED);
    }

    if (user.password) {
      const isPasswordValid = bcrypt.compare(dto.password, user.password);
      if (!isPasswordValid) {
        return ResponseUtil.error('Invalid credentials', HttpStatus.UNAUTHORIZED);
      }
    } else {
      return ResponseUtil.error('Invalid credentials', HttpStatus.UNAUTHORIZED);
    }

    const payload = { email: user.email, sub: user.id, role: user.role, name: user.name };
    const access_token = await this.generateToken(payload, "15m")
    const refresh_token = await this.generateToken(payload, "7d")


    // set http-only cookies
    this.setAccessTokenCookie(response, access_token)
    this.setRefreshTokenCookie(response, refresh_token)


    return ResponseUtil.success(
      { access_token: access_token, user: { id: user.id, email: user.email, name: user.name, role: user.role } },
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
        throw new Error('User not found');
      }

      const newPayload = { email: user.email, sub: user.id, role: user.role };
      const access_token = await this.generateToken(newPayload, "15m");
      const refresh_token = await this.generateToken(newPayload, "7d");

      this.setAccessTokenCookie(response, access_token);
      this.setRefreshTokenCookie(response, refresh_token);

      return ResponseUtil.success({ access_token }, 'Tokens refreshed successfully');
    } catch (e) {
      return ResponseUtil.error('Invalid Refresh Token', HttpStatus.UNAUTHORIZED);
    }
  }

  async getProfile(userId: string) {
    const user = await this.usersService.findOne(userId);
    if (!user) {
      return ResponseUtil.error('User not found', HttpStatus.NOT_FOUND);
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
    res.cookie('access_token', token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'strict',
      maxAge: 15 * 60 * 1000, // 15 minutes
    });
  }
  setRefreshTokenCookie(res: Response, token: string) {
    const isProduction = process.env.NODE_ENV === 'production';
    res.cookie('refresh_token', token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });
  }
}
