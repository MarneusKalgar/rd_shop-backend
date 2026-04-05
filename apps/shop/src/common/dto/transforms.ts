import { TransformFnParams } from 'class-transformer';

/**
 * Transform function for use with `@Transform()` that normalises a single
 * query-string value to a one-element array so that array validators
 * (`@IsArray`, `@IsString({ each: true })`, etc.) work for both
 * `?param=value` and `?param[]=a&param[]=b` forms.
 *
 * @example
 * ```typescript
 * @Transform(toArray)
 * @IsArray()
 * @IsString({ each: true })
 * tags?: string[];
 * ```
 */
export function toArray({ value }: TransformFnParams): unknown[] {
  return Array.isArray(value) ? value : [value];
}
