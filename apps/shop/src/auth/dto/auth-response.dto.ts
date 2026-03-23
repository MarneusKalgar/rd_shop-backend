import { ApiProperty } from '@nestjs/swagger';

export interface AuthResult {
  accessToken: string;
  cookieValue: string;
  user: AuthUserDto;
}

export class AuthUserDto {
  @ApiProperty({ example: 'user@example.com' })
  email: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  id: string;

  @ApiProperty({ example: [] })
  roles: string[];

  @ApiProperty({ example: [] })
  scopes: string[];
}

export class RefreshResponseDto {
  @ApiProperty({
    description: 'New JWT access token',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  accessToken: string;
}

export class SigninResponseDto {
  @ApiProperty({
    description: 'JWT access token',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  accessToken: string;

  @ApiProperty({ description: 'User information', type: AuthUserDto })
  user: AuthUserDto;
}

export class SignupResponseDto {
  @ApiProperty({ example: 'user@example.com' })
  email: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  id: string;

  @ApiProperty({ example: 'User successfully registered. Please sign in to continue.' })
  message: string;
}
