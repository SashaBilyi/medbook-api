import type { FastifyInstance } from 'fastify';
import { schedulesService } from '../services/schedules.service.js';

export async function schedulesRoutes(app: FastifyInstance) {
  app.get('/schedules', async (_request, reply) => {
    const rows = await schedulesService.getAllWithDoctors();
    return reply.code(200).send(rows);
  });
}
