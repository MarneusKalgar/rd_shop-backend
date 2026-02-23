import { Injectable } from '@nestjs/common';

import { CreateUserDto, UpdateUserDto } from './dto';
import { User } from './user.entity';

const mockUser = {
  createdAt: new Date(),
  email: 'john@example.com',
  firstName: 'John',
  id: '1',
  lastName: 'Doe',
  orders: [],
  password: 'hashedpassword123',
  roles: ['user'],
  scopes: ['read:products'],
  updatedAt: new Date(),
};

@Injectable()
export class UsersService {
  async create(createUserDto: CreateUserDto): Promise<User> {
    // TODO: Implement user creation logic
    return await Promise.resolve({
      ...mockUser,
      ...createUserDto,
    });
  }

  async findAll(): Promise<User[]> {
    // TODO: Implement fetching all users
    return await Promise.resolve([mockUser]);
  }

  async findOne(id: string): Promise<User> {
    // TODO: Implement fetching user by id
    console.log(id);
    return await Promise.resolve(mockUser);
  }

  async remove(id: string): Promise<{ id: string }> {
    // TODO: Implement user deletion logic
    return await Promise.resolve({ id });
  }

  async update(id: string, updateUserDto: UpdateUserDto): Promise<User> {
    // TODO: Implement user update logic
    return await Promise.resolve({
      ...mockUser,
      ...updateUserDto,
      id,
    });
  }
}
