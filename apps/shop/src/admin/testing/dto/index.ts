import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';

export class CreateVerifiedAdminDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsNotEmpty()
  @IsString()
  @MinLength(8)
  password: string;
}

export class CreateVerifiedAdminResponseDto {
  email: string;
  id: string;
}
