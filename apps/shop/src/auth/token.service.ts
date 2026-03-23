import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import ms from 'ms';
import { StringValue } from 'ms';
import * as crypto from 'node:crypto';
import { Repository } from 'typeorm';

import { User } from '@/users/user.entity';

import { RefreshToken } from './refresh-token.entity';
import { JwtPayload } from './types';

@Injectable()
export class TokenService {
  private readonly saltRounds: number;
  private ttl: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    @InjectRepository(RefreshToken)
    private readonly refreshTokenRepository: Repository<RefreshToken>,
  ) {
    this.saltRounds = this.configService.get<number>('BCRYPT_SALT_ROUNDS', 10);
    this.setTtl();
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
   * Used at signin / signup (single-session model).
   * Returns the cookie value: `${tokenId}:${rawSecret}`.
   */
  async issueRefreshToken(userId: string): Promise<string> {
    await this.revokeAllUserTokens(userId);
    return this.createRefreshToken(userId);
  }

  async revokeAllUserTokens(userId: string): Promise<void> {
    await this.refreshTokenRepository
      .createQueryBuilder()
      .update(RefreshToken)
      .set({ revokedAt: new Date() })
      .where('userId = :userId', { userId })
      .andWhere('revokedAt IS NULL')
      .execute();
  }

  async revokeRefreshToken(tokenId: string): Promise<void> {
    await this.refreshTokenRepository.update(tokenId, { revokedAt: new Date() });
  }

  /**
   * Validates the cookie value, revokes the old token, and issues a new pair.
   * Used at the /refresh endpoint.
   */
  async rotateRefreshToken(cookieValue: string): Promise<{
    accessToken: string;
    cookieValue: string;
  }> {
    const storedToken = await this.validateRefreshToken(cookieValue);

    await this.revokeRefreshToken(storedToken.id);

    const accessToken = await this.generateAccessToken(storedToken.user);
    const newCookieValue = await this.createRefreshToken(storedToken.userId);

    return { accessToken, cookieValue: newCookieValue };
  }

  setTtl() {
    const ttlConfig = (this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') ??
      '7d') as StringValue;
    this.ttl = ms(ttlConfig);
  }

  /**
   * Parses and validates a refresh token cookie value (`${id}:${rawSecret}`).
   * Loads the user relation so the caller can generate an access token.
   */
  async validateRefreshToken(cookieValue: string): Promise<RefreshToken> {
    const colonIndex = cookieValue.indexOf(':');
    if (colonIndex === -1) throw new UnauthorizedException('Invalid refresh token');

    const tokenId = cookieValue.substring(0, colonIndex);
    const rawSecret = cookieValue.substring(colonIndex + 1);

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

  private async createRefreshToken(userId: string): Promise<string> {
    const rawSecret = crypto.randomBytes(64).toString('hex');
    const expiresAt = new Date(Date.now() + this.ttl);
    const tokenHash = await bcrypt.hash(rawSecret, this.saltRounds);

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
