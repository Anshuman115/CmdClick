.PHONY: build test test-verbose package install debug-parse coverage coverage-fixtures clean

build:
	npx tsc

test:
	npx vitest run src

test-verbose:
	npx vitest run src --reporter=verbose

VERSION := $(shell node -p "require('./package.json').version")
NAME    := $(shell node -p "require('./package.json').name")

package: build
	npx vsce package --allow-missing-repository

install: package
	code --install-extension $(NAME)-$(VERSION).vsix

debug-parse: build
	@echo "Usage: make debug-parse FILE=path/to/file.service.js"
	node dist/main.js --debug-parse $(FILE)

coverage: build
	@echo "Usage: make coverage ROOT=path/to/moleculer/repo"
	node dist/main.js --coverage $(ROOT)

coverage-fixtures: build
	node dist/main.js --coverage test/fixtures

clean:
	rm -rf dist *.vsix
