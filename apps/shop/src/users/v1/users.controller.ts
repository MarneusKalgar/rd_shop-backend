import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';

import { CreateUserDto, UpdateUserDto } from '../dto';
import { UsersService } from '../users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  createUser(@Body() createUserDto: CreateUserDto) {
    return this.usersService.create(createUserDto);
  }

  @Delete(':id')
  deleteUser(@Param('id') id: string) {
    return this.usersService.remove(id);
  }

  @Get(':id')
  getUserById(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @Get()
  getUsers() {
    return this.usersService.findAll();
  }

  @Patch(':id')
  updateUser(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
    return this.usersService.update(id, updateUserDto);
  }
}
