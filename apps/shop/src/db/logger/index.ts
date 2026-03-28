import { CustomTypeOrmLogger } from '@app/common';

import { incrementQueryCount } from '@/core/async-storage';

export class ShopTypeOrmLogger extends CustomTypeOrmLogger {
  logQuery(query: string, parameters?: unknown[]): void {
    incrementQueryCount();
    super.logQuery(query, parameters);
  }
}
