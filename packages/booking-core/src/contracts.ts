export const BOOKING_CORE_VERSION = '1.0.0';

export type AppointmentStatus = 'confirmed' | 'cancelled';

export interface ScheduleRecord {
  readonly id: number;
  readonly doctorId: number;
  readonly slotTime: Date;
  readonly isBooked: boolean;
}

export interface ScheduleWithDoctor {
  readonly id: number;
  readonly slotTime: Date;
  readonly isBooked: boolean;
  readonly doctorName: string;
  readonly specialization: string;
}

export interface AppointmentRecord {
  readonly id: number;
  readonly scheduleId: number;
  readonly patientName: string;
  readonly status: AppointmentStatus;
  readonly idempotencyKey: string;
  readonly createdAt: Date;
}

export interface ScheduleQueryInput {
  readonly doctorId?: number;
  readonly availableOnly?: boolean;
  readonly limit?: number;
  readonly offset?: number;
}

export interface NormalizedScheduleQuery {
  readonly doctorId?: number;
  readonly availableOnly: boolean;
  readonly limit: number;
  readonly offset: number;
}

export interface AppointmentQueryInput {
  readonly status?: AppointmentStatus;
  readonly limit?: number;
  readonly offset?: number;
}

export interface NormalizedAppointmentQuery {
  readonly status?: AppointmentStatus;
  readonly limit: number;
  readonly offset: number;
}

export interface PaginationBounds {
  readonly defaultLimit: number;
  readonly maxLimit: number;
}

export interface BookSlotInput {
  readonly scheduleId: number;
  readonly patientName: string;
  readonly idempotencyKey: string;
}

export interface BookSlotResult {
  readonly isReplay: boolean;
  readonly appointment: AppointmentRecord;
}

export interface BookingModule {
  listSchedules(query?: ScheduleQueryInput): Promise<readonly ScheduleWithDoctor[]>;
  listAppointments(query?: AppointmentQueryInput): Promise<readonly AppointmentRecord[]>;
  bookSlot(input: BookSlotInput): Promise<BookSlotResult>;
  cancelAppointment(appointmentId: number): Promise<AppointmentRecord>;
  getPaginationBounds(): PaginationBounds;
}
