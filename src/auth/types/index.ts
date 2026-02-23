import { Request } from 'express';

export interface AuthUser {
  email: string;
  roles: string[];
  scopes: string[];
  sub: string;
}

export interface JwtPayload {
  email: string;
  roles: string[];
  scopes: string[];
  sub: string;
}

export type RequestWithUser = Request & { user?: AuthUser };
