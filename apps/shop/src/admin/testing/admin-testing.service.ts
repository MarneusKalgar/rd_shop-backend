import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';

import { UserPermissions } from '@/auth/permissions';
import { User } from '@/users/user.entity';
import { isProduction } from '@/utils';

import { CreateVerifiedAdminDto, CreateVerifiedAdminResponseDto } from './dto';

@Injectable()
export class AdminTestingService {
  private readonly saltRounds: number;

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly configService: ConfigService,
  ) {
    this.saltRounds = this.configService.get<number>('BCRYPT_SALT_ROUNDS', 10);
  }

  /**
   * Creates a verified admin user for testing purposes.
   * Throws `ForbiddenException` in production environments.
   */
  async createVerifiedAdmin(dto: CreateVerifiedAdminDto): Promise<CreateVerifiedAdminResponseDto> {
    if (isProduction()) {
      throw new ForbiddenException('This endpoint is not available in production');
    }

    const existing = await this.userRepository.findOne({ where: { email: dto.email } });
    if (existing) throw new ConflictException('Email already in use');

    const hashedPassword = await bcrypt.hash(dto.password, this.saltRounds);

    const user = this.userRepository.create({
      email: dto.email,
      isEmailVerified: true,
      password: hashedPassword,
      roles: [...UserPermissions.Admin.roles],
      scopes: [...UserPermissions.Admin.scopes],
    });

    await this.userRepository.save(user);

    return { email: user.email, id: user.id };
  }
}
