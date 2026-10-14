import Fastify from 'fastify';
import { appointments, doctors, schedules } from './mock-data.js';

const app = Fastify({ logger: true });

// Сценарій 1: Отримання розкладу з даними лікарів
app.get('/schedules', async () => {
  return schedules.map((slot) => {
    const doctor = doctors.find((d) => d.id === slot.doctorId);
    return {
      id: slot.id,
      slotTime: slot.slotTime,
      isBooked: slot.isBooked,
      doctorName: doctor?.name ?? 'Невідомий лікар',
      specialization: doctor?.specialization ?? 'Без спеціалізації',
    };
  });
});

interface CreateAppointmentBody {
  scheduleId: number;
  patientName: string;
}

// Сценарій 2: Бронювання прийому (з підтримкою Idempotency-Key та валідацією)
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

    // Перевірка ідемпотентності: якщо запит із цим ключем вже виконувався
    const existingAppointment = appointments.find((a) => a.idempotencyKey === idempotencyKey);
    if (existingAppointment) {
      return reply.code(200).send(existingAppointment);
    }

    const { scheduleId, patientName } = request.body;
    const slot = schedules.find((s) => s.id === scheduleId);

    if (!slot) {
      return reply.code(404).send({
        error: 'Not Found',
        message: 'Schedule slot not found',
      });
    }

    if (slot.isBooked) {
      return reply.code(409).send({
        error: 'Conflict',
        message: 'This schedule slot is already booked',
      });
    }

    slot.isBooked = true;

    const newAppointment = {
      id: appointments.length + 1,
      scheduleId,
      patientName,
      status: 'confirmed' as const,
      idempotencyKey,
      createdAt: new Date().toISOString(),
    };

    appointments.push(newAppointment);
    return reply.code(201).send(newAppointment);
  },
);

// Сценарій 3: Скасування прийому та звільнення слоту
app.patch<{ Params: { id: string } }>('/appointments/:id/cancel', async (request, reply) => {
  const appointmentId = Number(request.params.id);
  const appointment = appointments.find((a) => a.id === appointmentId);

  if (!appointment) {
    return reply.code(404).send({
      error: 'Not Found',
      message: 'Appointment not found',
    });
  }

  if (appointment.status === 'cancelled') {
    return reply.code(200).send(appointment);
  }

  appointment.status = 'cancelled';

  const slot = schedules.find((s) => s.id === appointment.scheduleId);
  if (slot) {
    slot.isBooked = false;
  }

  return reply.code(200).send(appointment);
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
