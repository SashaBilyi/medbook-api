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

    const replayRes = await app.inject({
      method: 'POST',
      url: '/api/appointments',
      headers: { 'idempotency-key': 'int-key-1' },
      payload: { scheduleId: 101, patientName: 'Іван Франко' },
    });
    expect(replayRes.statusCode).toBe(200);

    const listRes = await app.inject({ method: 'GET', url: '/api/appointments' });
    expect(listRes.json()).toHaveLength(1);
  });

  it('POST /api/appointments returns 400, 404, and 409 on invalid or conflicting requests', async () => {
    const noHeaderRes = await app.inject({
      method: 'POST',
      url: '/api/appointments',
      payload: { scheduleId: 101, patientName: 'Іван Франко' },
    });
    expect(noHeaderRes.statusCode).toBe(400);

    const badBodyRes = await app.inject({
      method: 'POST',
      url: '/api/appointments',
      headers: { 'idempotency-key': 'int-key-bad' },
      payload: { scheduleId: 101, patientName: 'А' },
    });
    expect(badBodyRes.statusCode).toBe(400);

    const notFoundRes = await app.inject({
      method: 'POST',
      url: '/api/appointments',
      headers: { 'idempotency-key': 'int-key-404' },
      payload: { scheduleId: 999, patientName: 'Іван Франко' },
    });
    expect(notFoundRes.statusCode).toBe(404);

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
  });

  it('PATCH /api/appointments/:id/cancel cancels appointment and handles errors', async () => {
    const badIdRes = await app.inject({
      method: 'PATCH',
      url: '/api/appointments/not-a-number/cancel',
    });
    expect(badIdRes.statusCode).toBe(400);

    const missingRes = await app.inject({
      method: 'PATCH',
      url: '/api/appointments/999/cancel',
    });
    expect(missingRes.statusCode).toBe(404);

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

    const secondCancelRes = await app.inject({
      method: 'PATCH',
      url: '/api/appointments/1/cancel',
    });
    expect(secondCancelRes.statusCode).toBe(200);
  });
});