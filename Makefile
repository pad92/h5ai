IMAGE_NAME ?= h5ai-local
TAG ?= latest
TEST_HOST ?= localhost
TEST_RETRIES ?= 15
TEST_CONTAINERS = h5ai-test-noauth h5ai-test-auth h5ai-test-admin-pass h5ai-test-admin-preserve h5ai-test-admin-readonly h5ai-test-options h5ai-test-health h5ai-test-realip

TEST_IMAGE = $(IMAGE_NAME):$(TAG)
TEST_URL = http://$(TEST_HOST):8890/
TEST_RUN = docker run -d -p 8890:80 -v $(CURDIR):/share:ro
OPTIONS_JSON = /usr/share/h5ai/_h5ai/private/conf/options.json

# Scanners pinned by digest, kept in sync with .gitlab-ci.yml.
GRYPE_IMAGE = anchore/grype:v0.116.0@sha256:fd4ab4d1042b522c896e73bdf09ab8bf384fa417df99d6dd0d6e1008c7e7c821
SYFT_IMAGE = anchore/syft:v1.49.0@sha256:13b53ebabe3d215268c90cf8fb9b875f0183908245f376fd4b3a2cb69d21d484

.PHONY: help all install build lint test clean clean-all scan docker-build docker-test docker-grype docker-clean

.DEFAULT_GOAL := help

help:
	@echo "Application targets:"
	@echo "  all           Lint, test and build the application"
	@echo "  install       Install Node.js dependencies"
	@echo "  build         Build h5ai application (creates build/h5ai-*.zip)"
	@echo "  lint          Run linters"
	@echo "  test          Run application tests"
	@echo "  clean         Clean build output"
	@echo "  clean-all     Clean build output, node_modules and Docker artifacts"
	@echo "  scan          Scan npm dependencies with Syft + Grype"
	@echo ""
	@echo "Docker image targets (image: $(TEST_IMAGE)):"
	@echo "  docker-build  Build the Docker image"
	@echo "  docker-test   Build the image and run the container test suite"
	@echo "  docker-grype  Build the image and scan it with Grype"
	@echo "  docker-clean  Remove test containers and the built image"

all: lint test build

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

clean-all: clean docker-clean
	rm -rf node_modules

# Mirrors scan:grype:deps. Grype's own directory scan skips lockfile entries
# marked "dev": true, so the SBOM is produced by Syft with dev dependencies
# enabled and Grype matches that instead.
scan:
	docker run --rm -e SYFT_JAVASCRIPT_INCLUDE_DEV_DEPENDENCIES=true \
		-v $(CURDIR):/src:ro $(SYFT_IMAGE) dir:/src \
		--exclude './node_modules/**' --exclude './build/**' --exclude './.npm/**' \
		-o syft-json > npm-sbom.json
	docker run --rm -v $(CURDIR):/w:ro $(GRYPE_IMAGE) \
		sbom:/w/npm-sbom.json --only-fixed --fail-on high

# Poll $(TEST_URL) until the response matches; on failure remove the container.
# $(1) extra curl args (e.g. -u user:pass), $(2) expected status line,
# $(3) success message, $(4) failure message, $(5) container to clean up.
define wait_for_http
	@SUCCESS=false; \
	for i in $$(seq 1 $(TEST_RETRIES)); do \
		if curl -s -I $(1) $(TEST_URL) | grep -q "$(2)"; then \
			SUCCESS=true; \
			break; \
		fi; \
		sleep 1; \
	done; \
	if [ "$$SUCCESS" = "true" ]; then \
		echo "$(3)"; \
	else \
		echo "$(4)"; \
		docker rm -f $(5); \
		exit 1; \
	fi
endef

# Shell helper: assert_passhash <password> <ok-msg> <fail-msg> <container>
# Reads an options.json on stdin and verifies its passhash with PHP.
define assert_passhash
	assert_passhash() { \
		if docker exec -i "$$4" php84 -r '$$options = json_decode(stream_get_contents(STDIN), true); exit(is_array($$options) && password_verify($$argv[1], $$options["passhash"] ?? "") ? 0 : 1);' "$$1"; then \
			echo "PASS: $$2"; \
		else \
			echo "FAIL: $$3"; \
			docker rm -f "$$4"; \
			exit 1; \
		fi; \
	}
endef

docker-build:
	docker buildx build --load --tag $(TEST_IMAGE) \
		--build-arg H5AI_VERSION=$$(sed -n 's/.*"version":[[:space:]]*"\([^"]*\)".*/\1/p' package.json | head -n1) \
		--build-arg BUILD_DATE=$$(date -u +%Y-%m-%dT%H:%M:%SZ) \
		--build-arg BUILD_VCSREF=$$(git rev-parse --short HEAD) \
		.

docker-grype: docker-build
	docker run --rm \
		-v /var/run/docker.sock:/var/run/docker.sock \
		-v $(HOME)/.cache/grype:/tmp/grype \
		-e GRYPE_DB_CACHE_DIR=/tmp/grype \
		$(GRYPE_IMAGE) docker:$(TEST_IMAGE) --only-fixed --fail-on high

