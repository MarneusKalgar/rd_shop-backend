import supertest from 'supertest';

import {
  OBSERVABILITY_TRAFFIC_SOURCE_HEADER,
  STAGE_VALIDATION_TRAFFIC_SOURCE,
} from '@/observability/constants';

import { BASE_URL } from './constants';

type RequestMethod = 'delete' | 'get' | 'patch' | 'post';

const shouldTagStageValidationTraffic = (): boolean =>
  Boolean(process.env.STAGE_VALIDATION_NAMESPACE?.trim());

export function e2eRequest(method: RequestMethod, path: string) {
  const request = supertest(BASE_URL)[method](path);

  if (shouldTagStageValidationTraffic()) {
    request.set(OBSERVABILITY_TRAFFIC_SOURCE_HEADER, STAGE_VALIDATION_TRAFFIC_SOURCE);
  }

  return request;
}
