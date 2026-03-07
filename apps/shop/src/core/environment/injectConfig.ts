import { Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Custom decorator for injecting ConfigService into NestJS providers.
 * Simplifies the injection of ConfigService with proper typing.
 * Use with TypedConfigService type alias to avoid repetitive imports.
 * @returns {ParameterDecorator} A parameter decorator that injects ConfigService
 * @example
 * // Using with TypedConfigService (recommended)
 * import { Injectable } from '@nestjs/common';
 * import { InjectConfig, TypedConfigService } from './core/environment';
 *
 * @Injectable()
 * export class AppService {
 *   constructor(@InjectConfig() private config: TypedConfigService) {}
 *
 *   getPort(): number {
 *     return this.config.get('PORT', { infer: true });
 *   }
 * }
 * @example
 * // Using in a controller
 * import { Controller, Get } from '@nestjs/common';
 * import { InjectConfig, TypedConfigService } from './core/environment';
 *
 * @Controller()
 * export class AppController {
 *   constructor(@InjectConfig() private config: TypedConfigService) {}
 *
 *   @Get('env')
 *   getEnvironment() {
 *     return this.config.get('NODE_ENV', { infer: true });
 *   }
 * }
 */
export const InjectConfig = () => Inject(ConfigService);
