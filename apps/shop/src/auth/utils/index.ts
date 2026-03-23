import { UUID_LENGTH } from '../constants';

export function parseOpaqueToken(token: string): null | { rawSecret: string; tokenId: string } {
  if (token.length <= UUID_LENGTH) return null;
  return {
    rawSecret: token.substring(UUID_LENGTH + 1),
    tokenId: token.substring(0, UUID_LENGTH),
  };
}
