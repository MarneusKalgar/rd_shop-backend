import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { AuthService } from '../auth.service';
import { SigninDto, SigninResponseDto, SignupDto, SignupResponseDto } from '../dto';

@ApiTags('auth')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @ApiOperation({ summary: 'Sign in with email and password' })
  @ApiResponse({
    description: 'User successfully signed in',
    status: HttpStatus.OK,
    type: SigninResponseDto,
  })
  @ApiResponse({
    description: 'Invalid credentials',
    status: HttpStatus.UNAUTHORIZED,
  })
  @ApiResponse({
    description: 'Invalid input data',
    status: HttpStatus.BAD_REQUEST,
  })
  @HttpCode(HttpStatus.OK)
  @Post('signin')
  async signin(@Body() signinDto: SigninDto): Promise<SigninResponseDto> {
    return this.authService.signin(signinDto);
  }

  @ApiOperation({ summary: 'Register a new user' })
  @ApiResponse({
    description: 'User successfully registered',
    status: HttpStatus.CREATED,
    type: SignupResponseDto,
  })
  @ApiResponse({
    description: 'Email already exists',
    status: HttpStatus.CONFLICT,
  })
  @ApiResponse({
    description: 'Invalid input data',
    status: HttpStatus.BAD_REQUEST,
  })
  @Post('signup')
  async signup(@Body() signupDto: SignupDto): Promise<SignupResponseDto> {
    return this.authService.signup(signupDto);
  }
}
