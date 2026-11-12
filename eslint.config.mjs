import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': 'warn',
    },
  },
  {
    files: ['packages/booking-core/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['drizzle-orm', 'drizzle-orm/*', 'postgres', 'fastify', 'fastify/*'],
              message:
                '@medbook/booking-core must remain infrastructure-agnostic and never import DB/ORM/HTTP implementations.',
            },
            {
              group: ['../../*', '../../../*'],
              message: '@medbook/booking-core must never import modules outside its package root.',
            },
          ],
        },
      ],
    },
  },
);
