export { createBookingModule } from './booking-module.js';
export {
  BOOKING_CORE_VERSION,
  type AppointmentQueryInput,
  type AppointmentRecord,
  type AppointmentStatus,
  type BookingModule,
  type BookSlotInput,
  type BookSlotResult,
  type NormalizedAppointmentQuery,
  type NormalizedScheduleQuery,
  type PaginationBounds,
  type ScheduleQueryInput,
  type ScheduleRecord,
  type ScheduleWithDoctor,
} from './contracts.js';
export {
  AppointmentNotFoundError,
  BookingDomainError,
  InvalidBookingInputError,
  ScheduleNotFoundError,
  SlotAlreadyBookedError,
  UniqueIdempotencyConflictError,
  type BookingErrorCode,
} from './errors.js';
export type {
  AppointmentReadPort,
  BookingLoggerPort,
  BookingModuleDependencies,
  BookingPreflightSnapshot,
  BookingTransactionScope,
  CreateAppointmentRecordData,
  RetryPolicyPort,
  ScheduleReadPort,
  TransactionRunnerPort,
} from './ports.js';
