import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import ms from 'ms';
import { StringValue } from 'ms';
import { Repository } from 'typeorm';

import { User } from '@/users/user.entity';

import { ONE_TIME_TOKEN_SECRET_BYTES } from './constants';
import { EmailVerificationToken } from './email-verification-token.entity';
import { PasswordResetToken } from './password-reset-token.entity';
import { RefreshToken } from './refresh-token.entity';
import { JwtPayload } from './types';
import { createOpaqueToken, parseOpaqueToken, verifyOpaqueToken } from './utils';

@Injectable()
export class TokenService {
  /** Returns the refresh token TTL in milliseconds. */
  get ttlMs(): number {
    return this.ttl;
  }
  private readonly hmacSecret: string;

  private passwordResetTtlMs: number;
  private ttl: number;
  private verificationTtlMs: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    @InjectRepository(RefreshToken)
    private readonly refreshTokenRepository: Repository<RefreshToken>,
    @InjectRepository(EmailVerificationToken)
    private readonly emailVerificationTokenRepository: Repository<EmailVerificationToken>,
    @InjectRepository(PasswordResetToken)
    private readonly passwordResetTokenRepository: Repository<PasswordResetToken>,
  ) {
    this.hmacSecret = this.configService.getOrThrow<string>('TOKEN_HMAC_SECRET');
    this.setTtl();
    this.setVerificationTtl();
    this.setPasswordResetTtl();
  }

  /**
   * Validates a password reset token and atomically marks it as used.
   *
   * The mark-as-used step uses UPDATE … WHERE id = :id AND used_at IS NULL, so
   * concurrent requests racing on the same token will see 0 affected rows on the
   * second attempt and receive 400 instead of resetting the password twice.
   *
   * Returns the `userId` of the token owner.
   */
  async consumePasswordResetToken(rawToken: string): Promise<string> {
    const storedToken = await this.validatePasswordResetToken(rawToken);

    const result = await this.passwordResetTokenRepository
      .createQueryBuilder()
      .update(PasswordResetToken)
      .set({ usedAt: new Date() })
      .where('id = :id', { id: storedToken.id })
      .andWhere('used_at IS NULL')
      .execute();

    if (!result.affected) {
      throw new BadRequestException('Token has already been used');
    }

    return storedToken.userId;
  }

  /**
   * Validates an email verification token and atomically marks it as used.
   *
   * The mark-as-used step uses UPDATE … WHERE id = :id AND used_at IS NULL AND
   * expires_at > NOW(), so concurrent requests racing on the same token will see
   * 0 affected rows on the second attempt and receive 400 instead of verifying
   * the email twice.
   *
   * Returns the `userId` of the token owner.
   */
  async consumeVerificationToken(rawToken: string): Promise<string> {
    const storedToken = await this.validateVerificationToken(rawToken);

    const result = await this.emailVerificationTokenRepository
      .createQueryBuilder()
      .update(EmailVerificationToken)
      .set({ usedAt: new Date() })
      .where('id = :id', { id: storedToken.id })
      .andWhere('used_at IS NULL')
      .andWhere('expires_at > NOW()')
      .execute();

    if (!result.affected) {
      throw new BadRequestException('Token has already been used');
    }

    return storedToken.userId;
  }

  /** Signs and returns a short-lived JWT access token for the given user. */
  async generateAccessToken(user: User): Promise<string> {
    const payload: JwtPayload = {
      email: user.email,
      roles: user.roles,
      scopes: user.scopes,
      sub: user.id,
    };
    return this.jwtService.signAsync(payload);
  }

  /**
   * Issues a password reset token: persists the hashed record and returns
   * the raw `${tokenId}:${rawSecret}` string to embed in the reset link.
   */
  async issuePasswordResetToken(userId: string): Promise<string> {
    const expiresAt = new Date(Date.now() + this.passwordResetTtlMs);
    const { rawSecret, tokenHash } = createOpaqueToken(
      this.hmacSecret,
      ONE_TIME_TOKEN_SECRET_BYTES,
    );

    const record = this.passwordResetTokenRepository.create({
      expiresAt,
      tokenHash,
      usedAt: null,
      userId,
    });
    await this.passwordResetTokenRepository.save(record);

    return `${record.id}:${rawSecret}`;
  }

  /**
   * Revokes all active tokens for the user and issues a new one.
   * Used at signin (single-session model). Signup does not issue tokens.
   * Returns the cookie value: `${tokenId}:${rawSecret}`.
   */
  async issueRefreshToken(userId: string): Promise<string> {
    await this.revokeAllUserTokens(userId);
    return this.createRefreshToken(userId);
  }

  /**
   * Issues an email verification token: persists the hashed record and returns
   * the raw `${tokenId}:${rawSecret}` string to embed in the verification link.
   */
  async issueVerificationToken(userId: string): Promise<string> {
    const expiresAt = new Date(Date.now() + this.verificationTtlMs);
    const { rawSecret, tokenHash } = createOpaqueToken(
      this.hmacSecret,
      ONE_TIME_TOKEN_SECRET_BYTES,
    );

    const record = this.emailVerificationTokenRepository.create({
      expiresAt,
      tokenHash,
      usedAt: null,
      userId,
    });
    await this.emailVerificationTokenRepository.save(record);

    return `${record.id}:${rawSecret}`;
  }

  /** Marks all non-revoked refresh tokens for a user as revoked. */
  async revokeAllUserTokens(userId: string): Promise<void> {
    await this.refreshTokenRepository
      .createQueryBuilder()
      .update(RefreshToken)
      .set({ revokedAt: new Date() })
      .where('user_id = :userId', { userId })
      .andWhere('revoked_at IS NULL')
      .execute();
  }

  /** Marks a single refresh token as revoked by its ID. */
  async revokeRefreshToken(tokenId: string): Promise<void> {
    await this.refreshTokenRepository.update(tokenId, { revokedAt: new Date() });
  }

  /**
   * Validates the cookie value, atomically revokes the old token, and issues a new pair.
   *
   * The revocation uses UPDATE … WHERE id = :id AND revokedAt IS NULL, so concurrent
   * refresh requests racing on the same token will see 0 affected rows on the second
   * attempt and receive 401 instead of being issued a second new token.
   */
  async rotateRefreshToken(cookieValue: string): Promise<{
    accessToken: string;
    cookieValue: string;
  }> {
    const storedToken = await this.validateRefreshToken(cookieValue);

    const result = await this.refreshTokenRepository
      .createQueryBuilder()
      .update(RefreshToken)
      .set({ revokedAt: new Date() })
      .where('id = :id', { id: storedToken.id })
      .andWhere('revoked_at IS NULL')
      .execute();

    if (!result.affected) {
      throw new UnauthorizedException('Refresh token already used or revoked');
    }

    const [accessToken, newCookieValue] = await Promise.all([
      this.generateAccessToken(storedToken.user),
      this.createRefreshToken(storedToken.userId),
    ]);

    return { accessToken, cookieValue: newCookieValue };
  }

  setPasswordResetTtl() {
    this.passwordResetTtlMs = this.parseTtl('PASSWORD_RESET_EXPIRES_IN', '1h');
  }

  setTtl() {
    this.ttl = this.parseTtl('JWT_REFRESH_EXPIRES_IN', '7d');
  }

  setVerificationTtl() {
    this.verificationTtlMs = this.parseTtl('EMAIL_VERIFICATION_EXPIRES_IN', '24h');
  }

  /**
   * Parses and validates a password reset token value (`${id}:${rawSecret}`).
   * Returns the stored record so the caller can mark it as used.
   */
  async validatePasswordResetToken(rawToken: string): Promise<PasswordResetToken> {
    const parsed = parseOpaqueToken(rawToken);
    if (!parsed) throw new BadRequestException('Invalid token');

    const { rawSecret, tokenId } = parsed;

    const storedToken = await this.passwordResetTokenRepository.findOne({
      where: { id: tokenId },
    });

    if (!storedToken?.isUsable) throw new BadRequestException('Invalid or expired token');

    const isValid = verifyOpaqueToken(rawSecret, storedToken.tokenHash, this.hmacSecret);
    if (!isValid) throw new BadRequestException('Invalid or expired token');

    return storedToken;
  }

  /**
   * Parses and validates a refresh token cookie value (`${id}:${rawSecret}`).
   * Loads the user relation so the caller can generate an access token.
   */
  async validateRefreshToken(cookieValue: string): Promise<RefreshToken> {
    const parsed = parseOpaqueToken(cookieValue);
    if (!parsed) throw new UnauthorizedException('Invalid refresh token');

    const { rawSecret, tokenId } = parsed;

    const storedToken = await this.refreshTokenRepository.findOne({
      relations: { user: true },
      where: { id: tokenId },
    });

    if (!storedToken) throw new UnauthorizedException('Invalid refresh token');
    if (!storedToken.isActive) throw new UnauthorizedException('Refresh token expired or revoked');

    const isValid = verifyOpaqueToken(rawSecret, storedToken.tokenHash, this.hmacSecret);
    if (!isValid) throw new UnauthorizedException('Invalid refresh token');

    return storedToken;
  }

  /**
   * Parses and validates a verification token value (`${id}:${rawSecret}`).
   * Returns the stored record so the caller can mark it as used.
   */
  async validateVerificationToken(rawToken: string): Promise<EmailVerificationToken> {
    const parsed = parseOpaqueToken(rawToken);
    if (!parsed) throw new BadRequestException('Invalid token');

    const { rawSecret, tokenId } = parsed;

    const storedToken = await this.emailVerificationTokenRepository.findOne({
      where: { id: tokenId },
    });

    if (!storedToken?.isUsable) throw new BadRequestException('Invalid or expired token');

    const isValid = verifyOpaqueToken(rawSecret, storedToken.tokenHash, this.hmacSecret);
    if (!isValid) throw new BadRequestException('Invalid or expired token');

    return storedToken;
  }

  /** Creates, persists, and returns a new refresh token cookie value for the given user. */
  private async createRefreshToken(userId: string): Promise<string> {
    const expiresAt = new Date(Date.now() + this.ttl);
    const { rawSecret, tokenHash } = createOpaqueToken(this.hmacSecret);

    const token = this.refreshTokenRepository.create({
      expiresAt,
      revokedAt: null,
      tokenHash,
      userId,
    });

    await this.refreshTokenRepository.save(token);

    return `${token.id}:${rawSecret}`;
  }

  /**
   * Reads a duration string from config (falling back to `defaultValue`), parses it with `ms`,
   * and throws if the result is not a positive finite number.
   */
  private parseTtl(envKey: string, defaultValue: StringValue): number {
    const ttlConfig = (this.configService.get<string>(envKey) ?? defaultValue) as StringValue;
    const parsed = ms(ttlConfig);

    if (!parsed || !Number.isFinite(parsed) || parsed <= 0) {
      throw new Error(
        `Invalid ${envKey} value: "${ttlConfig}". Must be a positive duration string (e.g. "7d", "1h").`,
      );
    }

    return parsed;
  }
}
