import Fastify from 'fastify';
import { registerErrorHandler } from './api/error-handler.js';
import { apiRoutes } from './api/routes.js';

const app = Fastify({ logger: true });

registerErrorHandler(app);

app.get('/', async () => {
  return {
    service: 'MedBook REST API',
    version: '1.0.0',
    endpoints: [
      'GET    /api/health',
      'GET    /api/doctors',
      'GET    /api/schedules',
      'GET    /api/appointments',
      'POST   /api/appointments',
      'PATCH  /api/appointments/:id/cancel',
    ],
  };
});

app.register(apiRoutes, { prefix: '/api' });
app.register(apiRoutes);

const start = async () => {
  try {
    await app.listen({ port: 3000, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
