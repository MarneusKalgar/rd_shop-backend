import { Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export const InjectConfig = () => Inject(ConfigService);
