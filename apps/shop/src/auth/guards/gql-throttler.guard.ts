import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GqlExecutionContext } from '@nestjs/graphql';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
  ThrottlerModuleOptions,
  ThrottlerStorage,
} from '@nestjs/throttler';
import { Request, Response } from 'express';

@Injectable()
export class GqlThrottlerGuard extends ThrottlerGuard {
  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
  ) {
    super(options, storageService, reflector);
  }

  getRequestResponse(context: ExecutionContext) {
    if (context.getType<string>() !== 'graphql') {
      return super.getRequestResponse(context);
    }

    const gqlCtx = GqlExecutionContext.create(context);
    const ctx = gqlCtx.getContext<{ req: Request; res: Response }>();
    return { req: ctx.req, res: ctx.res };
  }

  protected override shouldSkip(): Promise<boolean> {
    return Promise.resolve(process.env.THROTTLE_SKIP === 'true');
  }
}
