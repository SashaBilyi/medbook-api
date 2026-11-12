.PHONY: test test-unit test-integration test-e2e coverage mutation seed-load load profile db-analyze lighthouse

test:
	npm test

test-unit:
	npm run test:unit

test-integration:
	npm run test:integration

test-e2e:
	npm run test:e2e

coverage:
	npm run test:coverage

mutation:
	npm run mutation

seed-load:
	npm run db:seed:load

load:
	npm run load

profile:
	npm run profile

db-analyze:
	npm run db:analyze

lighthouse:
	npm run lighthouse
