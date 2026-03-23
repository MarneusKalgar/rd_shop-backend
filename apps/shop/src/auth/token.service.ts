import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import ms from 'ms';
import { StringValue } from 'ms';
import * as crypto from 'node:crypto';
import { Repository } from 'typeorm';

import { User } from '@/users/user.entity';

import { EmailVerificationToken } from './email-verification-token.entity';
import { RefreshToken } from './refresh-token.entity';
import { JwtPayload } from './types';
import { parseOpaqueToken } from './utils';

@Injectable()
export class TokenService {
  get ttlMs(): number {
    return this.ttl;
  }
  private readonly saltRounds: number;

  private ttl: number;
  private verificationTtlMs: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    @InjectRepository(RefreshToken)
    private readonly refreshTokenRepository: Repository<RefreshToken>,
    @InjectRepository(EmailVerificationToken)
    private readonly emailVerificationTokenRepository: Repository<EmailVerificationToken>,
  ) {
    this.saltRounds = this.configService.get<number>('BCRYPT_SALT_ROUNDS', 10);
    this.setTtl();
    this.setVerificationTtl();
  }

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
    const { rawSecret, tokenHash } = await this.createOpaqueToken(32);

    const record = this.emailVerificationTokenRepository.create({
      expiresAt,
      tokenHash,
      usedAt: null,
      userId,
    });
    await this.emailVerificationTokenRepository.save(record);

    return `${record.id}:${rawSecret}`;
  }

  async revokeAllUserTokens(userId: string): Promise<void> {
    await this.refreshTokenRepository
      .createQueryBuilder()
      .update(RefreshToken)
      .set({ revokedAt: new Date() })
      .where('user_id = :userId', { userId })
      .andWhere('revoked_at IS NULL')
      .execute();
  }

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

  setTtl() {
    const ttlConfig = (this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') ??
      '7d') as StringValue;
    const parsed = ms(ttlConfig);
    if (!parsed || !Number.isFinite(parsed) || parsed <= 0) {
      throw new Error(
        `Invalid JWT_REFRESH_EXPIRES_IN value: "${ttlConfig}". Must be a positive duration string (e.g. "7d", "1h").`,
      );
    }
    this.ttl = parsed;
  }

  setVerificationTtl() {
    const ttlConfig = (this.configService.get<string>('EMAIL_VERIFICATION_EXPIRES_IN') ??
      '24h') as StringValue;
    const parsed = ms(ttlConfig);
    if (!parsed || !Number.isFinite(parsed) || parsed <= 0) {
      throw new Error(
        `Invalid EMAIL_VERIFICATION_EXPIRES_IN value: "${ttlConfig}". Must be a positive duration string (e.g. "24h", "7d").`,
      );
    }
    this.verificationTtlMs = parsed;
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

    const isValid = await bcrypt.compare(rawSecret, storedToken.tokenHash);
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

    const isValid = await bcrypt.compare(rawSecret, storedToken.tokenHash);
    if (!isValid) throw new BadRequestException('Invalid or expired token');

    return storedToken;
  }

  /**
   * Generates a raw secret and its bcrypt hash.
   * @param bytes  Length of the raw secret in bytes (default 64).
   */
  private async createOpaqueToken(bytes = 64): Promise<{ rawSecret: string; tokenHash: string }> {
    const rawSecret = crypto.randomBytes(bytes).toString('hex');
    const tokenHash = await bcrypt.hash(rawSecret, this.saltRounds);
    return { rawSecret, tokenHash };
  }

  private async createRefreshToken(userId: string): Promise<string> {
    const expiresAt = new Date(Date.now() + this.ttl);
    const { rawSecret, tokenHash } = await this.createOpaqueToken();

    const token = this.refreshTokenRepository.create({
      expiresAt,
      revokedAt: null,
      tokenHash,
      userId,
    });
    await this.refreshTokenRepository.save(token);

    return `${token.id}:${rawSecret}`;
  }
}
