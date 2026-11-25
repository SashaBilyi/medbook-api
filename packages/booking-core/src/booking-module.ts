import type {
  AppointmentQueryInput,
  AppointmentRecord,
  BookingModule,
  BookSlotInput,
  BookSlotResult,
  NormalizedAppointmentQuery,
  NormalizedScheduleQuery,
  PaginationBounds,
  ScheduleQueryInput,
  ScheduleWithDoctor,
} from './contracts.js';
import {
  AppointmentNotFoundError,
  InvalidBookingInputError,
  ScheduleNotFoundError,
  SlotAlreadyBookedError,
  UniqueIdempotencyConflictError,
} from './errors.js';
import type { BookingModuleDependencies, RetryPolicyPort } from './ports.js';

const DEFAULT_PAGINATION: PaginationBounds = {
  defaultLimit: 50,
  maxLimit: 200,
};

const passthroughRetryPolicy: RetryPolicyPort = {
  execute: <T>(operation: () => Promise<T>) => operation(),
};

function normalizeLimit(rawLimit: number | undefined, bounds: PaginationBounds): number {
  if (rawLimit === undefined) {
    return bounds.defaultLimit;
  }
  if (!Number.isInteger(rawLimit) || rawLimit < 1) {
    throw new InvalidBookingInputError('Query parameter limit must be a positive integer');
  }
  return Math.min(rawLimit, bounds.maxLimit);
}

function normalizeOffset(rawOffset: number | undefined): number {
  if (rawOffset === undefined) {
    return 0;
  }
  if (!Number.isInteger(rawOffset) || rawOffset < 0) {
    throw new InvalidBookingInputError('Query parameter offset must be a non-negative integer');
  }
  return rawOffset;
}

function normalizePaginationBounds(custom?: Partial<PaginationBounds>): PaginationBounds {
  const maxLimit = custom?.maxLimit ?? DEFAULT_PAGINATION.maxLimit;
  const defaultLimit = Math.min(custom?.defaultLimit ?? DEFAULT_PAGINATION.defaultLimit, maxLimit);

  if (!Number.isInteger(maxLimit) || maxLimit < 1) {
    throw new InvalidBookingInputError('Pagination maxLimit must be a positive integer');
  }
  if (!Number.isInteger(defaultLimit) || defaultLimit < 1) {
    throw new InvalidBookingInputError('Pagination defaultLimit must be a positive integer');
  }

  return { defaultLimit, maxLimit };
}

export function createBookingModule(deps: BookingModuleDependencies): BookingModule {
  const bounds = normalizePaginationBounds(deps.pagination);
  const retry = deps.retryPolicy ?? passthroughRetryPolicy;

  return {
    getPaginationBounds(): PaginationBounds {
      return bounds;
    },

    async listSchedules(query: ScheduleQueryInput = {}): Promise<readonly ScheduleWithDoctor[]> {
      if (
        query.doctorId !== undefined &&
        (!Number.isInteger(query.doctorId) || query.doctorId < 1)
      ) {
        throw new InvalidBookingInputError('Query parameter doctorId must be a positive integer');
      }

      const normalized: NormalizedScheduleQuery = {
        doctorId: query.doctorId,
        availableOnly: Boolean(query.availableOnly),
        limit: normalizeLimit(query.limit, bounds),
        offset: normalizeOffset(query.offset),
      };

      return retry.execute(() => deps.schedules.findSchedulesWithDoctors(normalized));
    },

    async listAppointments(
      query: AppointmentQueryInput = {},
    ): Promise<readonly AppointmentRecord[]> {
      if (
        query.status !== undefined &&
        query.status !== 'confirmed' &&
        query.status !== 'cancelled'
      ) {
        throw new InvalidBookingInputError(
          'Query parameter status must be "confirmed" or "cancelled"',
        );
      }

      const normalized: NormalizedAppointmentQuery = {
        status: query.status,
        limit: normalizeLimit(query.limit, bounds),
        offset: normalizeOffset(query.offset),
      };

      return retry.execute(() => deps.appointments.findAppointments(normalized));
    },

    async bookSlot(input: BookSlotInput): Promise<BookSlotResult> {
      if (!Number.isInteger(input.scheduleId) || input.scheduleId < 1) {
        throw new InvalidBookingInputError('scheduleId must be a positive integer');
      }
      const trimmedPatient = input.patientName.trim();
      if (trimmedPatient.length < 2) {
        throw new InvalidBookingInputError('patientName must be at least 2 characters');
      }
      const trimmedKey = input.idempotencyKey.trim();
      if (trimmedKey.length === 0) {
        throw new InvalidBookingInputError('Header Idempotency-Key is required');
      }

      // Single-snapshot lock-free preflight: fast-paths replay (200), 404, and 409 without
      // opening a write transaction or contending on FOR UPDATE row locks.
      if (deps.appointments.preflightBooking) {
        const snapshot = await retry.execute(() =>
          deps.appointments.preflightBooking!(input.scheduleId, trimmedKey),
        );
        if (snapshot.existingAppointment) {
          return { isReplay: true, appointment: snapshot.existingAppointment };
        }
        if (!snapshot.slot) {
          throw new ScheduleNotFoundError();
        }
        if (snapshot.slot.isBooked) {
          throw new SlotAlreadyBookedError();
        }
      }

      try {
        return await retry.execute(() =>
          deps.transactions.runInTransaction(async (tx) => {
            const existing = await tx.findAppointmentByIdempotencyKey(trimmedKey);
            if (existing) {
              return { isReplay: true, appointment: existing };
            }

            const slot = await tx.lockScheduleForUpdate(input.scheduleId);
            if (!slot) {
              throw new ScheduleNotFoundError();
            }

            if (slot.isBooked) {
              const raced = await tx.findAppointmentByIdempotencyKey(trimmedKey);
              if (raced) {
                return { isReplay: true, appointment: raced };
              }
              throw new SlotAlreadyBookedError();
            }

            await tx.markScheduleBooked(input.scheduleId, true);

            const created = await tx.insertAppointment({
              scheduleId: input.scheduleId,
              patientName: trimmedPatient,
              status: 'confirmed',
              idempotencyKey: trimmedKey,
            });

            return { isReplay: false, appointment: created };
          }),
        );
      } catch (error) {
        if (error instanceof UniqueIdempotencyConflictError) {
          deps.logger?.debug?.('Resolved concurrent idempotency race as replay', {
            idempotencyKey: trimmedKey,
          });
          const committed = await retry.execute(() =>
            deps.appointments.findByIdempotencyKey(trimmedKey),
          );
          if (committed) {
            return { isReplay: true, appointment: committed };
          }
        }
        throw error;
      }
    },

    async cancelAppointment(appointmentId: number): Promise<AppointmentRecord> {
      if (!Number.isInteger(appointmentId) || appointmentId < 1) {
        throw new InvalidBookingInputError('Invalid appointment ID');
      }

      return retry.execute(() =>
        deps.transactions.runInTransaction(async (tx) => {
          const appointment = await tx.lockAppointmentForUpdate(appointmentId);
          if (!appointment) {
            throw new AppointmentNotFoundError();
          }

          if (appointment.status === 'cancelled') {
            return appointment;
          }

          const updated = await tx.updateAppointmentStatus(appointmentId, 'cancelled');
          await tx.markScheduleBooked(appointment.scheduleId, false);
          return updated;
        }),
      );
    },
  };
}
