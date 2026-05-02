import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { AuditLogService } from '@/audit-log';
import { MailService } from '@/mail/mail.service';
import { User } from '@/users/user.entity';

import { AuthService } from './auth.service';
import { TokenService } from './token.service';

const mockUserRepository = {
  create: jest.fn(),
  createQueryBuilder: jest.fn(),
  findOne: jest.fn(),
  save: jest.fn(),
  update: jest.fn(),
};

const mockConfigService = {
  get: jest.fn(),
};

const mockMailService = {
  sendPasswordResetEmail: jest.fn(),
  sendVerificationEmail: jest.fn(),
};

const mockTokenService = {
  issuePasswordResetToken: jest.fn(),
  issueVerificationToken: jest.fn(),
};

const mockAuditLogService = {
  log: jest.fn(),
};

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    jest.clearAllMocks();

    mockConfigService.get.mockReturnValue(4);
    mockUserRepository.create.mockImplementation(
      (value) =>
        ({
          id: 'user-1',
          isEmailVerified: false,
          ...value,
        }) as unknown as User,
    );
    mockUserRepository.save.mockImplementation((user) => user as unknown as User);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(User), useValue: mockUserRepository },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: MailService, useValue: mockMailService },
        { provide: TokenService, useValue: mockTokenService },
        { provide: AuditLogService, useValue: mockAuditLogService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('returns signup success when verification email delivery fails after user save', async () => {
    mockUserRepository.findOne.mockResolvedValue(null);
    mockTokenService.issueVerificationToken.mockResolvedValue('verification-token');
    mockMailService.sendVerificationEmail.mockRejectedValue(new Error('SES access denied'));

    await expect(
      service.signup({
        confirmedPassword: 'SecurePass123!',
        email: 'user@example.com',
        password: 'SecurePass123!',
      }),
    ).resolves.toEqual({
      email: 'user@example.com',
      id: 'user-1',
      message: 'User successfully registered. Please sign in to continue.',
    });

    expect(mockUserRepository.save).toHaveBeenCalledTimes(1);
    expect(mockTokenService.issueVerificationToken).toHaveBeenCalledWith('user-1');
    expect(mockMailService.sendVerificationEmail).toHaveBeenCalledWith(
      'user@example.com',
      'verification-token',
    );
  });

  it('returns forgot-password safe response when reset email delivery fails', async () => {
    mockUserRepository.findOne.mockResolvedValue({
      email: 'user@example.com',
      id: 'user-1',
    });
    mockTokenService.issuePasswordResetToken.mockResolvedValue('reset-token');
    mockMailService.sendPasswordResetEmail.mockRejectedValue(new Error('SES access denied'));

    await expect(service.forgotPassword({ email: 'user@example.com' })).resolves.toEqual({
      message: 'If this email exists, a reset link has been sent',
    });

    expect(mockTokenService.issuePasswordResetToken).toHaveBeenCalledWith('user-1');
    expect(mockMailService.sendPasswordResetEmail).toHaveBeenCalledWith(
      'user@example.com',
      'reset-token',
    );
  });

  it('still fails resendVerification when email delivery fails', async () => {
    mockUserRepository.findOne.mockResolvedValue({
      email: 'user@example.com',
      id: 'user-1',
      isEmailVerified: false,
    });
    mockTokenService.issueVerificationToken.mockResolvedValue('verification-token');

    const deliveryError = new Error('SES access denied');
    mockMailService.sendVerificationEmail.mockRejectedValue(deliveryError);

    await expect(service.resendVerification('user-1')).rejects.toThrow(deliveryError);
  });
});
