export interface CreateAppointmentBody {
  scheduleId: number;
  patientName: string;
}

export interface ListAppointmentsQuery {
  status?: 'confirmed' | 'cancelled';
  limit?: number;
  offset?: number;
}

export interface ListSchedulesQuery {
  doctorId?: number;
  availableOnly?: boolean;
  limit?: number;
  offset?: number;
}

export const appointmentResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'integer' },
    scheduleId: { type: 'integer' },
    patientName: { type: 'string' },
    status: { type: 'string' },
    idempotencyKey: { type: 'string' },
    createdAt: { type: 'string', format: 'date-time' },
  },
} as const;

export const scheduleWithDoctorResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'integer' },
    slotTime: { type: 'string', format: 'date-time' },
    isBooked: { type: 'boolean' },
    doctorName: { type: 'string' },
    specialization: { type: 'string' },
  },
} as const;

export const createAppointmentSchema = {
  body: {
    type: 'object',
    required: ['scheduleId', 'patientName'],
    properties: {
      scheduleId: { type: 'integer' },
      patientName: { type: 'string', minLength: 2 },
    },
  },
  response: {
    200: appointmentResponseSchema,
    201: appointmentResponseSchema,
  },
} as const;

export const listAppointmentsSchema = {
  querystring: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['confirmed', 'cancelled'] },
      limit: { type: 'integer', minimum: 1 },
      offset: { type: 'integer', minimum: 0 },
    },
  },
  response: {
    200: {
      type: 'array',
      items: appointmentResponseSchema,
    },
  },
} as const;

export const listSchedulesSchema = {
  querystring: {
    type: 'object',
    properties: {
      doctorId: { type: 'integer', minimum: 1 },
      availableOnly: { type: 'boolean' },
      limit: { type: 'integer', minimum: 1 },
      offset: { type: 'integer', minimum: 0 },
    },
  },
  response: {
    200: {
      type: 'array',
      items: scheduleWithDoctorResponseSchema,
    },
  },
} as const;

export const cancelAppointmentSchema = {
  response: {
    200: appointmentResponseSchema,
  },
} as const;
