import { BadRequestException } from '@nestjs/common';
import { isUUID } from 'class-validator';

const CURSOR_SEPARATOR = '|';

export interface CursorPayload {
  id: string;
  sortValue: string;
}

/**
 * Decodes a cursor string back into its id and sortValue parts.
 * Throws BadRequestException if the cursor is malformed.
 */
export function decodeCursor(cursor: string): CursorPayload {
  const separatorIndex = cursor.indexOf(CURSOR_SEPARATOR);

  if (separatorIndex === -1) {
    throw new BadRequestException('Invalid cursor format');
  }

  const id = cursor.slice(0, separatorIndex);
  const sortValue = cursor.slice(separatorIndex + 1);

  if (!id || !sortValue || !isUUID(id)) {
    throw new BadRequestException('Invalid cursor format');
  }

  return { id, sortValue };
}

/**
 * Decodes a cursor whose sortValue encodes an epoch-millisecond timestamp.
 * Validates that the sortValue is a finite integer before constructing a Date.
 * Throws BadRequestException if invalid.
 */
export function decodeEpochCursor(cursor: string): { date: Date; id: string } {
  const { id, sortValue } = decodeCursor(cursor);
  const epoch = Number(sortValue);

  if (!Number.isFinite(epoch)) {
    throw new BadRequestException('Invalid cursor format');
  }

  return { date: new Date(epoch), id };
}

/**
 * Encodes a cursor from an entity ID and sort value.
 *
 * Plain string concat — no JSON, no base64, no allocations.
 * UUID contains only [0-9a-f-]; indexOf('|') always finds the separator
 * between id and sortValue, even if sortValue itself contains '|' (e.g. titles).
 *
 * sortValue encoding by sort field:
 *   createdAt → String(date.getTime())  — epoch ms, pure digits, URL-safe
 *   price     → raw numeric string       — e.g. "29.99", URL-safe
 *   title     → raw title string         — may contain '|', decoded correctly
 *                                          because indexOf finds the FIRST '|'
 */
export function encodeCursor(id: string, sortValue: string): string {
  return `${id}${CURSOR_SEPARATOR}${sortValue}`;
}
