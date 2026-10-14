import type { FastifyInstance } from 'fastify';
import { doctorsService } from '../services/doctors.service.js';

export async function doctorsRoutes(app: FastifyInstance) {
  app.get('/doctors', async (_request, reply) => {
    const allDoctors = await doctorsService.getAll();
    return reply.code(200).send(allDoctors);
  });
}
