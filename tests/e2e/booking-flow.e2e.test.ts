import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { resetAndSeedDatabase } from '../helpers/db-reset.js';

describe('E2E: Full Patient Booking & Cancellation Lifecycle over HTTP', () => {
  const app = buildApp(false);
  let baseUrl = '';

  beforeAll(async () => {
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    baseUrl = address;
  });

  beforeEach(async () => {
    await resetAndSeedDatabase();
  });

  afterAll(async () => {
    await app.close();
  });

  it('completes full user journey: view schedule -> book -> conflict -> cancel -> rebook', async () => {
    const schedulesRes = await fetch(`${baseUrl}/api/schedules`);
    expect(schedulesRes.status).toBe(200);
    const schedules = (await schedulesRes.json()) as Array<{ id: number; isBooked: boolean }>;
    const targetSlot = schedules.find((s) => s.id === 103);
    expect(targetSlot?.isBooked).toBe(false);

    const bookRes = await fetch(`${baseUrl}/api/appointments`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'e2e-journey-key-1',
      },
      body: JSON.stringify({ scheduleId: 103, patientName: 'Тарас Шевченко' }),
    });
    expect(bookRes.status).toBe(201);
    const createdAppointment = (await bookRes.json()) as { id: number; status: string };
    expect(createdAppointment.status).toBe('confirmed');

    const conflictRes = await fetch(`${baseUrl}/api/appointments`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'e2e-journey-key-2',
      },
      body: JSON.stringify({ scheduleId: 103, patientName: 'Григорій Сковорода' }),
    });
    expect(conflictRes.status).toBe(409);
    const conflictBody = (await conflictRes.json()) as { error: string; message: string };
    expect(conflictBody).toEqual({
      error: 'Conflict',
      message: 'This schedule slot is already booked',
    });

    const cancelRes = await fetch(
      `${baseUrl}/api/appointments/${createdAppointment.id}/cancel`,
      { method: 'PATCH' },
    );
    expect(cancelRes.status).toBe(200);

    const rebookRes = await fetch(`${baseUrl}/api/appointments`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'e2e-journey-key-3',
      },
      body: JSON.stringify({ scheduleId: 103, patientName: 'Григорій Сковорода' }),
    });
    expect(rebookRes.status).toBe(201);
  });
});