import { ExecutionContext, Injectable } from '@nestjs/common';
import { GqlContextType } from '@nestjs/graphql';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';

import { AuthUser } from '../types';

type RequestWithLog = Request & {
  log?: { setBindings?: (bindings: Record<string, unknown>) => void };
};

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const canActivate = await super.canActivate(context);
    if (canActivate && context.getType<GqlContextType>() === 'http') {
      const request = context.switchToHttp().getRequest<RequestWithLog>();
      const user = request.user as AuthUser | undefined;
      if (user?.sub && request.log?.setBindings) {
        request.log.setBindings({ userId: user.sub });
      }
    }
    return canActivate as boolean;
  }
}
