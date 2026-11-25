import type { BookingModule } from '@medbook/booking-core';
import type { FastifyInstance } from 'fastify';
import { BusinessError } from '../db/resilience.js';
import {
  cancelAppointmentSchema,
  type CreateAppointmentBody,
  createAppointmentSchema,
  type ListAppointmentsQuery,
  listAppointmentsSchema,
} from './appointments.schema.js';

export interface AppointmentsRoutesOptions {
  readonly bookingModule: BookingModule;
}

export async function appointmentsRoutes(app: FastifyInstance, opts: AppointmentsRoutesOptions) {
  const { bookingModule } = opts;

  app.get<{ Querystring: ListAppointmentsQuery }>(
    '/appointments',
    { schema: listAppointmentsSchema },
    async (request, reply) => {
      const { status, limit, offset } = request.query;
      const bounds = bookingModule.getPaginationBounds();
      const effectiveLimit = Math.min(limit ?? bounds.defaultLimit, bounds.maxLimit);
      const effectiveOffset = offset ?? 0;

      const rows = await bookingModule.listAppointments({
        status,
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

  app.post<{ Body: CreateAppointmentBody }>(
    '/appointments',
    { schema: createAppointmentSchema },
    async (request, reply) => {
      const idempotencyKey = request.headers['idempotency-key'];

      if (!idempotencyKey || typeof idempotencyKey !== 'string') {
        throw new BusinessError(400, 'Header Idempotency-Key is required');
      }

      const { scheduleId, patientName } = request.body;
      const result = await bookingModule.bookSlot({
        scheduleId,
        patientName,
        idempotencyKey,
      });

      return reply.code(result.isReplay ? 200 : 201).send(result.appointment);
    },
  );

  app.patch<{ Params: { id: string } }>(
    '/appointments/:id/cancel',
    { schema: cancelAppointmentSchema },
    async (request, reply) => {
      const appointmentId = Number(request.params.id);

      if (Number.isNaN(appointmentId)) {
        throw new BusinessError(400, 'Invalid appointment ID');
      }

      const updatedAppointment = await bookingModule.cancelAppointment(appointmentId);
      return reply.code(200).send(updatedAppointment);
    },
  );
}
