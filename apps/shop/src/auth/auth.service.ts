import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';

import { UserEmailExistsError } from '@/common/errors';
import { MailService } from '@/mail/mail.service';
import { User } from '@/users/user.entity';

import {
  AuthResult,
  RefreshResponseDto,
  ResendVerificationResponseDto,
  SigninDto,
  SignupDto,
  SignupResponseDto,
  VerifyEmailResponseDto,
} from './dto';
import { EmailVerificationToken } from './email-verification-token.entity';
import { TokenService } from './token.service';
import { parseOpaqueToken } from './utils';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly saltRounds: number;

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(EmailVerificationToken)
    private readonly emailVerificationTokenRepository: Repository<EmailVerificationToken>,
    private readonly configService: ConfigService,
    private readonly mailService: MailService,
    private readonly tokenService: TokenService,
  ) {
    this.saltRounds = this.configService.get<number>('BCRYPT_SALT_ROUNDS', 10);
  }

  async logout(cookieValue: string): Promise<void> {
    const parsed = parseOpaqueToken(cookieValue);
    if (!parsed) return;
    await this.tokenService.revokeRefreshToken(parsed.tokenId);
  }

  async refresh(
    cookieValue: string | undefined,
  ): Promise<RefreshResponseDto & { cookieValue: string }> {
    if (!cookieValue) throw new UnauthorizedException('Missing refresh token');

    const { accessToken, cookieValue: newCookieValue } =
      await this.tokenService.rotateRefreshToken(cookieValue);
    return { accessToken, cookieValue: newCookieValue };
  }

  async resendVerification(userId: string): Promise<ResendVerificationResponseDto> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    if (user.isEmailVerified) {
      throw new ConflictException('Email is already verified');
    }

    const oneMinuteAgo = new Date(Date.now() - 60_000);
    const recentToken = await this.emailVerificationTokenRepository.findOne({
      order: { createdAt: 'DESC' },
      where: { userId },
    });

    if (recentToken && recentToken.createdAt > oneMinuteAgo) {
      throw new HttpException(
        'Please wait before requesting another verification email',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    await this.issueAndSendVerificationToken(user);

    return { message: 'Verification email sent' };
  }

  async signin(signinDto: SigninDto): Promise<AuthResult> {
    const { email, password } = signinDto;

    const user = await this.userRepository
      .createQueryBuilder('user')
      .addSelect('user.password')
      .where('user.email = :email', { email })
      .getOne();

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    this.logger.log(`User signed in: ${user.email}`);

    return this.buildAuthResult(user);
  }

  async signup(signupDto: SignupDto): Promise<SignupResponseDto> {
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

    const user = this.userRepository.create({
      email,
      password: hashedPassword,
    });

    await this.userRepository.save(user);

    this.logger.log(`New user registered: ${user.email}`);

    await this.issueAndSendVerificationToken(user);

    return {
      email: user.email,
      id: user.id,
      message: 'User successfully registered. Please sign in to continue.',
    };
  }

  async verifyEmail(token: string): Promise<VerifyEmailResponseDto> {
    const storedToken = await this.tokenService.validateVerificationToken(token);

    await Promise.all([
      this.emailVerificationTokenRepository.update(storedToken.id, { usedAt: new Date() }),
      this.userRepository.update(storedToken.userId, { isEmailVerified: true }),
    ]);

    this.logger.log(`Email verified for user: ${storedToken.userId}`);

    return { message: 'Email successfully verified' };
  }

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

  private async issueAndSendVerificationToken(user: User): Promise<void> {
    const rawToken = await this.tokenService.issueVerificationToken(user.id);
    await this.mailService.sendVerificationEmail(user.email, rawToken);
  }
}
