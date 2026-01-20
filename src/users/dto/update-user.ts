import { IsEmail, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateUserDto {
  @IsEmail()
  @IsNotEmpty()
  @IsOptional()
  email?: string;

  @IsNotEmpty()
  @IsOptional()
  @IsString()
  firstName?: string;

  @IsNotEmpty()
  @IsOptional()
  @IsString()
  lastName?: string;

  @IsNotEmpty()
  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;
}
