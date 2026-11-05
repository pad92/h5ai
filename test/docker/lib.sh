# Sourced by the container tests. They run the same way on a developer host
# and in CI, where jobs drive the Docker daemon of their docker:dind service:
# there a bind mount would resolve inside that daemon instead of the job
# container, and a published port is on the service, not on the job's
# localhost. So the fixtures are copied into the container, and requests go
# to its IP, or to its port published on H5AI_TEST_BIND and reached at
# H5AI_TEST_HOST (127.0.0.1 for both by default; Docker Desktop, where the IP
# is not reachable, uses the default).

# start_h5ai CONTAINER IMAGE FIXTURE_DIR
# Starts IMAGE serving a copy of FIXTURE_DIR as /share, waits until it answers
# and sets $base to its URL. The caller removes CONTAINER.
start_h5ai() {
	docker create --name "$1" -p "${H5AI_TEST_BIND:-127.0.0.1}::80" "$2" >/dev/null
	docker cp "$3/." "$1:/share"
	docker start "$1" >/dev/null
	ip=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$1")
	port=$(docker port "$1" 80/tcp | sed -n '1s/.*://p')
	for _ in $(seq 1 20); do
		for url in "http://${H5AI_TEST_HOST:-127.0.0.1}:$port" "http://$ip"; do
			if curl -fsSI --max-time 2 "$url/" >/dev/null 2>&1; then
				base=$url
				return 0
			fi
		done
		sleep 1
	done
	echo "FAIL: test container $1 did not become ready" >&2
	docker logs "$1" >&2
	return 1
}
