import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';

import { UserEmailExistsError } from '@/common/errors';
import { User } from '@/users/user.entity';

import { SigninDto, SigninResponseDto, SignupDto, SignupResponseDto } from './dto';
import { JwtPayload } from './types';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly saltRounds: number;

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {
    this.saltRounds = this.configService.get<number>('BCRYPT_SALT_ROUNDS', 10);
  }

  /**
   * Sign in existing user
   */
  async signin(signinDto: SigninDto): Promise<SigninResponseDto> {
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

    const authResponse = await this.generateAuthResponse(user);

    return authResponse;
  }

  /**
   * Register a new user
   */
  async signup(signupDto: SignupDto): Promise<SignupResponseDto> {
    const { email, password } = signupDto;

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
      roles: signupDto.roles,
      scopes: signupDto.scopes,
    });

    await this.userRepository.save(user);

    this.logger.log(`New user registered: ${user.email}`);

    return {
      email: user.email,
      id: user.id,
      message: 'User successfully registered. Please sign in to continue.',
      roles: user.roles,
      scopes: user.scopes,
    };
  }

  /**
   * Generate JWT token and auth response
   */
  private async generateAuthResponse(user: User): Promise<SigninResponseDto> {
    const payload: JwtPayload = {
      email: user.email,
      roles: user.roles,
      scopes: user.scopes,
      sub: user.id,
    };

    const accessToken = await this.jwtService.signAsync(payload);

    return {
      accessToken,
      user: {
        email: user.email,
        id: user.id,
        roles: user.roles,
        scopes: user.scopes,
      },
    };
  }
}
