import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { db } from './db/index.js';
import { BusinessError, withRetry } from './db/resilience.js';
import { appointments, doctors, schedules } from './db/schema.js';

const app = Fastify({ logger: true });

app.get('/schedules', async (_request, reply) => {
  try {
    const rows = await withRetry(() =>
      db
        .select({
          id: schedules.id,
          slotTime: schedules.slotTime,
          isBooked: schedules.isBooked,
          doctorName: doctors.name,
          specialization: doctors.specialization,
        })
        .from(schedules)
        .innerJoin(doctors, eq(schedules.doctorId, doctors.id))
        .orderBy(schedules.id),
    );

    return reply.code(200).send(rows);
  } catch (err) {
    app.log.error(err);
    return reply.code(503).send({
      error: 'Service Unavailable',
      message: 'Database is temporarily unavailable after retries',
    });
  }
});

interface CreateAppointmentBody {
  scheduleId: number;
  patientName: string;
}

app.post<{ Body: CreateAppointmentBody }>(
  '/appointments',
  {
    schema: {
      body: {
        type: 'object',
        required: ['scheduleId', 'patientName'],
        properties: {
          scheduleId: { type: 'integer' },
          patientName: { type: 'string', minLength: 2 },
        },
      },
    },
  },
  async (request, reply) => {
    const idempotencyKey = request.headers['idempotency-key'];

    if (!idempotencyKey || typeof idempotencyKey !== 'string') {
      return reply.code(400).send({
        error: 'Bad Request',
        message: 'Header Idempotency-Key is required',
      });
    }

    const { scheduleId, patientName } = request.body;

    try {
      const result = await withRetry(() =>
        db.transaction(async (tx) => {
          const [existing] = await tx
            .select()
            .from(appointments)
            .where(eq(appointments.idempotencyKey, idempotencyKey));

          if (existing) {
            return { isReplay: true, appointment: existing };
          }

          const [slot] = await tx
            .select()
            .from(schedules)
            .where(eq(schedules.id, scheduleId))
            .for('update');

          if (!slot) {
            throw new BusinessError(404, 'Schedule slot not found');
          }

          if (slot.isBooked) {
            throw new BusinessError(409, 'This schedule slot is already booked');
          }

          await tx.update(schedules).set({ isBooked: true }).where(eq(schedules.id, scheduleId));

          const [created] = await tx
            .insert(appointments)
            .values({
              scheduleId,
              patientName,
              status: 'confirmed',
              idempotencyKey,
            })
            .returning();

          return { isReplay: false, appointment: created };
        }),
      );

      return reply.code(result.isReplay ? 200 : 201).send(result.appointment);
    } catch (err) {
      if (err instanceof BusinessError) {
        return reply.code(err.statusCode).send({
          error: err.statusCode === 404 ? 'Not Found' : 'Conflict',
          message: err.message,
        });
      }

      app.log.error(err);
      return reply.code(503).send({
        error: 'Service Unavailable',
        message: 'Database error occurred after retries',
      });
    }
  },
);

app.patch<{ Params: { id: string } }>('/appointments/:id/cancel', async (request, reply) => {
  const appointmentId = Number(request.params.id);

  if (Number.isNaN(appointmentId)) {
    return reply.code(400).send({
      error: 'Bad Request',
      message: 'Invalid appointment ID',
    });
  }

  try {
    const updatedAppointment = await withRetry(() =>
      db.transaction(async (tx) => {
        const [appointment] = await tx
          .select()
          .from(appointments)
          .where(eq(appointments.id, appointmentId))
          .for('update');

        if (!appointment) {
          throw new BusinessError(404, 'Appointment not found');
        }

        if (appointment.status === 'cancelled') {
          return appointment;
        }

        const [updated] = await tx
          .update(appointments)
          .set({ status: 'cancelled' })
          .where(eq(appointments.id, appointmentId))
          .returning();

        await tx
          .update(schedules)
          .set({ isBooked: false })
          .where(eq(schedules.id, appointment.scheduleId));

        return updated;
      }),
    );

    return reply.code(200).send(updatedAppointment);
  } catch (err) {
    if (err instanceof BusinessError) {
      return reply.code(err.statusCode).send({
        error: 'Not Found',
        message: err.message,
      });
    }

    app.log.error(err);
    return reply.code(503).send({
      error: 'Service Unavailable',
      message: 'Database error occurred after retries',
    });
  }
});

const start = async () => {
  try {
    await app.listen({ port: 3000, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
