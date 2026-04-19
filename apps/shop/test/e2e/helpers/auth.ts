import supertest from 'supertest';

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:8092';

export interface TokenSet {
  accessToken: string;
  userId: string;
}

/**
 * Registers a user (idempotent — ignores 409 Conflict) then signs in.
 * Returns the access token and user ID for use in test requests.
 */
export async function signupAndSignin(email: string, password: string): Promise<TokenSet> {
  const agent = supertest(BASE_URL);

  // Attempt signup — tolerate 409 (user already exists from a previous run)
  await agent.post('/api/v1/auth/signup').send({ confirmedPassword: password, email, password });

  const res = await agent.post('/api/v1/auth/signin').send({ email, password }).expect(200);

  const body = res.body as unknown as { accessToken: string; user: { id: string } };
  return {
    accessToken: body.accessToken,
    userId: body.user.id,
  };
}
