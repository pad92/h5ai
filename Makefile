.PHONY: install build test lint clean help

help:
	@echo "Available commands:"
	@echo "  make install  - Install npm dependencies"
	@echo "  make build    - Build h5ai using gulp"
	@echo "  make test     - Run the test suite"
	@echo "  make lint     - Run ESLint"
	@echo "  make clean    - Clean the build directory"

node_modules: package.json package-lock.json
	npm install
	touch node_modules

install: node_modules

build: node_modules
	npm run build

test: node_modules
	npm run test

lint: node_modules
	npm run lint

clean:
	npx gulp clean
