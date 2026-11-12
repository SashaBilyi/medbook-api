# ADR 0005: Межі винесеного модуля `@medbook/booking-core`, дизайн DI та захист боттлнеків

## Контекст і проблема

Під час навантажувального тестування та профілювання реально запущеної системи **MedBook API** (Node.js v24.11.1 + Fastify 5 + PostgreSQL 16 у Docker, реалістичний датасет: `100` лікарів, `25 000` слотів розкладу, `15 000` бронювань) було зафіксовано критичну деградацію продуктивності:

1. **Насичення CPU головного потоку Node.js на необмежених вибірках:**
   - `GET /api/schedules`: `3.84 RPS`, `p50 = 2093.02 ms`, `p95 = 3328.25 ms`, `p99 = 3631.21 ms`.
   - `GET /api/appointments`: `6.10 RPS`, `p50 = 1386.69 ms`, `p95 = 2429.17 ms`, `p99 = 2540.21 ms`.
   - `mixed-clinic`: `4.05 RPS`, `p95 = 3897.07 ms`, `p99 = 4174.86 ms`.
   - За даними V8 `--cpu-prof`: `92.27%` часу — активний JS CPU (`serialize` 35.17%, Drizzle ORM mapping ~13.6%, розбір `DataRow` драйвера `postgres` ~15.5%), `4.24%` — GC, і лише `2.91%` — `(idle)`. Event Loop Utilization досягав `98.57%–99.70%`, Event Loop Delay `p99 = 1240.47 ms`, а пікове споживання RAM зростало у 10 разів (`49.45 MB → 509.61 MB RSS`, `HeapUsed 5.02 MB → 328.89 MB`).
2. **Каскадна деградація фронтенду (`GET /ui`):**
   - Lighthouse Performance = `22/100`, `LCP = 34.3 s`, `TBT = 960 ms`, `CLS = 0.764`, загальний розмір трафіку `6 278 KiB` (через завантаження 25 000 слотів і 15 000 записів без пагінації).
3. **Відсутність індексів під фільтрацію та жорстка зв’язність доменного шару з інфраструктурою:**
   - Запит `appointments WHERE status = 'confirmed' ORDER BY created_at DESC LIMIT 50` виконував `Seq Scan` (`226` буферів, `5 000` відфільтрованих рядків, `3.952 ms`).
   - Старі сервіси `src/services/schedules.service.ts` та `src/services/appointments.service.ts` напряму імпортували глобальний синглтон `db` ([src/db/index.ts](../../src/db/index.ts)), схему Drizzle і `withRetry`. Це унеможливлювало:
     - централізований захист меж пагінації на рівні домену;
     - підміну реалізації сховища / додавання оптимізацій читання (lock-free preflight) без переписування бізнес-логіки;
     - ізольоване unit-тестування доменних правил без піднятої PostgreSQL.

За сукупністю виміряних даних **найвразливішим модулем** визначено домен розкладу та бронювань (Scheduling & Appointments), оскільки саме його вибірки й транзакційні інваріанти (`schedules.is_booked` ↔ `appointments`) створювали >90% навантаження на CPU/RAM та визначали конкуренцію записів.

---

## Межі винесеного модуля (`@medbook/booking-core`)

### Що належить ядру бібліотеки (`packages/booking-core/`):

- **Доменні сутності та публічні DTO** (`ScheduleRecord`, `ScheduleWithDoctor`, `AppointmentRecord`, `BookSlotInput`, `BookSlotResult`, `ScheduleQueryInput`, `AppointmentQueryInput`, `PaginationBounds`).
- **Доменна валідація та захист меж (Guardrails):** обов’язкова нормалізація `limit` / `offset` із жорсткими межами (`defaultLimit = 50`, `maxLimit = 200`), що архітектурно унеможливлює unbounded-дампи таблиць.
- **Бізнес-правила бронювання та скасування:** ідемпотентний replay (включно з відновленням після конкурентного конфлікту `UniqueIdempotencyConflictError`), захист від подвійного бронювання (`SlotAlreadyBookedError`), захист перезаброньованого слоту при повторному скасуванні старого запису.
- **Типізовані доменні помилки** (`BookingDomainError` та підкласи без прив’язки до Fastify/HTTP-відповідей).
- **Інтерфейси-порти (Ports):** `ScheduleReadPort`, `AppointmentReadPort`, `TransactionRunnerPort`, `BookingTransactionScope`, `RetryPolicyPort`, `BookingLoggerPort`.

