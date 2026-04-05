export enum NodeEnvironment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

export const isDevelopment = () => process.env.NODE_ENV === NodeEnvironment.Development;

export const isProduction = () => process.env.NODE_ENV === NodeEnvironment.Production;

export const isTest = () => process.env.NODE_ENV === NodeEnvironment.Test;

export const isLocal = () => process.env.NODE_HOSTNAME === 'localhost';
