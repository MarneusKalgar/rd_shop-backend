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

import { AuditAction, AuditLogService, AuditOutcome } from '@/audit-log';
import { AuditEventContext } from '@/audit-log/audit-log.types';
import { AuthUser } from '@/auth/types';

import { TokenService } from '../auth/token.service';
import { FilesService } from '../files/files.service';
import {
  ChangePasswordDto,
  FindUsersDto,
  SetAvatarDto,
  UpdateProfileDto,
  UpdateRolesDto,
  UpdateScopesDto,
  UpdateUserPermissionsResponseDto,
  UserDataResponseDto,
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
    private readonly filesService: FilesService,
    private readonly tokenService: TokenService,
    private readonly auditLogService: AuditLogService,
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

    if (!user.password) {
      throw new UnauthorizedException('Current password is incorrect');
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

    if (dto.search) {
      const escaped = dto.search.replace(/[%_\\]/g, '\\$&');
      const term = `%${escaped}%`;
      qb.where(
        `(user.firstName ILIKE :term ESCAPE '\\' OR user.lastName ILIKE :term ESCAPE '\\' OR user.email ILIKE :term ESCAPE '\\')`,
        { term },
      );
    }

    if (dto.cursor) {
      const cursorUser = await this.userRepository.findOne({ where: { id: dto.cursor } });
      if (!cursorUser) {
        throw new BadRequestException(`Invalid cursor: no user found for id "${dto.cursor}"`);
      }

      qb.andWhere(
        '(user.createdAt < :createdAt OR (user.createdAt = :createdAt AND user.id < :id))',
        {
          createdAt: cursorUser.createdAt,
          id: cursorUser.id,
        },
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

  async findById(id: string): Promise<UserDataResponseDto> {
    const user = await this.findUserOrFail(id);

    const dto = UserResponseDto.fromEntity(user);
    dto.avatarUrl = await this.resolveAvatarUrl(user.avatarId);
    return { data: dto };
  }

  async getProfile(userId: string): Promise<UserDataResponseDto> {
    const user = await this.findUserOrFail(userId);

    const dto = UserResponseDto.fromEntity(user);
    dto.avatarUrl = await this.resolveAvatarUrl(user.avatarId);
    return { data: dto };
  }

  async remove(id: string, actor?: AuthUser, context?: AuditEventContext): Promise<void> {
    await this.findUserOrFail(id);

    await Promise.all([
      this.userRepository.softDelete(id),
      this.tokenService.revokeAllUserTokens(id),
    ]);

    this.logger.log(`Soft-deleted user: ${id}`);

    void this.auditLogService.log({
      action: AuditAction.USER_SOFT_DELETED,
      actorId: actor?.sub ?? null,
      actorRole: actor?.roles.join(',') ?? null,
      context,
      outcome: AuditOutcome.SUCCESS,
      targetId: id,
      targetType: 'User',
    });
  }

  async removeAvatar(userId: string): Promise<void> {
    await this.userRepository.update(userId, { avatarId: null });
    this.logger.log(`Removed avatar for user: ${userId}`);
  }

  async setAvatar(userId: string, dto: SetAvatarDto): Promise<UserDataResponseDto> {
    const user = await this.findUserOrFail(userId);

    const { fileId, presignedUrl } = await this.filesService.prepareFileForEntity(
      userId,
      dto.fileId,
    );

    user.avatarId = fileId;
    const updated = await this.userRepository.save(user);

    const response = UserResponseDto.fromEntity(updated);
    response.avatarUrl = presignedUrl;
    return { data: response };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<UserDataResponseDto> {
    const user = await this.findUserOrFail(userId);

    Object.assign(user, dto);
    const updated = await this.userRepository.save(user);
    const response = UserResponseDto.fromEntity(updated);
    response.avatarUrl = await this.resolveAvatarUrl(updated.avatarId);
    return { data: response };
  }

  async updateRoles(
    userId: string,
    dto: UpdateRolesDto,
    actor?: AuthUser,
    context?: AuditEventContext,
  ): Promise<UpdateUserPermissionsResponseDto> {
    await this.findUserOrFail(userId);
    await this.userRepository.update(userId, { roles: dto.roles });

    void this.auditLogService.log({
      action: AuditAction.USER_ROLE_CHANGED,
      actorId: actor?.sub ?? null,
      actorRole: actor?.roles.join(',') ?? null,
      context,
      outcome: AuditOutcome.SUCCESS,
      targetId: userId,
      targetType: 'User',
    });

    return { message: 'User roles updated successfully' };
  }

  async updateScopes(
    userId: string,
    dto: UpdateScopesDto,
    actor?: AuthUser,
    context?: AuditEventContext,
  ): Promise<UpdateUserPermissionsResponseDto> {
    await this.findUserOrFail(userId);
    await this.userRepository.update(userId, { scopes: dto.scopes });

    void this.auditLogService.log({
      action: AuditAction.USER_SCOPE_CHANGED,
      actorId: actor?.sub ?? null,
      actorRole: actor?.roles.join(',') ?? null,
      context,
      outcome: AuditOutcome.SUCCESS,
      targetId: userId,
      targetType: 'User',
    });

    return { message: 'User scopes updated successfully' };
  }

  private async findUserOrFail(id: string): Promise<User> {
    const user = await this.userRepository.findOne({ where: { id } });

    if (!user) {
      throw new NotFoundException(`User with ID "${id}" not found`);
    }

    return user;
  }

  private async resolveAvatarUrl(avatarId: null | string): Promise<null | string> {
    if (!avatarId) return null;
    return this.filesService.getPresignedUrlForFileId(avatarId);
  }
}
