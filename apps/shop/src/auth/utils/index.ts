import { isUUID } from 'class-validator';

import { MIN_RAW_SECRET_LENGTH, UUID_LENGTH } from '../constants';

const DELIMITER = ':';

export function parseOpaqueToken(token: string): null | { rawSecret: string; tokenId: string } {
  if (token.length <= UUID_LENGTH) return null;
  if (token[UUID_LENGTH] !== DELIMITER) return null;

  const tokenId = token.substring(0, UUID_LENGTH);
  if (!isUUID(tokenId)) return null;

  const rawSecret = token.substring(UUID_LENGTH + 1);
  if (rawSecret.length < MIN_RAW_SECRET_LENGTH) return null;

  return { rawSecret, tokenId };
}
