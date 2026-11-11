import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerErrorHandler } from '../../src/api/error-handler.js';
import { BusinessError, withRetry } from '../../src/db/resilience.js';

describe('Unit: resilience (BusinessError & withRetry)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates BusinessError with status code, message, and exact error name', () => {
    const err = new BusinessError(409, 'Slot taken');
    expect(err.statusCode).toBe(409);
    expect(err.message).toBe('Slot taken');
    expect(err.name).toBe('BusinessError');
  });

  it('returns result immediately on first attempt without calling setTimeout', async () => {
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const operation = vi.fn().mockResolvedValue('success');

    const result = await withRetry(operation, 3, 200);

    expect(result).toBe('success');
    expect(operation).toHaveBeenCalledTimes(1);
    expect(timeoutSpy).not.toHaveBeenCalled();
  });

  it('retries transient errors with exact exponential backoff delays (200ms, 400ms)', async () => {
    const recordedDelays: number[] = [];
    const originalSetTimeout = globalThis.setTimeout;

    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
      callback: () => void,
      ms?: number,
    ) => {
      recordedDelays.push(ms ?? 0);
      return originalSetTimeout(callback, 1);
    }) as typeof setTimeout);

    const operation = vi
      .fn()
      .mockRejectedValueOnce(new Error('DB timeout 1'))
      .mockRejectedValueOnce(new Error('DB timeout 2'))
      .mockResolvedValue('recovered');

    const result = await withRetry(operation, 3, 200);

    expect(result).toBe('recovered');
    expect(operation).toHaveBeenCalledTimes(3);
    expect(recordedDelays).toEqual([200, 400]);
  });

  it('does NOT retry BusinessError and rethrows immediately without delay', async () => {
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const operation = vi.fn().mockRejectedValue(new BusinessError(404, 'Not found'));

    await expect(withRetry(operation, 3, 200)).rejects.toThrow('Not found');
    expect(operation).toHaveBeenCalledTimes(1);
    expect(timeoutSpy).not.toHaveBeenCalled();
  });

  it('throws last error when all retries are exhausted and does not sleep after final attempt', async () => {
    const recordedDelays: number[] = [];
    const originalSetTimeout = globalThis.setTimeout;

    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
      callback: () => void,
      ms?: number,
    ) => {
      recordedDelays.push(ms ?? 0);
      return originalSetTimeout(callback, 1);
    }) as typeof setTimeout);

    const operation = vi.fn().mockRejectedValue(new Error('Persistent DB failure'));

    await expect(withRetry(operation, 3, 200)).rejects.toThrow('Persistent DB failure');
    expect(operation).toHaveBeenCalledTimes(3);
    expect(recordedDelays).toEqual([200, 400]);
  });
});

describe('Unit: centralized error-handler branches', () => {
  it('formats BusinessError, unknown status fallback, and 503 DB error payloads', async () => {
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
    expect(res404.json()).toEqual({
      error: 'Not Found',
      message: 'Doctor not found',
    });

    const res422 = await app.inject({ method: 'GET', url: '/err-unknown-code' });
    expect(res422.statusCode).toBe(422);
    expect(res422.json()).toEqual({
      error: 'Application Error',
      message: 'Unprocessable',
    });

    const res503 = await app.inject({ method: 'GET', url: '/err-db' });
    expect(res503.statusCode).toBe(503);
    expect(res503.json()).toEqual({
      error: 'Service Unavailable',
      message: 'Database error occurred after retries',
    });

    await app.close();
  });
});