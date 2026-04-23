import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Request } from 'express';

/**
 * Rate-limits unauthenticated auth endpoints (forgot-password) by email address
 * rather than by IP, to prevent abuse across proxies.
 */
@Injectable()
export class UserEmailThrottleGuard extends ThrottlerGuard {
  protected getTracker(req: Request): Promise<string> {
    const email = (req.body as undefined | { email?: string })?.email;
    return Promise.resolve(email ?? req.ip ?? 'unknown');
  }
}
