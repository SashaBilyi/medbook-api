import type { BookingModule } from '@medbook/booking-core';
import type { FastifyInstance } from 'fastify';
import { type ListSchedulesQuery, listSchedulesSchema } from './appointments.schema.js';

export interface SchedulesRoutesOptions {
  readonly bookingModule: BookingModule;
}

export async function schedulesRoutes(app: FastifyInstance, opts: SchedulesRoutesOptions) {
  const { bookingModule } = opts;

  app.get<{ Querystring: ListSchedulesQuery }>(
    '/schedules',
    { schema: listSchedulesSchema },
    async (request, reply) => {
      const { doctorId, availableOnly, limit, offset } = request.query;
      const bounds = bookingModule.getPaginationBounds();
      const effectiveLimit = Math.min(limit ?? bounds.defaultLimit, bounds.maxLimit);
      const effectiveOffset = offset ?? 0;

      const rows = await bookingModule.listSchedules({
        doctorId,
        availableOnly,
        limit: effectiveLimit,
        offset: effectiveOffset,
      });

      return reply
        .header('x-limit', String(effectiveLimit))
        .header('x-offset', String(effectiveOffset))
        .code(200)
        .send(rows);
    },
  );
}
