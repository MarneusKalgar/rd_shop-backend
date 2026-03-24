import { Args, Query, Resolver } from '@nestjs/graphql';

import { UserResponseDto, UsersListResponseDto } from '@/users/dto/user-response.dto';
import { UsersService } from '@/users/users.service';

import { UserType } from '../schemas';

@Resolver(() => UserType)
export class UsersResolver {
  constructor(private readonly usersService: UsersService) {}

  @Query(() => UserType, { description: 'Get user by ID', name: 'user', nullable: true })
  async getUser(@Args('id') id: string): Promise<null | UserResponseDto> {
    const result = this.usersService.findById(id);
    return await Promise.resolve(result);
  }

  @Query(() => [UserType], { description: 'Get all users', name: 'users' })
  async getUsers(): Promise<UsersListResponseDto> {
    return await this.usersService.findAll();
  }
}
