# Sourced by the container tests. They run the same way on a developer host
# and in CI, where jobs drive the host's Docker through its socket: there a
# bind mount would resolve against the host instead of the job container, and
# a published port would be on the host, not on the job's localhost. So the
# fixtures are copied into the container, and requests go to its IP, or to a
# random local port where the IP is not reachable (Docker Desktop).

# start_h5ai CONTAINER IMAGE FIXTURE_DIR
# Starts IMAGE serving a copy of FIXTURE_DIR as /share, waits until it answers
# and sets $base to its URL. The caller removes CONTAINER.
start_h5ai() {
	docker create --name "$1" -p 127.0.0.1::80 "$2" >/dev/null
	docker cp "$3/." "$1:/share"
	docker start "$1" >/dev/null
	ip=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$1")
	port=$(docker port "$1" 80/tcp | sed -n '1s/.*://p')
	for _ in $(seq 1 20); do
		for url in "http://$ip" "http://127.0.0.1:$port"; do
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
