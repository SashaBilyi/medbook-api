import type { BookingModule } from '@medbook/booking-core';
import type { FastifyInstance } from 'fastify';
import { appointmentsRoutes } from './appointments.routes.js';
import { doctorsRoutes } from './doctors.routes.js';
import { healthRoutes } from './health.routes.js';
import { schedulesRoutes } from './schedules.routes.js';
import { versionRoutes } from './version.routes.js';

export interface ApiRoutesOptions {
  readonly bookingModule: BookingModule;
}

export async function apiRoutes(app: FastifyInstance, opts: ApiRoutesOptions) {
  await app.register(healthRoutes);
  await app.register(versionRoutes);
  await app.register(doctorsRoutes);
  await app.register(schedulesRoutes, { bookingModule: opts.bookingModule });
  await app.register(appointmentsRoutes, { bookingModule: opts.bookingModule });
}
