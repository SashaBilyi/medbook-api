export interface CreateAppointmentBody {
  scheduleId: number;
  patientName: string;
}

export const createAppointmentSchema = {
  body: {
    type: 'object',
    required: ['scheduleId', 'patientName'],
    properties: {
      scheduleId: { type: 'integer' },
      patientName: { type: 'string', minLength: 2 },
    },
  },
} as const;
