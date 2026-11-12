# MedBook API

API для керування розкладом лікарів та записом пацієнтів на прийом. Побудовано з фокусом на строгі інженерні стандарти, якість коду, продуктивність та модульну архітектуру з Dependency Injection.

## Технологічний стек

- **Runtime:** Node.js (TypeScript, ESM)
- **Framework:** Fastify 5
- **Database:** PostgreSQL 16 + Drizzle ORM
- **Domain Library (DI):** `@medbook/booking-core` (`packages/booking-core`, нуль інфраструктурних залежностей)
- **Performance & QA:** autocannon, Node.js V8 `--cpu-prof`, Google Lighthouse, Vitest, Stryker, ESLint, Prettier, Husky

## Запуск та розробка

### Доступні команди:

- `npm install` — встановлення залежностей, лінкування workspace `@medbook/booking-core` та ініціалізація git-hooks.
- `npm run lint` — статичний аналіз `src/` та `packages/booking-core/src/` (включно з контролем меж DI).
- `npm run format` / `npm run format:check` — форматування коду Prettier.
- `npm run build` — збірка `@medbook/booking-core` (`.js` + `.d.ts`) та компіляція `medbook-api`.
- `npm test` / `make test` — запуск Unit (включно з ізольованими тестами бібліотеки без БД), Integration та E2E тестів.
- `npm run db:seed:load` / `make seed-load` — наповнення БД реалістичним датасетом (`100` лікарів, `25 000` слотів, `15 000` записів).
- `npm run load` / `make load` — відтворюваний навантажувальний прогін (4 сценарії × 5 повторів, `p50/p95/p99`, розкид, RAM, `/version`).
- `npm run profile` / `make profile` — V8 CPU-профілювання (CPU vs Wait), телеметрія Event Loop/RAM та аналіз БД (`EXPLAIN ANALYZE`, індекси, кількість рядків).
- `npm run lighthouse` / `make lighthouse` — аудит фронтенд-сторінки `GET /ui` через Google Lighthouse та Web Vitals.

## Структура проєкту

- `/packages/booking-core` — винесена доменна бібліотека розкладу й бронювань із чистим DI та типізованим публічним контрактом TS.
- `/src` — HTTP-маршрути (`api/`, включно з `GET /ui` та `GET /version`), PostgreSQL/Drizzle адаптери (`adapters/`), Composition Root (`container.ts`), міграції БД (`db/`).
- `/scripts` — відтворювані скрипти наповнення БД, навантаження, V8-профілювання, `EXPLAIN ANALYZE` та Lighthouse.
- `/standards` — внутрішні стандарти якості проєкту (`DoD.md`).
- `/docs/adr` — Architectural Decision Records (MADR, `0001`–`0005`).
- `/ai` — аудит залучення ШІ та перевірки рішень.
