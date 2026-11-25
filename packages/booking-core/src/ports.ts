import type {
  AppointmentRecord,
  AppointmentStatus,
  NormalizedAppointmentQuery,
  NormalizedScheduleQuery,
  PaginationBounds,
  ScheduleRecord,
  ScheduleWithDoctor,
} from './contracts.js';

export interface CreateAppointmentRecordData {
  readonly scheduleId: number;
  readonly patientName: string;
  readonly status: AppointmentStatus;
  readonly idempotencyKey: string;
}

export interface ScheduleReadPort {
  findSchedulesWithDoctors(query: NormalizedScheduleQuery): Promise<readonly ScheduleWithDoctor[]>;
}

export interface BookingPreflightSnapshot {
  readonly existingAppointment: AppointmentRecord | null;
  readonly slot: ScheduleRecord | null;
}

export interface AppointmentReadPort {
  findAppointments(query: NormalizedAppointmentQuery): Promise<readonly AppointmentRecord[]>;
  findByIdempotencyKey(idempotencyKey: string): Promise<AppointmentRecord | null>;
  /**
   * Optional single-snapshot lock-free preflight read used to fast-path
   * replays, missing slots, and already-booked conflicts without opening
   * a write transaction or acquiring row locks.
   */
  preflightBooking?(scheduleId: number, idempotencyKey: string): Promise<BookingPreflightSnapshot>;
}

export interface BookingTransactionScope {
  findAppointmentByIdempotencyKey(idempotencyKey: string): Promise<AppointmentRecord | null>;
  lockScheduleForUpdate(scheduleId: number): Promise<ScheduleRecord | null>;
  markScheduleBooked(scheduleId: number, isBooked: boolean): Promise<void>;
  insertAppointment(data: CreateAppointmentRecordData): Promise<AppointmentRecord>;
  lockAppointmentForUpdate(appointmentId: number): Promise<AppointmentRecord | null>;
  updateAppointmentStatus(
    appointmentId: number,
    status: AppointmentStatus,
  ): Promise<AppointmentRecord>;
}

export interface TransactionRunnerPort {
  runInTransaction<T>(work: (scope: BookingTransactionScope) => Promise<T>): Promise<T>;
}

export interface RetryPolicyPort {
  execute<T>(operation: () => Promise<T>): Promise<T>;
}

export interface BookingLoggerPort {
  debug?(message: string, context?: Readonly<Record<string, unknown>>): void;
  warn?(message: string, context?: Readonly<Record<string, unknown>>): void;
}

export interface BookingModuleDependencies {
  readonly schedules: ScheduleReadPort;
  readonly appointments: AppointmentReadPort;
  readonly transactions: TransactionRunnerPort;
  readonly retryPolicy?: RetryPolicyPort;
  readonly logger?: BookingLoggerPort;
  readonly pagination?: Partial<PaginationBounds>;
}
