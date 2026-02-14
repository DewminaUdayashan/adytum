/**
 * @file packages/gateway/src/api/middleware/error.middleware.ts
 * @description Provides middleware behavior for the API layer.
 */

import { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../../domain/errors/app-error.js';
import { Logger } from '../../logger.js';
import { container } from 'tsyringe';

/**
 * Executes error handler.
 * @param error - Error.
 * @param request - Request.
 * @param reply - Reply.
 */
export function errorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply
) {
  const logger = container.resolve(Logger);

  if (error instanceof AppError) {
    return reply.status(error.statusCode).send({
      error: error.message,
      statusCode: error.statusCode,
    });
  }

  // Fastify validation errors
  if (error.validation) {
    return reply.status(400).send({
      error: 'Validation failed',
      details: error.validation,
      statusCode: 400,
    });
  }

  logger.error({ err: error }, `Unhandled error: ${error.message}`);

  return reply.status(500).send({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? error.message : undefined,
    statusCode: 500,
  });
}
