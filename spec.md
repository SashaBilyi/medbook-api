# Специфікація: MedBook API (Завдання 2 - Дані та БД)

## 1. Основні сценарії та очікувана поведінка

1. **Перегляд розкладу (`GET /schedules`):** Повертає список доступних слотів разом з інформацією про лікаря (ім'я, спеціалізація). Повинен виконуватися одним запитом через `JOIN` (без проблеми N+1).
2. **Бронювання прийому (`POST /appointments`):** Пацієнт передає `patientId`, `scheduleId` та заголовок `Idempotency-Key`. Система в транзакції перевіряє, чи слот вільний (`isBooked = false`), позначає його зайнятим і створює запис прийому зі статусом `confirmed`.
3. **Скасування прийому (`PATCH /appointments/:id/cancel`):** Переводить прийом у статус `cancelled` та звільняє слот у розкладі (`isBooked = false`) в межах однієї транзакції.

## 2. Схема БД (PostgreSQL + Drizzle ORM)

- **`doctors`**: `id` (serial PK), `name` (text, not null), `specialization` (text, not null).
- **`schedules`**: `id` (serial PK), `doctor_id` (int FK -> doctors.id), `slot_time` (timestamp, not null), `is_booked` (boolean, default false).
- **`appointments`**: `id` (serial PK), `schedule_id` (int FK -> schedules.id), `patient_name` (text, not null), `status` (text: `confirmed` | `cancelled`), `idempotency_key` (text, unique, not null), `created_at` (timestamp).

## 3. Ключові запити та захист від N+1

- Вибірка слотів: `SELECT s.*, d.name, d.specialization FROM schedules s INNER JOIN doctors d ON s.doctor_id = d.id`.
- Бронювання: `SELECT ... FOR UPDATE` на рядок `schedules` у транзакції для блокування конкурентних запитів (race condition).

## 4. Сценарії помилок та стійкість (Resilience)

- `400 Bad Request` — невалідне тіло запиту або відсутній `Idempotency-Key` (валідація Fastify JSON Schema).
- `409 Conflict` — слот уже заброньовано іншим пацієнтом.
- `200 OK` (при повторному запиті з тим самим `Idempotency-Key`) — повертає раніше створений запис без дублювання в БД.
- `503 Service Unavailable` — збій підключення до БД після 3 спроб автоматичного повтору (retry з exponential backoff).

## 5. Критерії прийняття (Acceptance Criteria)

1. Сценарії спочатку працюють на статичних даних (зафіксовано окремим комітом), потім — на PostgreSQL + Drizzle ORM.
2. Відсутні N+1 запити при отриманні розкладу з лікарями.
3. Конкурентне або повторне бронювання не створює дублів (транзакції + ідемпотентність).
