import pino from 'pino';
import { singleton } from 'tsyringe';

const isDev = process.env.NODE_ENV !== 'production';

@singleton()
export class Logger {
  private pino: pino.Logger;

  constructor() {
    this.pino = pino({
      level: process.env.LOG_LEVEL || 'info',
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

  info(msgOrObj: string | object, ...args: any[]) {
    if (typeof msgOrObj === 'string') {
      this.pino.info(msgOrObj, ...args);
    } else {
      this.pino.info(msgOrObj, ...args);
    }
  }

  error(msgOrObj: string | object, ...args: any[]) {
    if (typeof msgOrObj === 'string') {
      this.pino.error(msgOrObj, ...args);
    } else {
      this.pino.error(msgOrObj, ...args);
    }
  }

  warn(msgOrObj: string | object, ...args: any[]) {
    if (typeof msgOrObj === 'string') {
      this.pino.warn(msgOrObj, ...args);
    } else {
      this.pino.warn(msgOrObj, ...args);
    }
  }

  debug(msgOrObj: string | object, ...args: any[]) {
    if (typeof msgOrObj === 'string') {
      this.pino.debug(msgOrObj, ...args);
    } else {
      this.pino.debug(msgOrObj, ...args);
    }
  }

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

