import {
  createBookingModule,
  type BookingModule,
  type PaginationBounds,
  type RetryPolicyPort,
} from '@medbook/booking-core';
import {
  createDrizzleBookingAdapters,
  type DrizzleDatabase,
} from './adapters/drizzle-booking.adapter.js';
import { db } from './db/index.js';
import { withRetry } from './db/resilience.js';

export interface ContainerOptions {
  readonly database?: DrizzleDatabase;
  readonly pagination?: Partial<PaginationBounds>;
}

export interface AppContainer {
  readonly bookingModule: BookingModule;
}

const defaultRetryPolicy: RetryPolicyPort = {
  execute: <T>(operation: () => Promise<T>) => withRetry(operation),
};

/**
 * Application Composition Root: connects the pure `@medbook/booking-core`
 * domain library to concrete PostgreSQL / Drizzle adapters and retry policy.
 */
export function createAppContainer(options: ContainerOptions = {}): AppContainer {
  const database = options.database ?? db;
  const adapters = createDrizzleBookingAdapters(database);

  const bookingModule = createBookingModule({
    schedules: adapters.schedules,
    appointments: adapters.appointments,
    transactions: adapters.transactions,
    retryPolicy: defaultRetryPolicy,
    pagination: options.pagination,
  });

  return { bookingModule };
}
