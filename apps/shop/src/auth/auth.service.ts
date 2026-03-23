import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';

import { UserEmailExistsError } from '@/common/errors';
import { User } from '@/users/user.entity';

import { AuthResult, RefreshResponseDto, SigninDto, SignupDto, SignupResponseDto } from './dto';
import { TokenService } from './token.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly saltRounds: number;

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly configService: ConfigService,
    private readonly tokenService: TokenService,
  ) {
    this.saltRounds = this.configService.get<number>('BCRYPT_SALT_ROUNDS', 10);
  }

  async logout(cookieValue: string): Promise<void> {
    const colonIndex = cookieValue.indexOf(':');
    if (colonIndex === -1) return;
    const tokenId = cookieValue.substring(0, colonIndex);
    await this.tokenService.revokeRefreshToken(tokenId);
  }

  async refresh(
    cookieValue: string | undefined,
  ): Promise<RefreshResponseDto & { cookieValue: string }> {
    if (!cookieValue) throw new UnauthorizedException('Missing refresh token');

    const { accessToken, cookieValue: newCookieValue } =
      await this.tokenService.rotateRefreshToken(cookieValue);
    return { accessToken, cookieValue: newCookieValue };
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

    return {
      email: user.email,
      id: user.id,
      message: 'User successfully registered. Please sign in to continue.',
    };
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
}
