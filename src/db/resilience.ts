export class BusinessError extends Error {
  public readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'BusinessError';
    this.statusCode = statusCode;
  }
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  retries = 3,
  delayMs = 200,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof BusinessError) {
        throw error;
      }

      lastError = error;

      if (attempt < retries) {
        const backoff = delayMs * Math.pow(2, attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, backoff));
      }
    }
  }

  throw lastError;
}
