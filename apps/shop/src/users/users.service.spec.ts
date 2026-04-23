import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { AuditLogService } from '../audit-log/audit-log.service';
import { TokenService } from '../auth/token.service';
import { FilesService } from '../files/files.service';
import { User } from './user.entity';
import { UsersService } from './users.service';

const mockUserRepository = {
  createQueryBuilder: jest.fn(),
  findOne: jest.fn(),
  save: jest.fn(),
  softDelete: jest.fn(),
  update: jest.fn(),
};

const mockConfigService = {
  get: jest.fn().mockReturnValue(10),
};

const mockFilesService = {
  getPresignedUrlForFileId: jest.fn(),
  prepareFileForEntity: jest.fn(),
};

const mockTokenService = {
  revokeAllUserTokens: jest.fn(),
};

const mockAuditLogService = {
  log: jest.fn(),
};

describe('UsersService', () => {
  let service: UsersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: mockUserRepository },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: FilesService, useValue: mockFilesService },
        { provide: TokenService, useValue: mockTokenService },
        { provide: AuditLogService, useValue: mockAuditLogService },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
