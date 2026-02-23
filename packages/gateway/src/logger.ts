/**
 * @file packages/gateway/src/logger.ts
 * @description Defines module behavior for the Adytum workspace.
 */

import pino from 'pino';
import { singleton } from 'tsyringe';

const isDev = process.env.NODE_ENV !== 'production';

/**
 * Encapsulates logger behavior.
 */
@singleton()
export class Logger {
  private pino: pino.Logger;

  constructor() {
    this.pino = pino({
      level: process.env.LOG_LEVEL || 'warn',
      transport: isDev
        ? {
            target: 'pino-pretty',
            options: {
              colorize: true,
              ignore: 'pid,hostname',
              translateTime: 'SYS:standard',
            },
          }
        : undefined,
    });
  }

  /**
   * Executes info.
   * @param msgOrObj - Msg or obj.
   * @param args - Args.
   */
  info(msgOrObj: string | object, ...args: any[]) {
    if (typeof msgOrObj === 'string') {
      this.pino.info(msgOrObj, ...args);
    } else {
      this.pino.info(msgOrObj, ...args);
    }
  }

  /**
   * Executes error.
   * @param msgOrObj - Msg or obj.
   * @param args - Args.
   */
  error(msgOrObj: string | object, ...args: any[]) {
    if (typeof msgOrObj === 'string') {
      this.pino.error(msgOrObj, ...args);
    } else {
      this.pino.error(msgOrObj, ...args);
    }
  }

  /**
   * Executes warn.
   * @param msgOrObj - Msg or obj.
   * @param args - Args.
   */
  warn(msgOrObj: string | object, ...args: any[]) {
    if (typeof msgOrObj === 'string') {
      this.pino.warn(msgOrObj, ...args);
    } else {
      this.pino.warn(msgOrObj, ...args);
    }
  }

  /**
   * Executes debug.
   * @param msgOrObj - Msg or obj.
   * @param args - Args.
   */
  debug(msgOrObj: string | object, ...args: any[]) {
    if (typeof msgOrObj === 'string') {
      this.pino.debug(msgOrObj, ...args);
    } else {
      this.pino.debug(msgOrObj, ...args);
    }
  }

  /**
   * Executes fatal.
   * @param msgOrObj - Msg or obj.
   * @param args - Args.
   */
  fatal(msgOrObj: string | object, ...args: any[]) {
    if (typeof msgOrObj === 'string') {
      this.pino.fatal(msgOrObj, ...args);
    } else {
      this.pino.fatal(msgOrObj, ...args);
    }
  }
}

// Export a default instance for backward compatibility or direct use if needed,
// though DI is preferred.
export const logger = new Logger();
