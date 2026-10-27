import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { registerErrorHandler } from '../../src/api/error-handler.js';
import { BusinessError, withRetry } from '../../src/db/resilience.js';

describe('Unit: resilience (BusinessError & withRetry)', () => {
  it('creates BusinessError with status code and message', () => {
    const err = new BusinessError(409, 'Slot taken');
    expect(err.statusCode).toBe(409);
    expect(err.message).toBe('Slot taken');
  });

  it('returns result immediately when operation succeeds on first attempt', async () => {
    const operation = vi.fn().mockResolvedValue('success');
    const result = await withRetry(operation, 3, 5);

    expect(result).toBe('success');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('retries transient errors and succeeds on subsequent attempt', async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new Error('DB timeout 1'))
      .mockRejectedValueOnce(new Error('DB timeout 2'))
      .mockResolvedValue('recovered');

    const result = await withRetry(operation, 3, 5);

    expect(result).toBe('recovered');
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it('does NOT retry BusinessError and rethrows immediately', async () => {
    const operation = vi.fn().mockRejectedValue(new BusinessError(404, 'Not found'));

    await expect(withRetry(operation, 3, 5)).rejects.toThrow('Not found');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('throws last error when all retries are exhausted', async () => {
    const operation = vi.fn().mockRejectedValue(new Error('Persistent DB failure'));

    await expect(withRetry(operation, 3, 5)).rejects.toThrow('Persistent DB failure');
    expect(operation).toHaveBeenCalledTimes(3);
  });
});

describe('Unit: centralized error-handler branches', () => {
  it('handles BusinessError, validation error, and unexpected DB error', async () => {
    const app = Fastify({ logger: false });
    registerErrorHandler(app);

    app.get('/err-business', async () => {
      throw new BusinessError(404, 'Doctor not found');
    });

    app.get('/err-unknown-code', async () => {
      throw new BusinessError(422, 'Unprocessable');
    });

    app.get('/err-db', async () => {
      throw new Error('Connection reset');
    });

    const res404 = await app.inject({ method: 'GET', url: '/err-business' });
    expect(res404.statusCode).toBe(404);

    const res422 = await app.inject({ method: 'GET', url: '/err-unknown-code' });
    expect(res422.statusCode).toBe(422);

    const res503 = await app.inject({ method: 'GET', url: '/err-db' });
    expect(res503.statusCode).toBe(503);

    await app.close();
  });
});