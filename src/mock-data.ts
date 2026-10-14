export interface Doctor {
  id: number;
  name: string;
  specialization: string;
}

export interface ScheduleSlot {
  id: number;
  doctorId: number;
  slotTime: string;
  isBooked: boolean;
}

export interface Appointment {
  id: number;
  scheduleId: number;
  patientName: string;
  status: 'confirmed' | 'cancelled';
  idempotencyKey: string;
  createdAt: string;
}

export const doctors: Doctor[] = [
  { id: 1, name: 'Др. Олександр Коваль', specialization: 'Кардіолог' },
  { id: 2, name: 'Др. Ірина Мельник', specialization: 'Невролог' },
];

export const schedules: ScheduleSlot[] = [
  { id: 101, doctorId: 1, slotTime: '2026-10-20T09:00:00.000Z', isBooked: false },
  { id: 102, doctorId: 1, slotTime: '2026-10-20T10:00:00.000Z', isBooked: false },
  { id: 103, doctorId: 2, slotTime: '2026-10-20T11:00:00.000Z', isBooked: false },
];

export const appointments: Appointment[] = [];
