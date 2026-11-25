export type BookingErrorCode =
  | 'INVALID_INPUT'
  | 'SCHEDULE_NOT_FOUND'
  | 'APPOINTMENT_NOT_FOUND'
  | 'SLOT_ALREADY_BOOKED'
  | 'IDEMPOTENCY_CONFLICT';

export class BookingDomainError extends Error {
  public readonly code: BookingErrorCode;
  public readonly statusCode: number;

  constructor(code: BookingErrorCode, statusCode: number, message: string) {
    super(message);
    this.name = 'BookingDomainError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class InvalidBookingInputError extends BookingDomainError {
  constructor(message: string) {
    super('INVALID_INPUT', 400, message);
    this.name = 'InvalidBookingInputError';
  }
}

export class ScheduleNotFoundError extends BookingDomainError {
  constructor(message = 'Schedule slot not found') {
    super('SCHEDULE_NOT_FOUND', 404, message);
    this.name = 'ScheduleNotFoundError';
  }
}

export class AppointmentNotFoundError extends BookingDomainError {
  constructor(message = 'Appointment not found') {
    super('APPOINTMENT_NOT_FOUND', 404, message);
    this.name = 'AppointmentNotFoundError';
  }
}

export class SlotAlreadyBookedError extends BookingDomainError {
  constructor(message = 'This schedule slot is already booked') {
    super('SLOT_ALREADY_BOOKED', 409, message);
    this.name = 'SlotAlreadyBookedError';
  }
}

/**
 * Infrastructure adapters throw this domain signal when a unique constraint
 * violation occurs on idempotency_key during concurrent writes, allowing the
 * core engine to resolve the race as a clean idempotent replay.
 */
export class UniqueIdempotencyConflictError extends BookingDomainError {
  public readonly idempotencyKey: string;

  constructor(idempotencyKey: string) {
    super(
      'IDEMPOTENCY_CONFLICT',
      409,
      `Concurrent idempotency conflict for key: ${idempotencyKey}`,
    );
    this.name = 'UniqueIdempotencyConflictError';
    this.idempotencyKey = idempotencyKey;
  }
}
