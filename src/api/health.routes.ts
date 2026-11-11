import type { FastifyInstance } from 'fastify';

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async () => {
    return {
      status: 'ok',
      service: 'medbook-api',
      timestamp: new Date().toISOString(),
    };
  });
}
