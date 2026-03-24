import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class ResendVerificationResponseDto {
  @ApiProperty({ example: 'Verification email sent' })
  message: string;
}

export class VerifyEmailDto {
  @ApiProperty({ description: 'Verification token received via email' })
  @IsNotEmpty()
  @IsString()
  token: string;
}

export class VerifyEmailResponseDto {
  @ApiProperty({ example: 'Email successfully verified' })
  message: string;
}
