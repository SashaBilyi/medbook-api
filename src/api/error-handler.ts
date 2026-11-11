import type { FastifyInstance } from 'fastify';
import { BusinessError } from '../db/resilience.js';

export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof BusinessError) {
      const errorTitles: Record<number, string> = {
        400: 'Bad Request',
        404: 'Not Found',
        409: 'Conflict',
      };

      return reply.code(error.statusCode).send({
        error: errorTitles[error.statusCode] ?? 'Application Error',
        message: error.message,
      });
    }

    if (typeof error === 'object' && error !== null && 'validation' in error) {
      const message = error instanceof Error ? error.message : 'Validation error';
      return reply.code(400).send({
        error: 'Bad Request',
        message,
      });
    }

    request.log.error(error);
    return reply.code(503).send({
      error: 'Service Unavailable',
      message: 'Database error occurred after retries',
    });
  });
}