docker-test: docker-build
	@echo "Testing container without authentication..."
	$(TEST_RUN) --name h5ai-test-noauth $(TEST_IMAGE)
	$(call wait_for_http,,HTTP/1.1 200 OK,✓ Public index page returned 200 OK,✗ Public index page test failed,h5ai-test-noauth)
	@docker exec h5ai-test-noauth cat $(OPTIONS_JSON) | grep -qE '"passhash":[[:space:]]*""' || { echo "FAIL: empty passhash should remain empty when no password is configured"; docker rm -f h5ai-test-noauth; exit 1; }
	@if docker logs h5ai-test-noauth 2>&1 | grep -q "Generated random h5ai administration password"; then echo "FAIL: startup must not generate or log an admin password"; docker rm -f h5ai-test-noauth; exit 1; fi
	docker rm -f h5ai-test-noauth

	@echo "Testing container with basic authentication..."
	$(TEST_RUN) --name h5ai-test-auth -e ENV_U=admin -e ENV_P=secret $(TEST_IMAGE)
	$(call wait_for_http,,HTTP/1.1 401 Unauthorized,✓ Unauthenticated request correctly blocked (401 Unauthorized),✗ Unauthenticated request test failed (did not return 401),h5ai-test-auth)
	$(call wait_for_http,-u admin:secret,HTTP/1.1 200 OK,✓ Authenticated request successfully bypassed basic auth,✗ Authenticated request test failed (rejected credentials),h5ai-test-auth)
	docker rm -f h5ai-test-auth

	@echo "Testing container with h5ai administration password..."
	$(TEST_RUN) --name h5ai-test-admin-pass -e H5AI_ADMIN_PASSWORD=myadminpassword $(TEST_IMAGE)
	$(call wait_for_http,,HTTP/1.1 200 OK,✓ Container ready,✗ Container failed to start,h5ai-test-admin-pass)
	@$(assert_passhash); \
	docker exec h5ai-test-admin-pass cat $(OPTIONS_JSON) \
		| assert_passhash "myadminpassword" "h5ai admin password successfully updated in options.json" "h5ai admin password test failed" h5ai-test-admin-pass
	@if docker logs h5ai-test-admin-pass 2>&1 | grep -Fq "myadminpassword"; then echo "FAIL: admin password appeared in container logs"; docker rm -f h5ai-test-admin-pass; exit 1; fi
	docker rm -f h5ai-test-admin-pass

	@echo "Testing that a configured admin hash survives startup without an override..."
	docker run --rm --entrypoint cat $(TEST_IMAGE) $(OPTIONS_JSON) > /tmp/h5ai-admin-options.json
	docker run --rm --entrypoint php84 $(TEST_IMAGE) -r 'echo password_hash("configuredadminpassword", PASSWORD_DEFAULT);' > /tmp/h5ai-admin-options-hash
	@sed -E "s|(\"passhash\":[[:space:]]*\")[^\"]*(\")|\1$$(cat /tmp/h5ai-admin-options-hash)\2|" /tmp/h5ai-admin-options.json > /tmp/h5ai-admin-options-configured.json
	$(TEST_RUN) --name h5ai-test-admin-preserve -v /tmp/h5ai-admin-options-configured.json:$(OPTIONS_JSON) $(TEST_IMAGE)
	$(call wait_for_http,,HTTP/1.1 200 OK,✓ Container ready,✗ Container failed to start,h5ai-test-admin-preserve)
	@$(assert_passhash); docker exec h5ai-test-admin-preserve cat $(OPTIONS_JSON) | assert_passhash "configuredadminpassword" "Existing configured hash still authenticates" "Existing admin hash was not preserved" h5ai-test-admin-preserve
	@docker exec h5ai-test-admin-preserve cat $(OPTIONS_JSON) > /tmp/h5ai-admin-options-current.json
	@expected_hash=$$(cat /tmp/h5ai-admin-options-hash); actual_hash=$$(grep -oE '"passhash":[[:space:]]*"[^\"]*"' /tmp/h5ai-admin-options-current.json | cut -d'"' -f4); \
	if [ "$$actual_hash" != "$$expected_hash" ]; then echo "FAIL: existing passhash changed during startup"; docker rm -f h5ai-test-admin-preserve; exit 1; fi
	@if docker logs h5ai-test-admin-preserve 2>&1 | grep -q "Generated random h5ai administration password"; then echo "FAIL: startup must not generate or log an admin password"; docker rm -f h5ai-test-admin-preserve; exit 1; fi
	docker rm -f h5ai-test-admin-preserve
	$(TEST_RUN) --name h5ai-test-admin-readonly -v /tmp/h5ai-admin-options-configured.json:$(OPTIONS_JSON):ro $(TEST_IMAGE)
	$(call wait_for_http,,HTTP/1.1 200 OK,✓ Container ready,✗ Container failed to start,h5ai-test-admin-readonly)
	@$(assert_passhash); docker exec h5ai-test-admin-readonly cat $(OPTIONS_JSON) | assert_passhash "configuredadminpassword" "Read-only options.json keeps its configured hash" "Read-only admin hash was not preserved" h5ai-test-admin-readonly
	docker rm -f h5ai-test-admin-readonly
	@docker run -d --name h5ai-test-admin-readonly-override -v /tmp/h5ai-admin-options-configured.json:$(OPTIONS_JSON):ro -e H5AI_ADMIN_PASSWORD=overridepassword $(TEST_IMAGE)
	@sleep 2; if docker logs h5ai-test-admin-readonly-override 2>&1 | grep -Fq "is not writable"; then echo "PASS: explicit password override fails on read-only options.json"; else echo "FAIL: read-only password override error was not reported"; docker logs h5ai-test-admin-readonly-override; docker rm -f h5ai-test-admin-readonly-override; exit 1; fi
	docker rm -f h5ai-test-admin-readonly-override
	rm -f /tmp/h5ai-admin-options.json /tmp/h5ai-admin-options-hash /tmp/h5ai-admin-options-configured.json /tmp/h5ai-admin-options-current.json

	@echo "Testing container with a bind-mounted custom options.json..."
	docker run --rm --entrypoint cat $(TEST_IMAGE) $(OPTIONS_JSON) > /tmp/h5ai-test-options.json
	$(TEST_RUN) --name h5ai-test-options -e H5AI_ADMIN_PASSWORD=myadminpassword \
		-v /tmp/h5ai-test-options.json:$(OPTIONS_JSON) $(TEST_IMAGE)
	$(call wait_for_http,,HTTP/1.1 200 OK,✓ Container ready with bind-mounted options.json,✗ Container failed to start with bind-mounted options.json,h5ai-test-options)
	@$(assert_passhash); \
	assert_passhash "myadminpassword" "passhash updated in the bind-mounted options.json" "Bind-mounted options.json test failed" h5ai-test-options \
		< /tmp/h5ai-test-options.json
	docker rm -f h5ai-test-options
	rm -f /tmp/h5ai-test-options.json

	@echo "Testing container health check with basic authentication enabled..."
	$(TEST_RUN) --name h5ai-test-health -e ENV_U=admin -e ENV_P=secret \
		--health-interval=2s --health-timeout=5s --health-retries=3 --health-start-period=2s $(TEST_IMAGE)
	@SUCCESS=false; \
	for i in $$(seq 1 $(TEST_RETRIES)); do \
		if curl -s -I $(TEST_URL)healthz | grep -q "HTTP/1.1 200 OK"; then SUCCESS=true; break; fi; \
		sleep 1; \
	done; \
	if [ "$$SUCCESS" = "true" ]; then \
		echo "✓ Unauthenticated health endpoint returned 200 despite basic auth"; \
	else \
		echo "✗ Health endpoint test failed"; \
		docker rm -f h5ai-test-health; \
		exit 1; \
	fi
	@SUCCESS=false; \
	for i in $$(seq 1 $(TEST_RETRIES)); do \
		status=$$(docker inspect --format '{{.State.Health.Status}}' h5ai-test-health 2>/dev/null); \
		if [ "$$status" = "healthy" ]; then SUCCESS=true; break; fi; \
		sleep 2; \
	done; \
	if [ "$$SUCCESS" = "true" ]; then \
		echo "✓ Container reports healthy despite basic auth returning 401"; \
	else \
		echo "✗ Health check test failed (last status: $$status)"; \
		docker rm -f h5ai-test-health; \
		exit 1; \
	fi
	docker rm -f h5ai-test-health

	@echo "Testing container with real_ip (trusted proxy) configuration..."
	$(TEST_RUN) --name h5ai-test-realip -e REAL_IP_FROM="10.0.0.0/8, 192.168.0.0/16" $(TEST_IMAGE)
	$(call wait_for_http,,HTTP/1.1 200 OK,✓ Container ready,✗ Container failed to start,h5ai-test-realip)
	@realip_conf=$$(docker exec h5ai-test-realip cat /etc/angie/conf.d/real_ip.conf 2>/dev/null); \
	if echo "$$realip_conf" | grep -q "set_real_ip_from 10.0.0.0/8;" \
		&& echo "$$realip_conf" | grep -q "set_real_ip_from 192.168.0.0/16;" \
		&& echo "$$realip_conf" | grep -q "real_ip_header X-Forwarded-For;"; then \
		echo "✓ real_ip configuration correctly generated from REAL_IP_FROM"; \
	else \
		echo "✗ real_ip configuration test failed. Got:"; echo "$$realip_conf"; \
		docker rm -f h5ai-test-realip; \
		exit 1; \
	fi
	docker rm -f h5ai-test-realip

	@echo "All tests passed successfully!"

docker-clean:
	docker rm -f $(TEST_CONTAINERS) 2>/dev/null || true
	docker rmi $(TEST_IMAGE) 2>/dev/null || true
	rm -f /tmp/h5ai-test-options.json
