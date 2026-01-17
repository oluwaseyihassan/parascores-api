import { IsNotEmpty, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ResetPasswordDto {
  @ApiProperty({ description: 'Password reset token from email' })
  @IsString()
  @IsNotEmpty()
  token: string;

  @ApiProperty({ description: 'New password (min 6 characters)', minLength: 6 })
  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  password: string;
}
