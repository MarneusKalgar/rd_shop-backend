import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StringValue } from 'ms';

import { MailModule } from '@/mail/mail.module';
import { User } from '@/users/user.entity';

import { AuthService } from './auth.service';
import { EmailVerificationToken } from './email-verification-token.entity';
import { JwtStrategy } from './jwt.strategy';
import { PasswordResetToken } from './password-reset-token.entity';
import { RefreshToken } from './refresh-token.entity';
import { TokenService } from './token.service';
import { AuthController as AuthControllerV1 } from './v1/auth.controller';

@Module({
  controllers: [AuthControllerV1],
  exports: [AuthService, JwtModule, TokenService],
  imports: [
    TypeOrmModule.forFeature([User, RefreshToken, EmailVerificationToken, PasswordResetToken]),
    MailModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const expiresIn = (configService.get<string>('JWT_ACCESS_EXPIRES_IN') ??
          '15m') as StringValue;

        return {
          secret: configService.get<string>('JWT_ACCESS_SECRET'),
          signOptions: {
            expiresIn: expiresIn,
          },
        };
      },
    }),
  ],
  providers: [AuthService, JwtStrategy, TokenService],
})
export class AuthModule {}
