import { db } from '../db/index.js';
import { withRetry } from '../db/resilience.js';
import { doctors } from '../db/schema.js';

export const doctorsService = {
  async getAll() {
    return withRetry(() => db.select().from(doctors).orderBy(doctors.id));
  },
};
