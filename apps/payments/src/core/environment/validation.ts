import { createValidate } from '@app/common/environment';

import { EnvironmentVariables } from './schema';

export const validate = createValidate(EnvironmentVariables);
