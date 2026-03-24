import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';

import { TokenService } from '../auth/token.service';
import {
  ChangePasswordDto,
  FindUsersDto,
  UpdateProfileDto,
  UserResponseDto,
  UsersListResponseDto,
} from './dto';
import { User } from './user.entity';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);
  private readonly saltRounds: number;

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly configService: ConfigService,
    private readonly tokenService: TokenService,
  ) {
    this.saltRounds = this.configService.get<number>('BCRYPT_SALT_ROUNDS', 10);
  }

  async changePassword(userId: string, dto: ChangePasswordDto): Promise<void> {
    if (dto.newPassword !== dto.confirmedPassword) {
      throw new BadRequestException('Passwords do not match');
    }

    const user = await this.userRepository.findOne({
      select: ['id', 'password'],
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException(`User with ID "${userId}" not found`);
    }

    const isCurrentPasswordValid = await bcrypt.compare(dto.currentPassword, user.password);
    if (!isCurrentPasswordValid) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    const hashedPassword = await bcrypt.hash(dto.newPassword, this.saltRounds);

    await Promise.all([
      this.userRepository.update(userId, { password: hashedPassword }),
      this.tokenService.revokeAllUserTokens(userId),
    ]);

    this.logger.log(`Password changed for user: ${userId}`);
  }

  async findAll(dto: FindUsersDto = {}): Promise<UsersListResponseDto> {
    const limit = dto.limit ?? 10;

    const qb = this.userRepository
      .createQueryBuilder('user')
      .orderBy('user.createdAt', 'DESC')
      .addOrderBy('user.id', 'DESC')
      .limit(limit + 1);

    if (dto.cursor) {
      const cursorUser = await this.userRepository.findOne({ where: { id: dto.cursor } });
      if (!cursorUser) {
        throw new BadRequestException(`Invalid cursor: no user found for id "${dto.cursor}"`);
      }
      qb.where(
        '(user.created_at < :createdAt OR (user.created_at = :createdAt AND user.id < :id))',
        { createdAt: cursorUser.createdAt, id: cursorUser.id },
      );
    }

    const users = await qb.getMany();

    const hasNextPage = users.length > limit;
    const page = hasNextPage ? users.slice(0, limit) : users;
    const nextCursor = hasNextPage ? page[page.length - 1].id : null;
    const data = page.map((u) => UserResponseDto.fromEntity(u));

    return {
      data,
      limit,
      nextCursor,
    };
  }

  async findById(id: string): Promise<UserResponseDto> {
    const user = await this.userRepository.findOne({ where: { id } });

    if (!user) {
      throw new NotFoundException(`User with ID "${id}" not found`);
    }

    return UserResponseDto.fromEntity(user);
  }

  async getProfile(userId: string): Promise<UserResponseDto> {
    const user = await this.userRepository.findOne({ where: { id: userId } });

    if (!user) {
      throw new NotFoundException(`User with ID "${userId}" not found`);
    }

    return UserResponseDto.fromEntity(user);
  }

  async remove(id: string): Promise<void> {
    const user = await this.userRepository.findOne({ where: { id } });

    if (!user) {
      throw new NotFoundException(`User with ID "${id}" not found`);
    }

    await Promise.all([
      this.userRepository.softDelete(id),
      this.tokenService.revokeAllUserTokens(id),
    ]);

    this.logger.log(`Soft-deleted user: ${id}`);
  }

  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<UserResponseDto> {
    const user = await this.userRepository.findOne({ where: { id: userId } });

    if (!user) {
      throw new NotFoundException(`User with ID "${userId}" not found`);
    }

    Object.assign(user, dto);
    const updated = await this.userRepository.save(user);
    return UserResponseDto.fromEntity(updated);
  }
}
