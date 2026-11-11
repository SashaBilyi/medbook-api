import { boolean, integer, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';

export const doctors = pgTable('doctors', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  specialization: text('specialization').notNull(),
});

export const schedules = pgTable('schedules', {
  id: serial('id').primaryKey(),
  doctorId: integer('doctor_id')
    .notNull()
    .references(() => doctors.id, { onDelete: 'cascade' }),
  slotTime: timestamp('slot_time', { withTimezone: true }).notNull(),
  isBooked: boolean('is_booked').notNull().default(false),
});

export const appointments = pgTable('appointments', {
  id: serial('id').primaryKey(),
  scheduleId: integer('schedule_id')
    .notNull()
    .references(() => schedules.id, { onDelete: 'cascade' }),
  patientName: text('patient_name').notNull(),
  status: text('status').notNull().default('confirmed'),
  idempotencyKey: text('idempotency_key').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
