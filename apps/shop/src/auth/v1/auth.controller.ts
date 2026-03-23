import { Body, Controller, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';

import { AuthService } from '../auth.service';
import {
  buildRefreshCookieOptions,
  REFRESH_COOKIE_CLEAR_OPTIONS,
  REFRESH_COOKIE_NAME,
} from '../constants/cookie';
import {
  RefreshResponseDto,
  SigninDto,
  SigninResponseDto,
  SignupDto,
  SignupResponseDto,
} from '../dto';
import { JwtAuthGuard } from '../guards';
import { TokenService } from '../token.service';

@ApiTags('auth')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly tokenService: TokenService,
  ) {}

  @ApiOperation({ summary: 'Sign out and revoke refresh token' })
  @ApiResponse({ description: 'Successfully signed out', status: HttpStatus.NO_CONTENT })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('logout')
  @UseGuards(JwtAuthGuard)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const cookieValue = req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined;
    if (cookieValue) await this.authService.logout(cookieValue);
    res.clearCookie(REFRESH_COOKIE_NAME, REFRESH_COOKIE_CLEAR_OPTIONS);
  }

  @ApiOperation({ summary: 'Refresh access token using refresh token cookie' })
  @ApiResponse({
    description: 'New access token issued',
    status: HttpStatus.OK,
    type: RefreshResponseDto,
  })
  @ApiResponse({ description: 'Missing or invalid refresh token', status: HttpStatus.UNAUTHORIZED })
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<RefreshResponseDto> {
    const cookieValue = req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined;
    const { accessToken, cookieValue: newCookieValue } =
      await this.authService.refresh(cookieValue);
    res.cookie(
      REFRESH_COOKIE_NAME,
      newCookieValue,
      buildRefreshCookieOptions(this.tokenService.ttlMs),
    );
    return { accessToken };
  }

  @ApiOperation({ summary: 'Sign in with email and password' })
  @ApiResponse({
    description: 'User successfully signed in',
    status: HttpStatus.OK,
    type: SigninResponseDto,
  })
  @ApiResponse({ description: 'Invalid credentials', status: HttpStatus.UNAUTHORIZED })
  @ApiResponse({ description: 'Invalid input data', status: HttpStatus.BAD_REQUEST })
  @HttpCode(HttpStatus.OK)
  @Post('signin')
  async signin(
    @Body() signinDto: SigninDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SigninResponseDto> {
    const { accessToken, cookieValue, user } = await this.authService.signin(signinDto);
    res.cookie(
      REFRESH_COOKIE_NAME,
      cookieValue,
      buildRefreshCookieOptions(this.tokenService.ttlMs),
    );
    return { accessToken, user };
  }

  @ApiOperation({ summary: 'Register a new user' })
  @ApiResponse({
    description: 'User successfully registered',
    status: HttpStatus.CREATED,
    type: SignupResponseDto,
  })
  @ApiResponse({ description: 'Email already exists', status: HttpStatus.CONFLICT })
  @ApiResponse({ description: 'Invalid input data', status: HttpStatus.BAD_REQUEST })
  @Post('signup')
  async signup(@Body() signupDto: SignupDto): Promise<SignupResponseDto> {
    return this.authService.signup(signupDto);
  }
}
