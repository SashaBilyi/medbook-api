import type { FastifyInstance } from 'fastify';
import { appointmentsRoutes } from './appointments.routes.js';
import { doctorsRoutes } from './doctors.routes.js';
import { healthRoutes } from './health.routes.js';
import { schedulesRoutes } from './schedules.routes.js';
import { versionRoutes } from './version.routes.js';

export async function apiRoutes(app: FastifyInstance) {
  await app.register(healthRoutes);
  await app.register(versionRoutes);
  await app.register(doctorsRoutes);
  await app.register(schedulesRoutes);
  await app.register(appointmentsRoutes);
}
