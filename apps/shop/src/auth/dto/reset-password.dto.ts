import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';

export class ForgotPasswordDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email: string;
}

export class ForgotPasswordResponseDto {
  @ApiProperty({ example: 'If this email exists, a reset link has been sent' })
  message: string;
}

export class ResetPasswordDto {
  @ApiProperty({ description: 'Must match newPassword', minLength: 8 })
  @IsString()
  @MinLength(8)
  confirmedPassword: string;

  @ApiProperty({ description: 'New password', minLength: 8 })
  @IsString()
  @MinLength(8)
  newPassword: string;

  @ApiProperty({ description: 'Reset token received via email' })
  @IsNotEmpty()
  @IsString()
  token: string;
}

export class ResetPasswordResponseDto {
  @ApiProperty({ example: 'Password reset successfully' })
  message: string;
}
