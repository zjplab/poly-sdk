/**
 * Internal logger interface for poly-sdk.
 *
 * poly-sdk does NOT import any external logger directly.
 * Consumers (e.g. poly-cli) call setLogger() once at startup to inject
 * their application logger. Until then, all log calls are silent no-ops.
 */

export interface Logger {
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
}

const noop = () => {};

let _logger: Logger = {
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
};

/**
 * Inject an application logger into poly-sdk.
 * Call once at startup before using any SDK services.
 *
 * @example
 * ```typescript
 * import { setLogger } from '@catalyst-team/poly-sdk';
 * import { createLogger } from '@earning-engine/logger';
 * setLogger(createLogger('poly-sdk'));
 * ```
 */
export function setLogger(logger: Logger): void {
  _logger = logger;
}

/** Get the currently registered logger (or the no-op default). */
export function getLogger(): Logger {
  return _logger;
}

/**
 * Create a module-scoped logger that prefixes every message with `[module]`.
 * Used internally by poly-sdk modules.
 */
export function createModuleLogger(module: string): Logger {
  return {
    debug: (msg, data) => _logger.debug(`[${module}] ${msg}`, data),
    info: (msg, data) => _logger.info(`[${module}] ${msg}`, data),
    warn: (msg, data) => _logger.warn(`[${module}] ${msg}`, data),
    error: (msg, data) => _logger.error(`[${module}] ${msg}`, data),
  };
}
