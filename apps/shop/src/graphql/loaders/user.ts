import { Injectable, Scope } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import DataLoader from 'dataloader';
import { In, Repository } from 'typeorm';

import { User } from '@/users/user.entity';

@Injectable({ scope: Scope.REQUEST })
export class UserLoader {
  readonly byId = new DataLoader<string, null | User>(async (userIds: readonly string[]) => {
    const users = await this.userRepository.find({
      where: { id: In([...userIds]) },
    });

    const userMap = new Map(users.map((user) => [user.id, user]));

    return userIds.map((id) => userMap.get(id) ?? null);
  });

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}
}
