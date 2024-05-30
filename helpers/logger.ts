import pino from 'pino';

// Configure the transport to log both to stdout (with pretty printing) and to a file
const transport = pino.transport({
  targets: [
    {
      target: 'pino-pretty',
      options: {
        colorize: false,
        destination: `./log/bot.${new Date().toISOString().replace('T', ' ').split('.')[0]}.log`,
      },
      level: process.env.LOG_LEVEL || 'info',
    },
    {
      target: 'pino-pretty',
      options: {
        colorize: true,
        destination: process.stdout.fd
      },
      level: process.env.LOG_LEVEL || 'info',
    },
  ]
});

// Create the logger instance with the transport configuration
export const logger = pino(
  {
    level: process.env.LOG_LEVEL || 'info',
    redact: ['poolKeys'],
    serializers: {
      error: pino.stdSerializers.err,
    },
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  transport,
);

// Example usage
logger.info('Logger initialized and configured to log to both stdout and file.');
