.PHONY: setup lint format build test-smoke

setup:
	npm install
	npx husky init

lint:
	npx eslint "src/**/*.ts"

format:
	npx prettier --write "src/**/*.ts" "*.md"

build:
	npx tsc

test-smoke:
	@echo "Running minimal smoke test..."
	npx tsc --noEmit
	@echo "Smoke test passed. Architecture and types are valid."