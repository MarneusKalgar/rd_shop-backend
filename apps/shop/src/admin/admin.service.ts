import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { User } from '@/users/user.entity';

import { UpdateUserPermissionsDto, UpdateUserPermissionsResponseDto } from './dto';

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  /** Overwrites the roles and scopes for the specified user. */
  async updateUserPermissions(
    userId: string,
    dto: UpdateUserPermissionsDto,
  ): Promise<UpdateUserPermissionsResponseDto> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    await this.userRepository.update(userId, { roles: dto.roles, scopes: dto.scopes });

    return { message: 'User permissions updated successfully' };
  }
}
