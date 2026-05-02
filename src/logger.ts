import { FastifyServerOptions } from 'fastify';

const logLevel = process.env.LOG_LEVEL ?? 'info';
const isProduction = process.env.NODE_ENV === 'production';

export const loggerOptions: FastifyServerOptions['logger'] = isProduction
  ? {
      level: logLevel,
    }
  : {
      level: logLevel,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          ignore: 'pid,hostname',
          levelFirst: true,
          singleLine: true,
          translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l',
        },
      },
    };
