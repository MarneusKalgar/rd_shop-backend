import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { SCOPES_KEY } from '../decorators';
import { AuthUser, RequestWithUser } from '../types';

@Injectable()
export class ScopesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredScopes = this.reflector.getAllAndOverride<string[]>(SCOPES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredScopes?.length) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user as AuthUser;
    const result = requiredScopes.every((scope) => user.scopes?.includes(scope));

    if (!result) {
      throw new ForbiddenException('Insufficient scope');
    }

    return true;
  }
}
