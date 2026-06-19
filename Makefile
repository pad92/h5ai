.PHONY: all install build lint test clean clean-all zip scan

all: build

node_modules: package.json package-lock.json
	npm install
	touch node_modules

install: node_modules

build: node_modules
	npm run build

lint: node_modules
	npm run lint

test: node_modules
	npm run test

clean:
	npx gulp clean

clean-all: clean
	rm -rf node_modules

scan:
	trivy fs --exit-code 1 --severity HIGH,CRITICAL --ignore-unfixed --skip-dirs .npm_cache,node_modules,build .

