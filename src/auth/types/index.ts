export interface AuthUser {
  email: string;
  sub: string;
  // roles: string[];
  // scopes: string[];
}

export interface JwtPayload {
  email: string;
  sub: string; // user id
  // roles: string[];
  // scopes: string[];
}
