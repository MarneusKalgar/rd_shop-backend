import { User } from '../user.entity';

export class UserDataResponseDto {
  data: UserResponseDto;
  message?: string;
}

export class UserResponseDto {
  avatarId: null | string;
  avatarUrl: null | string;
  city: null | string;
  country: null | string;
  createdAt: Date;
  email: string;
  firstName: null | string;
  id: string;
  isEmailVerified: boolean;
  lastName: null | string;
  phone: null | string;
  postcode: null | string;
  roles: string[];
  scopes: string[];

  static fromEntity(user: User): UserResponseDto {
    const dto = new UserResponseDto();
    dto.id = user.id;
    dto.email = user.email;
    dto.firstName = user.firstName;
    dto.lastName = user.lastName;
    dto.phone = user.phone;
    dto.city = user.city;
    dto.country = user.country;
    dto.postcode = user.postcode;
    dto.avatarId = user.avatarId;
    dto.avatarUrl = null;
    dto.roles = user.roles;
    dto.scopes = user.scopes;
    dto.isEmailVerified = user.isEmailVerified;
    dto.createdAt = user.createdAt;
    return dto;
  }
}

export class UsersListResponseDto {
  data: UserResponseDto[];
  limit: number;
  nextCursor: null | string;
}
