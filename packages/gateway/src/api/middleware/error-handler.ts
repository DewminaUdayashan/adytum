import { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../../domain/errors/app-error.js';
import { Logger } from '../../logger.js';
import { container } from '../../container.js';

export function errorHandler(error: FastifyError, request: FastifyRequest, reply: FastifyReply) {
  const logger = container.resolve(Logger);

  if (error instanceof AppError) {
    if (error.isOperational) {
      logger.warn(`Operational Error: ${error.message}`, { statusCode: error.statusCode });
    } else {
      logger.error(`Programming Error: ${error.message}`, error);
    }
    return reply.status(error.statusCode).send({
      status: 'error',
      message: error.message,
    });
  }

  // Fastify validation errors
  if (error.validation) {
    return reply.status(400).send({
      status: 'error',
      message: 'Validation Error',
      details: error.validation,
    });
  }

  // Unhandled errors
  logger.error(`Unhandled Error: ${error.message}`, error);
  return reply.status(500).send({
    status: 'error',
    message: 'Internal Server Error',
  });
}
