.PHONY: test test-unit test-integration test-e2e coverage mutation

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