### Що залишається поза бібліотекою (у `medbook-api/src/`):

- Конкретні SQL/Drizzle запити, пул з’єднань `postgres`, мапінг SQLSTATE `23505` → `UniqueIdempotencyConflictError` ([src/adapters/drizzle-booking.adapter.ts](../../src/adapters/drizzle-booking.adapter.ts)).
- Composition Root — збірка залежностей і передача їх у фабрику `createBookingModule(deps)` ([src/container.ts](../../src/container.ts)).
- HTTP-маршрути Fastify, JSON-схеми (`fast-json-stringify`), обробка HTTP-заголовків (`Idempotency-Key`, `X-Limit`, `X-Offset`) та HTML-інтерфейс UI.

---

## Розглянуті варіанти

### 1. Спосіб відокремлення модуля

- **Варіант 1А:** Внутрішня підпапка `src/modules/booking/` без власного `package.json`.
  - _Недоліки:_ немає явного публічного контракту пакета (`.d.ts`, `exports`), легко випадково імпортувати `src/db/*` або `drizzle-orm`, не можна перевикористати чи опублікувати як незалежну бібліотеку.
- **Варіант 1Б (Обрано):** Окремий пакет `packages/booking-core` (`@medbook/booking-core`) через **npm workspaces** із власним `package.json` (`"dependencies": {}`), власним `tsconfig.json` (`strict: true`, `declaration: true`, `noUncheckedIndexedAccess: true`) та експортом скомпільованих `dist/index.js` + `dist/index.d.ts`.

### 2. Дизайн Dependency Injection

- **Варіант 2А:** IoC-контейнер на декораторах (`tsyringe` або `inversify` + `reflect-metadata`).
  - _Недоліки:_ додає runtime-залежності у базову бібліотеку, потребує експериментальних декораторів TypeScript, переносить помилки відсутніх залежностей із compile-time у runtime.
- **Варіант 2Б (Обрано):** Чистий **Factory / Constructor DI** (`createBookingModule(deps: BookingModuleDependencies): BookingModule`) із явними інтерфейсами-портами та **Composition Root** у [src/container.ts](../../src/container.ts).
  - _Переваги:_ 0 runtime-залежностей, 100% перевірка повноти залежностей на етапі компіляції TypeScript, тривіальна підміна адаптерів (PostgreSQL/Drizzle у проді, In-Memory у unit-тестах).

### 3. Оптимізація гарячого шляху конкурентного бронювання (`booking-contention`)

- **Проміжний варіант:** окрема перевірка `findByIdempotencyKey` перед транзакцією + повторні перевірки всередині транзакції.
  - _Результат вимірювання:_ створив **4 SQL round-trips** на шляху `409 Conflict` і спричинив реальну регресію з `664.74 RPS` до `449.50 RPS`.
- **Фінальне рішення (Обрано):** опційний метод DI-порту `AppointmentReadPort.preflightBooking(scheduleId, idempotencyKey)`, реалізований в адаптері PostgreSQL як **один lock-free MVCC-запит** (дві скалярні підзапити по PK/Unique індексах у межах єдиного знімку). Якщо запит є replay (`200`), неіснуючим слотом (`404`) або вже зайнятим слотом (`409`), відповідь повертається за **1 round-trip без `BEGIN` і без `SELECT ... FOR UPDATE`**. Запис вільного слоту, як і раніше, виконується через повну ACID-транзакцію із `FOR UPDATE`.
  - _Результат вимірювання:_ `booking-contention` прискорився з `664.74 RPS` до **`1652.34 RPS`** (`+2.49×`), `p95` знизився з `34.36 ms` до **`13.85 ms`**.

