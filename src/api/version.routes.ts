import type { FastifyInstance } from 'fastify';

export async function versionRoutes(app: FastifyInstance) {
  app.get('/version', async () => {
    const commitSha =
      process.env.COMMIT_SHA ??
      process.env.RENDER_GIT_COMMIT ??
      process.env.RAILWAY_GIT_COMMIT_SHA ??
      process.env.GITHUB_SHA ??
      'local-dev';

    return {
      service: 'medbook-api',
      version: '1.0.0',
      commitSha,
      environment: process.env.NODE_ENV ?? 'development',
    };
  });
}
