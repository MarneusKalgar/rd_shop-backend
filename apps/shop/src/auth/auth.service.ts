import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';

import { AuditAction, AuditLogService, AuditOutcome } from '@/audit-log';
import { AuditEventContext } from '@/audit-log/audit-log.types';
import { UserEmailExistsError } from '@/common/errors';
import { MailService } from '@/mail/mail.service';
import { User } from '@/users/user.entity';

import {
  AuthResult,
  ForgotPasswordDto,
  ForgotPasswordResponseDto,
  RefreshResponseDto,
  ResendVerificationResponseDto,
  ResetPasswordDto,
  ResetPasswordResponseDto,
  SigninDto,
  SignupDto,
  SignupResponseDto,
  VerifyEmailResponseDto,
} from './dto';
import { UserPermissions } from './permissions';
import { TokenService } from './token.service';
import { parseOpaqueToken } from './utils';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly saltRounds: number;

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly configService: ConfigService,
    private readonly mailService: MailService,
    private readonly tokenService: TokenService,
    private readonly auditLogService: AuditLogService,
  ) {
    this.saltRounds = this.configService.get<number>('BCRYPT_SALT_ROUNDS', 10);
  }

  /**
   * Initiates the password reset flow. Always returns a safe 200 response to prevent
   * user enumeration. Sends a reset link if the account exists.
   */
  async forgotPassword(
    dto: ForgotPasswordDto,
    context?: AuditEventContext,
  ): Promise<ForgotPasswordResponseDto> {
    const SAFE_RESPONSE = { message: 'If this email exists, a reset link has been sent' };

    const user = await this.userRepository.findOne({ where: { email: dto.email } });
    if (!user) return SAFE_RESPONSE;

    const rawToken = await this.tokenService.issuePasswordResetToken(user.id);
    await this.mailService.sendPasswordResetEmail(user.email, rawToken);

    this.logger.log(`Password reset email sent to: ${user.email}`);

    void this.auditLogService.log({
      action: AuditAction.AUTH_PASSWORD_RESET_REQUEST,
      actorId: user.id,
      context,
      outcome: AuditOutcome.SUCCESS,
      targetId: user.id,
      targetType: 'User',
    });

    return SAFE_RESPONSE;
  }

  /** Revokes the refresh token identified by the cookie value. No-ops on invalid input. */
  async logout(cookieValue: string, actorId?: string, context?: AuditEventContext): Promise<void> {
    const parsed = parseOpaqueToken(cookieValue);
    if (!parsed) return;
    await this.tokenService.revokeRefreshToken(parsed.tokenId);

    void this.auditLogService.log({
      action: AuditAction.AUTH_LOGOUT,
      actorId: actorId ?? null,
      context,
      outcome: AuditOutcome.SUCCESS,
      targetType: 'User',
    });
  }

  /**
   * Rotates the refresh token and returns a new access token + new cookie value.
   * Throws `UnauthorizedException` if the cookie is missing or the token is invalid/revoked.
   */
  async refresh(
    cookieValue: string | undefined,
  ): Promise<RefreshResponseDto & { cookieValue: string }> {
    if (!cookieValue) throw new UnauthorizedException('Missing refresh token');

    const { accessToken, cookieValue: newCookieValue } =
      await this.tokenService.rotateRefreshToken(cookieValue);
    return { accessToken, cookieValue: newCookieValue };
  }

  /**
   * Re-sends the email verification link for the authenticated user.
   * Throws if the email is already verified or if the 1-minute cooldown has not elapsed.
   */
  async resendVerification(userId: string): Promise<ResendVerificationResponseDto> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    if (user.isEmailVerified) {
      throw new ConflictException('Email is already verified');
    }

    await this.issueAndSendVerificationToken(user);

    return { message: 'Verification email sent' };
  }

  /**
   * Completes the password reset flow: atomically consumes the reset token (preventing
   * replay under concurrent requests), hashes the new password, and revokes all existing
   * refresh tokens for the user.
   */
  async resetPassword(
    dto: ResetPasswordDto,
    context?: AuditEventContext,
  ): Promise<ResetPasswordResponseDto> {
    if (dto.newPassword !== dto.confirmedPassword) {
      throw new BadRequestException('Passwords do not match');
    }

    const userId = await this.tokenService.consumePasswordResetToken(dto.token);

    const hashedPassword = await bcrypt.hash(dto.newPassword, this.saltRounds);

    await Promise.all([
      this.userRepository.update(userId, { password: hashedPassword }),
      this.tokenService.revokeAllUserTokens(userId),
    ]);

    this.logger.log(`Password reset for user: ${userId}`);

    void this.auditLogService.log({
      action: AuditAction.AUTH_PASSWORD_RESET_COMPLETE,
      actorId: userId,
      context,
      outcome: AuditOutcome.SUCCESS,
      targetId: userId,
      targetType: 'User',
    });

    return { message: 'Password reset successfully' };
  }

  /** Validates credentials and returns a new access token + refresh token cookie value. */
  async signin(signinDto: SigninDto, context?: AuditEventContext): Promise<AuthResult> {
    const { email, password } = signinDto;

    const user = await this.userRepository
      .createQueryBuilder('user')
      .addSelect('user.password')
      .where('user.email = :email', { email })
      .getOne();

    if (!user?.password) {
      void this.auditLogService.log({
        action: AuditAction.AUTH_SIGNIN_FAILURE,
        actorId: null,
        context,
        outcome: AuditOutcome.FAILURE,
        reason: 'User not found',
        targetType: 'User',
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      void this.auditLogService.log({
        action: AuditAction.AUTH_SIGNIN_FAILURE,
        actorId: user.id,
        context,
        outcome: AuditOutcome.FAILURE,
        reason: 'Invalid password',
        targetId: user.id,
        targetType: 'User',
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    this.logger.log(`User signed in: ${user.email}`);

    return this.buildAuthResult(user);
  }

  /**
   * Registers a new user, hashes the password, persists the record, and sends a
   * verification email. Throws `ConflictException` if the email is already taken.
   */
  async signup(signupDto: SignupDto, context?: AuditEventContext): Promise<SignupResponseDto> {
    const { confirmedPassword, email, password } = signupDto;

    if (password !== confirmedPassword) {
      throw new BadRequestException('Passwords do not match');
    }

    const existingUser = await this.userRepository.findOne({
      where: { email },
    });

    if (existingUser) {
      throw new UserEmailExistsError(email);
    }

    const hashedPassword = await bcrypt.hash(password, this.saltRounds);

    const { roles, scopes } = UserPermissions.NewUser;

    const user = this.userRepository.create({
      email,
      password: hashedPassword,
      roles: [...roles],
      scopes: [...scopes],
    });

    await this.userRepository.save(user);

    this.logger.log(`New user registered: ${user.email}`);

    void this.auditLogService.log({
      action: AuditAction.AUTH_SIGNUP,
      actorId: user.id,
      context,
      outcome: AuditOutcome.SUCCESS,
      targetId: user.id,
      targetType: 'User',
    });

    await this.issueAndSendVerificationToken(user);

    return {
      email: user.email,
      id: user.id,
      message: 'User successfully registered. Please sign in to continue.',
    };
  }

  /** Validates the email verification token and marks the user's email as verified. */
  async verifyEmail(token: string): Promise<VerifyEmailResponseDto> {
    const userId = await this.tokenService.consumeVerificationToken(token);

    await this.userRepository.update(userId, { isEmailVerified: true });

    this.logger.log(`Email verified for user: ${userId}`);

    return { message: 'Email successfully verified' };
  }

  /** Generates an access token and a refresh token cookie value for the given user. */
  private async buildAuthResult(user: User): Promise<AuthResult> {
    const [accessToken, cookieValue] = await Promise.all([
      this.tokenService.generateAccessToken(user),
      this.tokenService.issueRefreshToken(user.id),
    ]);
    const { email, id, roles, scopes } = user;

    return {
      accessToken,
      cookieValue,
      user: { email, id, roles, scopes },
    };
  }

  /** Issues a new email verification token and sends the verification email. */
  private async issueAndSendVerificationToken(user: User): Promise<void> {
    const rawToken = await this.tokenService.issueVerificationToken(user.id);
    await this.mailService.sendVerificationEmail(user.email, rawToken);
  }
}
