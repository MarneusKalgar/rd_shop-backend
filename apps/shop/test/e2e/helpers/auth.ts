import { e2eRequest } from './request';
import { useStageValidationUsers } from './validation-config';

export interface TokenSet {
  accessToken: string;
  userId: string;
}

/**
 * Signs in an existing seeded user when requested, otherwise performs the local
 * signup + signin bootstrap flow. Returns the access token and user ID for use
 * in test requests.
 */
export async function signupAndSignin(email: string, password: string): Promise<TokenSet> {
  if (!useStageValidationUsers()) {
    // Attempt signup — tolerate 409 (user already exists from a previous run)
    const signupRes = await e2eRequest('post', '/api/v1/auth/signup').send({
      confirmedPassword: password,
      email,
      password,
    });

    if (signupRes.status !== 201 && signupRes.status !== 409) {
      throw new Error(
        `Unexpected signup status ${signupRes.status}: ${JSON.stringify(signupRes.body)}`,
      );
    }
  }

  const res = await e2eRequest('post', '/api/v1/auth/signin').send({ email, password }).expect(200);

  const body = res.body as unknown as { accessToken: string; user: { id: string } };
  return {
    accessToken: body.accessToken,
    userId: body.user.id,
  };
}