---

## Прийняті рішення

1. Винести ядро розкладу та бронювань у локальну бібліотеку `@medbook/booking-core` ([packages/booking-core/package.json](../../packages/booking-core/package.json)) із `"dependencies": {}` та суворим публічним TS-контрактом (`dist/index.d.ts`).
2. Механічно зафіксувати інверсію залежностей (DIP) у [eslint.config.mjs](../../eslint.config.mjs) правилом `no-restricted-imports` для `packages/booking-core/src/**/*.ts` (заборона `drizzle-orm`, `postgres`, `fastify` та виходу за межі пакета).
3. Підключити бібліотеку через адаптер [src/adapters/drizzle-booking.adapter.ts](../../src/adapters/drizzle-booking.adapter.ts) і Composition Root [src/container.ts](../../src/container.ts), дозволивши також ін’єкцію `bookingModule` у `buildApp({ bookingModule })`.
4. Захистити виявлені боттлнеки:
   - примусова пагінація (`defaultLimit=50`, `maxLimit=200`) + фільтрація (`doctorId`, `availableOnly`, `status`);
   - скомпільовані схеми відповідей Fastify (`fast-json-stringify`);
   - zero-downtime індекси (`idx_schedules_doctor_available_slot_time`, `idx_appointments_status_created_at`) у [src/db/migrate-indexes.ts](../../src/db/migrate-indexes.ts);
   - lock-free `preflightBooking` та обробка `23505` у DI-адаптері;
   - оптимізація `GET /ui` (пагіновані запити по 20 слотів, inline critical CSS, `defer` JS + `Cache-Control`, фіксовані висоти для усунення CLS, WCAG AA контраст і семантика).
5. Відображати версію винесеного модуля `@medbook/booking-core` у відповіді `GET /version` (`/api/version`).

---

## Наслідки

### Позитивні

- **Масштабний приріст продуктивності:** `read-schedules` (`3.84 → 962.14 RPS`, `p95: 3328 → 13.21 ms`), `read-appointments` (`6.10 → 997.57 RPS`, `p95: 2429 → 12.82 ms`), `mixed-clinic` (`4.05 → 844.63 RPS`, `p95: 3897 → 36.01 ms`), `booking-contention` (`664.74 → 1652.34 RPS`, `p95: 34.36 → 13.85 ms`).
- **Стабілізація Event Loop і пам’яті:** Event Loop Delay `p99` знизився з `1240.47 ms` до `14.02 ms`, піковий RSS — із `509.61 MB` до `246.59 MB`, піковий HeapUsed — із `328.89 MB` до `117.04 MB`.
- **Чистий DI та швидке тестування:** усі 5 unit-тестів бібліотеки виконуються за ~20 ms без PostgreSQL на in-memory адаптерах; підключення реального PostgreSQL не вимагає жодних змін у ядрі.
- **Фронтенд Lighthouse:** Performance `22 → 99`, Accessibility `83 → 100`, Best Practices `96 → 100`, SEO `90 → 100`, `LCP: 34.3 s → 723 ms`, `CLS: 0.764 → 0.005`.

### Компроміси та обмеження

- Клієнти, яким потрібно вивантажити більше 50 записів за раз, тепер мають явно передавати `?limit=&offset=` (до `maxLimit = 200`), що є компромісом для захисту сервера від OOM і CPU starvation.
- Додавання нового workspace-пакета вимагає двокрокової збірки (`npm run build --workspace=@medbook/booking-core && tsc`), що автоматизовано у кореневих скриптах `build` та `test:smoke`.
