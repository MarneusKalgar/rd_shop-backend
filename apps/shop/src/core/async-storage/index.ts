import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  queryCount: number;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

export const getRequestContext = (): RequestContext | undefined => requestContext.getStore();

export const incrementQueryCount = () => {
  const store = requestContext.getStore();
  if (store) {
    store.queryCount += 1;
  }
};

export const getNewStore = (): RequestContext => ({
  queryCount: 0,
});
