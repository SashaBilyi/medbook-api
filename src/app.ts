import type { BookingModule } from '@medbook/booking-core';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerErrorHandler } from './api/error-handler.js';
import { apiRoutes } from './api/routes.js';
import { uiRoutes } from './api/ui.routes.js';
import { createAppContainer } from './container.js';

export interface BuildAppOptions {
  readonly logger?: boolean;
  readonly bookingModule?: BookingModule;
}

export function buildApp(optionsOrLogger: boolean | BuildAppOptions = true): FastifyInstance {
  const options: BuildAppOptions =
    typeof optionsOrLogger === 'boolean' ? { logger: optionsOrLogger } : optionsOrLogger;

  const app = Fastify({ logger: options.logger ?? true });
  const bookingModule = options.bookingModule ?? createAppContainer().bookingModule;

  registerErrorHandler(app);

  app.get('/', async () => {
    return {
      service: 'MedBook REST API',
      version: '1.0.0',
      endpoints: [
        'GET    /ui',
        'GET    /api/health',
        'GET    /api/doctors',
        'GET    /api/schedules',
        'GET    /api/appointments',
        'GET    /api/version',
        'POST   /api/appointments',
        'PATCH  /api/appointments/:id/cancel',
      ],
    };
  });

  app.register(uiRoutes);
  app.register(apiRoutes, { prefix: '/api', bookingModule });
  app.register(apiRoutes, { bookingModule });

  return app;
}
