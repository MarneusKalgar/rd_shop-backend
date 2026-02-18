import { Args, Query, Resolver } from '@nestjs/graphql';

import { UsersService } from '@/users/users.service';

import { UserType } from '../schemas';

@Resolver(() => UserType)
export class UsersResolver {
  constructor(private readonly usersService: UsersService) {}

  @Query(() => UserType, { description: 'Get user by ID', name: 'user', nullable: true })
  async getUser(@Args('id') id: string): Promise<null | UserType> {
    const result = this.usersService.findOne(id);
    return await Promise.resolve(result);
  }

  @Query(() => [UserType], { description: 'Get all users', name: 'users' })
  async getUsers(): Promise<UserType[]> {
    return await this.usersService.findAll();
  }
}
