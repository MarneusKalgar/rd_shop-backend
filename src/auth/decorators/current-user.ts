import { createParamDecorator, ExecutionContext } from '@nestjs/common';

import { AuthUser } from '../types';

interface RequestWithUser extends Request {
  user?: AuthUser;
}

export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): AuthUser => {
    const request = ctx.switchToHttp().getRequest<RequestWithUser>();
    console.log('CurrentUser decorator invoked, request.user:', request.user);
    return request.user!;
  },
);
