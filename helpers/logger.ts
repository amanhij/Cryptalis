import pino from 'pino';

// Configure the transport to log both to stdout (with pretty printing) and to a file
const transport = pino.transport({
  targets: [
    {
      target: 'pino-pretty',
      options: {
        colorize: true,
      },
      level: 'info',
    },
    {
      target: 'pino/file',
      options: {
        destination: './bot.log',
        mkdir: true, // Create the directory if it doesn't exist
        append: true, // Append to the file if it exists
      },
      level: 'info',
    }
  ]
});

// Create the logger instance with the transport configuration
export const logger = pino(
  {
    level: 'info',
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
