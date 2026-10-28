# MedBook API

API для керування розкладом лікарів та записом пацієнтів на прийом. Побудовано з фокусом на строгі інженерні стандарти, якість коду та автоматизацію процесів.

## Технологічний стек

- **Runtime:** Node.js
- **Framework:** Fastify
- **Database:** PostgreSQL + Drizzle ORM
- **Quality Assurance:** ESLint, Prettier, Husky, lint-staged

## Запуск та розробка

Проєкт використовує вбудовані механізми сценаріїв Node.js (`package.json` scripts) для управління життєвим циклом та кросплатформної автоматизації.

### Доступні команди:

- `npm install` — встановлення залежностей та автоматична ініціалізація git-hooks (через скрипт `prepare`).
- `npm run lint` (або `node --run lint`) — перевірка коду лінтером (статичний аналіз).
- `npm run format` (або `node --run format`) — форматування коду за допомогою Prettier.
- `npm run build` (або `node --run build`) — компіляція та збірка TypeScript.
- `npm run test:smoke` (або `node --run test:smoke`) — запуск базових smoke-тестів (перевірка типів та валідності архітектури).

## Структура проєкту

- `/src` — вихідний код застосунку (розбитий на модулі: `users`, `appointments`, `schedules`).
- `/standards` — внутрішні стандарти якості проєкту (наприклад, Definition of Done).
- `/docs/adr` — Architectural Decision Records (документація ключових архітектурних рішень).
- `/ai` — збережені логи промптів та взаємодії з ШІ (для аудиту рішень).
