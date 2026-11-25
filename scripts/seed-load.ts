/* eslint-disable no-console */
import { sql } from 'drizzle-orm';
import { db, queryClient } from '../src/db/index.js';
import { appointments, doctors, schedules } from '../src/db/schema.js';

const DOCTOR_COUNT = 100;
const SLOTS_PER_DOCTOR = 250; // 25,000 schedules total
const BOOKED_RATIO = 0.4; // 10,000 booked schedules -> 10,000 confirmed appointments
const EXTRA_CANCELLED = 5_000; // 5,000 historical cancelled appointments -> 15,000 total

const SPECIALIZATIONS = [
  'Кардіолог',
  'Невролог',
  'Терапевт',
  'Педіатр',
  'Офтальмолог',
  'Дерматолог',
  'Ендокринолог',
  'Хірург',
  'Ортопед',
  'Гастроентеролог',
];

async function seedLoadDataset() {
  const startedAt = performance.now();
  console.log('Seeding realistic load-test dataset into PostgreSQL...');

  await db.execute(sql`TRUNCATE TABLE appointments, schedules, doctors RESTART IDENTITY CASCADE;`);

  // 1. Insert 100 doctors
  const doctorValues = Array.from({ length: DOCTOR_COUNT }, (_, idx) => ({
    name: `Др. Лікар #${idx + 1}`,
    specialization: SPECIALIZATIONS[idx % SPECIALIZATIONS.length] ?? 'Терапевт',
  }));

  const insertedDoctors = await db.insert(doctors).values(doctorValues).returning({ id: doctors.id });

  // 2. Insert 25,000 schedules in batches of 1,000
  const baseTime = new Date('2026-11-01T08:00:00.000Z').getTime();
  const scheduleRows: Array<{ doctorId: number; slotTime: Date; isBooked: boolean }> = [];

  for (const doc of insertedDoctors) {
    for (let s = 0; s < SLOTS_PER_DOCTOR; s++) {
      // Deterministic 40% booked, 60% free across every doctor
      const isBooked = s % 5 < 2;
      scheduleRows.push({
        doctorId: doc.id,
        slotTime: new Date(baseTime + s * 30 * 60 * 1000),
        isBooked,
      });
    }
  }

  const insertedSchedules: Array<{ id: number; isBooked: boolean }> = [];
  const BATCH_SIZE = 1000;

  for (let i = 0; i < scheduleRows.length; i += BATCH_SIZE) {
    const chunk = scheduleRows.slice(i, i + BATCH_SIZE);
    const rows = await db
      .insert(schedules)
      .values(chunk)
      .returning({ id: schedules.id, isBooked: schedules.isBooked });
    insertedSchedules.push(...rows);
  }

  // 3. Insert 10,000 confirmed + 5,000 cancelled appointments
  const bookedSchedules = insertedSchedules.filter((s) => s.isBooked);
  const freeSchedules = insertedSchedules.filter((s) => !s.isBooked);

  const appointmentRows: Array<{
    scheduleId: number;
    patientName: string;
    status: string;
    idempotencyKey: string;
  }> = [];

  for (let i = 0; i < bookedSchedules.length; i++) {
    const slot = bookedSchedules[i];
    if (!slot) continue;
    appointmentRows.push({
      scheduleId: slot.id,
      patientName: `Пацієнт Підтверджений #${i + 1}`,
      status: 'confirmed',
      idempotencyKey: `load-confirmed-${i + 1}`,
    });
  }

  for (let i = 0; i < EXTRA_CANCELLED; i++) {
    const slot = freeSchedules[i % freeSchedules.length];
    if (!slot) continue;
    appointmentRows.push({
      scheduleId: slot.id,
      patientName: `Пацієнт Скасований #${i + 1}`,
      status: 'cancelled',
      idempotencyKey: `load-cancelled-${i + 1}`,
    });
  }

  for (let i = 0; i < appointmentRows.length; i += BATCH_SIZE) {
    const chunk = appointmentRows.slice(i, i + BATCH_SIZE);
    await db.insert(appointments).values(chunk);
  }

  await db.execute(sql`ANALYZE doctors, schedules, appointments;`);

  const elapsedMs = (performance.now() - startedAt).toFixed(0);
  console.log(
    `Load dataset ready in ${elapsedMs} ms: ` +
      `doctors=${insertedDoctors.length}, ` +
      `schedules=${insertedSchedules.length} (booked=${bookedSchedules.length}, free=${freeSchedules.length}, ratio=${BOOKED_RATIO}), ` +
      `appointments=${appointmentRows.length}.`,
  );

  await queryClient.end();
}

seedLoadDataset().catch((err) => {
  console.error('Load dataset seeding failed:', err);
  process.exit(1);
});
