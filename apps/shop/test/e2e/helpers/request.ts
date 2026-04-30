import supertest from 'supertest';

import { BASE_URL } from './constants';

type RequestMethod = 'delete' | 'get' | 'patch' | 'post';

export function e2eRequest(method: RequestMethod, path: string) {
  return supertest(BASE_URL)[method](path);
}
