import { Injectable } from '@nestjs/common';

import { CreateUserDto, UpdateUserDto } from './v1/dto';
import { IUser } from './v1/interfaces';

@Injectable()
export class UsersService {
  create(createUserDto: CreateUserDto): IUser {
    // TODO: Implement user creation logic
    return {
      id: '1',
      ...createUserDto,
      createdAt: new Date(),
    };
  }

  findAll(): IUser[] {
    // TODO: Implement fetching all users
    return [];
  }

  findOne(id: string): IUser {
    // TODO: Implement fetching user by id
    return {
      email: 'john@example.com',
      firstName: 'John',
      id,
      lastName: 'Doe',
    };
  }

  remove(id: string) {
    // TODO: Implement user deletion logic
    return {
      id,
    };
  }

  update(id: string, updateUserDto: UpdateUserDto): IUser {
    // TODO: Implement user update logic
    return {
      id,
      ...updateUserDto,
      updatedAt: new Date(),
    } as IUser;
  }
}
