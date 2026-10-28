import type { FastifyInstance } from 'fastify';
import { BusinessError } from '../db/resilience.js';
import { appointmentsService } from '../services/appointments.service.js';
import { type CreateAppointmentBody, createAppointmentSchema } from './appointments.schema.js';

export async function appointmentsRoutes(app: FastifyInstance) {
  app.get('/appointments', async (_request, reply) => {
    const allAppointments = await appointmentsService.getAll();
    return reply.code(200).send(allAppointments);
  });

  app.post<{ Body: CreateAppointmentBody }>(
    '/appointments',
    { schema: createAppointmentSchema },
    async (request, reply) => {
      const idempotencyKey = request.headers['idempotency-key'];

      if (!idempotencyKey || typeof idempotencyKey !== 'string') {
        throw new BusinessError(400, 'Header Idempotency-Key is required');
      }

      const { scheduleId, patientName } = request.body;
      const result = await appointmentsService.bookSlot({
        scheduleId,
        patientName,
        idempotencyKey,
      });

      return reply.code(result.isReplay ? 200 : 201).send(result.appointment);
    },
  );

  app.patch<{ Params: { id: string } }>('/appointments/:id/cancel', async (request, reply) => {
    const appointmentId = Number(request.params.id);

    if (Number.isNaN(appointmentId)) {
      throw new BusinessError(400, 'Invalid appointment ID');
    }

    const updatedAppointment = await appointmentsService.cancelById(appointmentId);
    return reply.code(200).send(updatedAppointment);
  });
}
