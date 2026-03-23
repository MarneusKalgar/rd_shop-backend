import { Body, Controller, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';

import { AuthService } from '../auth.service';
import {
  buildRefreshCookieOptions,
  REFRESH_COOKIE_CLEAR_OPTIONS,
  REFRESH_COOKIE_NAME,
} from '../constants';
import { CurrentUser } from '../decorators';
import {
  ForgotPasswordDto,
  ForgotPasswordResponseDto,
  RefreshResponseDto,
  ResendVerificationResponseDto,
  ResetPasswordDto,
  ResetPasswordResponseDto,
  SigninDto,
  SigninResponseDto,
  SignupDto,
  SignupResponseDto,
  VerifyEmailDto,
  VerifyEmailResponseDto,
} from '../dto';
import { JwtAuthGuard } from '../guards';
import { TokenService } from '../token.service';
import { AuthUser } from '../types';

@ApiTags('auth')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly tokenService: TokenService,
  ) {}

  @ApiOperation({ summary: 'Request a password reset link (always returns 200)' })
  @ApiResponse({
    description: 'Reset email sent if account exists',
    status: HttpStatus.OK,
    type: ForgotPasswordResponseDto,
  })
  @HttpCode(HttpStatus.OK)
  @Post('forgot-password')
  async forgotPassword(@Body() dto: ForgotPasswordDto): Promise<ForgotPasswordResponseDto> {
    return this.authService.forgotPassword(dto);
  }

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

  @ApiOperation({ summary: 'Resend verification email (rate limited: 1 per minute)' })
  @ApiResponse({
    description: 'Verification email sent',
    status: HttpStatus.OK,
    type: ResendVerificationResponseDto,
  })
  @ApiResponse({ description: 'Email already verified', status: HttpStatus.CONFLICT })
  @ApiResponse({ description: 'Too many requests', status: HttpStatus.TOO_MANY_REQUESTS })
  @HttpCode(HttpStatus.OK)
  @Post('resend-verification')
  @UseGuards(JwtAuthGuard)
  async resendVerification(
    @CurrentUser() currentUser: AuthUser,
  ): Promise<ResendVerificationResponseDto> {
    return this.authService.resendVerification(currentUser.sub);
  }

  @ApiOperation({ summary: 'Reset password using token received via email' })
  @ApiResponse({
    description: 'Password reset successfully',
    status: HttpStatus.OK,
    type: ResetPasswordResponseDto,
  })
  @ApiResponse({ description: 'Invalid or expired token', status: HttpStatus.BAD_REQUEST })
  @ApiResponse({ description: 'Passwords do not match', status: HttpStatus.BAD_REQUEST })
  @HttpCode(HttpStatus.OK)
  @Post('reset-password')
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<ResetPasswordResponseDto> {
    return this.authService.resetPassword(dto);
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

  @ApiOperation({ summary: 'Verify email address using token received via email' })
  @ApiResponse({
    description: 'Email successfully verified',
    status: HttpStatus.OK,
    type: VerifyEmailResponseDto,
  })
  @ApiResponse({ description: 'Invalid or expired token', status: HttpStatus.BAD_REQUEST })
  @HttpCode(HttpStatus.OK)
  @Post('verify-email')
  async verifyEmail(@Body() verifyEmailDto: VerifyEmailDto): Promise<VerifyEmailResponseDto> {
    return this.authService.verifyEmail(verifyEmailDto.token);
  }
}
