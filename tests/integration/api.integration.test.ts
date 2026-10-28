import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { resetAndSeedDatabase } from '../helpers/db-reset.js';

describe('Integration: API Routes + PostgreSQL', () => {
  const app = buildApp(false);

  beforeAll(async () => {
    await app.ready();
  });

  beforeEach(async () => {
    await resetAndSeedDatabase();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/health and GET / return service metadata', async () => {
    const rootRes = await app.inject({ method: 'GET', url: '/' });
    expect(rootRes.statusCode).toBe(200);

    const healthRes = await app.inject({ method: 'GET', url: '/api/health' });
    expect(healthRes.statusCode).toBe(200);
    expect(healthRes.json().status).toBe('ok');
  });

  it('GET /api/doctors and GET /api/schedules return seeded rows with INNER JOIN', async () => {
    const docRes = await app.inject({ method: 'GET', url: '/api/doctors' });
    expect(docRes.statusCode).toBe(200);
    expect(docRes.json()).toHaveLength(2);

    const schedRes = await app.inject({ method: 'GET', url: '/api/schedules' });
    expect(schedRes.statusCode).toBe(200);
    const schedules = schedRes.json();
    expect(schedules).toHaveLength(3);
    expect(schedules[0].doctorName).toBe('Др. Олександр Коваль');
  });

  it('POST /api/appointments books a slot and handles idempotent replay', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/appointments',
      headers: { 'idempotency-key': 'int-key-1' },
      payload: { scheduleId: 101, patientName: 'Іван Франко' },
    });
    expect(createRes.statusCode).toBe(201);
    expect(createRes.json().status).toBe('confirmed');

    const replayRes = await app.inject({
      method: 'POST',
      url: '/api/appointments',
      headers: { 'idempotency-key': 'int-key-1' },
      payload: { scheduleId: 101, patientName: 'Іван Франко' },
    });
    expect(replayRes.statusCode).toBe(200);
    expect(replayRes.json().id).toBe(createRes.json().id);

    const listRes = await app.inject({ method: 'GET', url: '/api/appointments' });
    expect(listRes.json()).toHaveLength(1);
  });

  it('POST /api/appointments returns structured 400, 404, and 409 error payloads', async () => {
    const noHeaderRes = await app.inject({
      method: 'POST',
      url: '/api/appointments',
      payload: { scheduleId: 101, patientName: 'Іван Франко' },
    });
    expect(noHeaderRes.statusCode).toBe(400);
    expect(noHeaderRes.json()).toEqual({
      error: 'Bad Request',
      message: 'Header Idempotency-Key is required',
    });

    const badBodyRes = await app.inject({
      method: 'POST',
      url: '/api/appointments',
      headers: { 'idempotency-key': 'int-key-bad' },
      payload: { scheduleId: 101, patientName: 'А' },
    });
    expect(badBodyRes.statusCode).toBe(400);
    expect(badBodyRes.json().error).toBe('Bad Request');
    expect(badBodyRes.json().message).toContain('patientName');

    const notFoundRes = await app.inject({
      method: 'POST',
      url: '/api/appointments',
      headers: { 'idempotency-key': 'int-key-404' },
      payload: { scheduleId: 999, patientName: 'Іван Франко' },
    });
    expect(notFoundRes.statusCode).toBe(404);
    expect(notFoundRes.json()).toEqual({
      error: 'Not Found',
      message: 'Schedule slot not found',
    });

    await app.inject({
      method: 'POST',
      url: '/api/appointments',
      headers: { 'idempotency-key': 'int-key-first' },
      payload: { scheduleId: 101, patientName: 'Перший Пацієнт' },
    });

    const conflictRes = await app.inject({
      method: 'POST',
      url: '/api/appointments',
      headers: { 'idempotency-key': 'int-key-second' },
      payload: { scheduleId: 101, patientName: 'Другий Пацієнт' },
    });
    expect(conflictRes.statusCode).toBe(409);
    expect(conflictRes.json()).toEqual({
      error: 'Conflict',
      message: 'This schedule slot is already booked',
    });
  });

  it('PATCH /api/appointments/:id/cancel frees slot and protects rebooked slot on duplicate cancel', async () => {
    const badIdRes = await app.inject({
      method: 'PATCH',
      url: '/api/appointments/not-a-number/cancel',
    });
    expect(badIdRes.statusCode).toBe(400);
    expect(badIdRes.json()).toEqual({
      error: 'Bad Request',
      message: 'Invalid appointment ID',
    });

    const missingRes = await app.inject({
      method: 'PATCH',
      url: '/api/appointments/999/cancel',
    });
    expect(missingRes.statusCode).toBe(404);
    expect(missingRes.json()).toEqual({
      error: 'Not Found',
      message: 'Appointment not found',
    });

    await app.inject({
      method: 'POST',
      url: '/api/appointments',
      headers: { 'idempotency-key': 'int-cancel-1' },
      payload: { scheduleId: 102, patientName: 'Леся Українка' },
    });

    const cancelRes = await app.inject({
      method: 'PATCH',
      url: '/api/appointments/1/cancel',
    });
    expect(cancelRes.statusCode).toBe(200);
    expect(cancelRes.json().status).toBe('cancelled');

    const rebookRes = await app.inject({
      method: 'POST',
      url: '/api/appointments',
      headers: { 'idempotency-key': 'int-rebook-2' },
      payload: { scheduleId: 102, patientName: 'Богдан Хмельницький' },
    });
    expect(rebookRes.statusCode).toBe(201);

    const secondCancelRes = await app.inject({
      method: 'PATCH',
      url: '/api/appointments/1/cancel',
    });
    expect(secondCancelRes.statusCode).toBe(200);
    expect(secondCancelRes.json().status).toBe('cancelled');

    const schedulesRes = await app.inject({ method: 'GET', url: '/api/schedules' });
    const slot102 = schedulesRes
      .json()
      .find((s: { id: number; isBooked: boolean }) => s.id === 102);
    expect(slot102?.isBooked).toBe(true);
  });
});