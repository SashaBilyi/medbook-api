import type { FastifyInstance } from 'fastify';
import { doctorsService } from '../services/doctors.service.js';

const listDoctorsSchema = {
  response: {
    200: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          name: { type: 'string' },
          specialization: { type: 'string' },
        },
      },
    },
  },
} as const;

export async function doctorsRoutes(app: FastifyInstance) {
  app.get('/doctors', { schema: listDoctorsSchema }, async (_request, reply) => {
    const allDoctors = await doctorsService.getAll();
    return reply.code(200).send(allDoctors);
  });
}
