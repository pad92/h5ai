# Developing h5ai

## Build

Building needs Node.js `22.22.2–22.x`, `24.15.0–24.x`, or `26.0.0+`, and npm.
From within the root folder run the following commands to find a fresh zipball
in folder `build` (tested on linux only, might work on other configurations):

~~~sh
> npm ci
> npm run build
~~~

Do **not** install any files from the `src` folder: they need to be
preprocessed to work correctly.

Prepare FFmpeg and php-rar with `make packages-prepare` first. To try a
build with sample media, `docker compose -f docker-compose.dev.yml up --build`
serves the test fixtures and the Markdown docs on <http://localhost:8888/>.
`test/docker/generate-fixtures.sh` recreates the fixtures.


## Tests

Run `npm test` for the JavaScript tests and `npm run test:php` (or
`make test-php`) for the PHP tests. The PHP suite runs with PHPUnit, which the
Makefile downloads once to `/tmp/phpunit.phar` and verifies against a pinned
checksum; `phpunit.xml.dist` defines the suite. It requires PHP 8.4+, the
`tar`, `du` and `cp` commands, and permission to start temporary HTTP servers
on `127.0.0.1`. Each test works in its own temporary folder and removes it.
Tests that need an optional PHP extension (GD, SQLite) are reported as skipped
when it is missing. `make test` runs both suites.


## Coverage

CI also measures line coverage. `npm run test:coverage` writes JavaScript
reports to `coverage/js/`, including source files the tests never load. The PHP
job runs PHPUnit with Xdebug over `src/_h5ai/private/php/`, untested files
included, and writes its report to `coverage/php/`. The PHP processes the tests
start (the API server, `Bootstrap::run()` behind a server, the CLI workers)
count too. `make coverage` produces both reports locally, in Docker when PHP has
no Xdebug. Both jobs upload Cobertura reports for GitLab diff annotations. The
`test:coverage` job combines covered and total line counts from both languages
into the percentage shown by the coverage badge, which a successful pipeline on
the default branch updates. That job, like `make coverage`, fails when the
percentage drops below 90%; set `COVERAGE_MIN` to use another floor.


## W3C validation

`make docker-w3c` builds the image and validates what it serves with the
[Nu Html Checker](https://validator.github.io/validator/), the engine behind
validator.w3.org, run locally from its Docker image: nothing is published or
sent to w3.org. `test/docker/test-w3c.sh` checks two things:

* what the server sends: the index page, a fallback listing (the page text
  browsers get), the info page and `styles.css`, fetched inside the h5ai
  container;
* what the browser ends up with: `test/docker/dump-dom.mjs` opens the
  listings, the image, Markdown and audio previews and the info page in
  headless Chromium and saves the DOM once the JavaScript has run. Chromium
  comes from Debian, in the same pinned Node image as the Dockerfile build
  stage, and shares the h5ai container's network.

Any error fails; notes such as the trailing slash on void elements are
printed only. A run takes about a minute, most of it installing Chromium.
`make docker-test` and the `test:docker` CI job run the same script, which
backs the W3C badges of the README. To check a new state of the interface,
add it to `PAGES` in `dump-dom.mjs`.


## Container tests

`make docker-test` and the `test:docker` CI job also run the download and
thumbnail scripts of `test/docker/`: `test-php-tar.sh`,
`test-document-thumbs.sh` and `test-media-thumbs.sh`. The media test is the
one that checks the image's own ffmpeg build. The scripts copy their fixtures
into the container and reach it by its IP, or by a random port on
`127.0.0.1` where the IP is not reachable (Docker Desktop). In CI the
container runs in the job's `docker:dind` service: `H5AI_TEST_BIND=0.0.0.0`
and `H5AI_TEST_HOST=docker` publish its port on the service and reach it
there.
To cover a new format, add a sample to `test/docker/fixtures/media/` and a
line to the cases of `test-media-thumbs.sh`.


## CI images

Branch and merge request pipelines build a single-platform image, and
pipelines on the default branch and tags an amd64 and arm64 candidate. Both
are pushed to the GitLab registry by digest, without a tag; the test and scan
jobs pull that digest, and the publish jobs promote the candidate once they
pass. GitLab.com deletes an untagged image that was never published after
24 hours.

Every Docker job drives its own Docker daemon, the job's `docker:dind`
service, which starts empty and disappears with the job. Branch builds keep
their BuildKit layer cache in the registry (`buildcache:branches`). Any
branch can write that cache, so default-branch and tag builds never read it
and build without a cache; FFmpeg and php-rar still come from the signed
packages below. Each Grype scan downloads its vulnerability database.

The `prepare:packages` job checks the project's Generic Package Registry on
every pipeline for two packages, `ffmpeg` and `php-rar`, each built from its
recipe in `ci/<package>.Dockerfile` by `scripts/native-package.sh`. A package
is keyed by the SHA-256 of its recipe and the archive format number
(`PACKAGE_FORMAT` in the script), with separate amd64 and arm64 files.
Changes to the source version, checksum, base image or compiler options
produce a new key; other edits to the script do not, so they never trigger a
rebuild. Bump `PACKAGE_FORMAT` when the archive
content or layout changes; that rebuilds both packages. The php-rar recipe
pins its own PHP base image: bump it together with the PHP version the main
Dockerfile requires. Bump the recipe when refreshing Alpine build
dependencies: package repository updates alone do not change the key.

A missing package is compiled. Default-branch and tag pipelines prepare and
publish both amd64 and arm64; branch and MR pipelines prepare the runner
architecture only. Branches and merge requests use the registry when possible
and otherwise pass their local build to the image job as a one-day artifact. Authentication
errors and registry outages fail the job. A redirect to package storage is
followed without the job token. Payloads are named by their checksum;
the checksum file is uploaded last and each upload is read back and verified.
The shared `docker-build` resource group serializes package publication.

Every job of the project, branch jobs included, gets a `CI_JOB_TOKEN` that
can write to the Generic Package Registry, and anyone can compute the package
key from the repository. Default-branch and tag pipelines, the only ones that
publish, therefore reuse a package only when it carries a valid signature:
`linux-<arch>.sha256.hmac` holds the HMAC-SHA256 of `<recipe> <arch> <checksum>`
keyed with the `FFMPEG_SIGNING_KEY` CI/CD variable, which signs both packages
(its name predates php-rar). The recipe is part of the signed message, so a
signature made for one package does not validate the other. They upload the
payload, then the signature, then the checksum file. When the signature is missing or
wrong, or the payload is missing or does not match its checksum, the job logs
a `WARNING`, compiles the package again and republishes it signed; a branch
can make a release slower but cannot make it fail. Branch and MR pipelines do
not receive the key: they reuse packages without checking signatures and
publish nothing. `openssl dgst` computes the HMAC.

Create the variable in Settings > CI/CD > Variables, with the 64 hexadecimal
characters printed by `openssl rand -hex 32`. Mark it Protected, so that only
protected branches and tags receive it, and Masked; also mark it Hidden when
GitLab offers the option. Release tags must match a protected tag rule. A
publishing pipeline without the key, or with a malformed one, fails before
compiling or uploading anything. After a key change, the next default-branch
or tag pipeline rejects every existing package once and rebuilds both
architectures.

The main Dockerfile copies the prepared files from `.ffmpeg/` and
`.php-rar/`, so neither is compiled again when a job's daemon starts empty.
The script checks a package's files before publishing it and after
downloading it. The existing image tests and Grype scan run against the
assembled image before image publication.

For local builds, `make docker-build` prepares both packages automatically and
caches them in `.ffmpeg/` and `.php-rar/`. Before using `docker buildx build`
or Compose directly, run `make packages-prepare`. For a multi-platform build,
prepare both platforms with `sh scripts/native-package.sh ffmpeg amd64 arm64`
and the same command for `php-rar`; the Docker builder must support both
platforms. Local preparation does not use the registry. Keep packages
for recipes used by supported releases when configuring registry cleanup.


## CI runner

The pipeline runs on the `chataigne` project runner (Docker executor). The
runner mounts no Docker socket into jobs: a job that reached the host's
daemon would be root on the host, and npm runs install scripts from
dependencies. Only the `docker:dind` service runs privileged:

```toml
[[runners]]
  [runners.docker]
    privileged = true
    allowed_privileged_services = ["docker:*-dind*"]
    allowed_privileged_images = ["no-privileged-job-image"]
    volumes = ["/certs/client", "/rpool/docker/gitlab-runner/cache:/cache"]
```

- `allowed_privileged_images` must name an image that no job uses. Without
  the list, every job image would run privileged.
- `/certs/client` shares the client certificates that the service generates
  with the job: the jobs talk to it over TLS on port 2376.
- Leave `FF_NETWORK_PER_BUILD` off. On a per-job network, the service's DNS
  is Docker's embedded resolver, which the containers it starts cannot use:
  they fall back to 8.8.8.8, which the local network blocks, and builds fail
  to resolve package mirrors. On the default bridge the service gets the
  host's resolvers. Other jobs on that bridge cannot drive the service
  without the client certificates of its job.
- The `gitlab-runner` container itself keeps its own Docker socket: it needs
  it to start the jobs.
- The runner's `volumes` also reach services. The service's `dockerd`
  listens on `/run/dind.sock`, so a host socket still mounted at
  `/var/run/docker.sock` does not stop it from starting.

Node jobs fail when they run with `CAP_SYS_ADMIN`, the capability a
privileged container has, and warn when they see a Docker socket. A
misconfigured service fails on its own: `docker:dind` does not start
without privileges, and the jobs do not reach it without the certificates.
A job declared in `.gitlab-ci.yml` can still request the service, so
whoever can push a branch keeps root access to the host through it.

Registering QEMU for arm64 changes the host kernel. `prepare:packages` and
`build:candidate` do it inside their `docker:dind` service and share the
`docker-build` resource group.


## Version

Git is the only place that holds the version: `package.json` has none. A
release is a tag `vX.Y.Z`, and `scripts/version.sh` gives the version every
build uses (gulp, the CI jobs, the Makefile):

* a tag pipeline, or a local clone whose `HEAD` carries a `vX.Y.Z` tag, gives
  the tag without its `v` (`1.6.0`), and the page shows `v1.6.0`;
* any other build gives its commit id (`1fd0cb1e`), shown as it is;
* the Docker build has no `.git`: it takes the `H5AI_VERSION` build argument,
  which wins over the two cases above when set;
* a build with none of these shows `dev`.

The version in the top bar opens `CHANGELOG.md`, which the build copies to
`_h5ai/CHANGELOG.md`. Before tagging, the new release needs its
`## vX.Y.Z` section there: the release job takes its notes from it.


## Docker image tags

Docker Hub protects tags matching `^v?[0-9]+\.[0-9]+\.[0-9]+(-[0-9]+)?$` from
changes. Stable releases update `latest` and the major/minor aliases only when
they are the newest stable Git tag. Prereleases keep their versioned tags and
leave stable aliases unchanged. The `devel` tag follows `master`.


## Screenshots

The README screenshots in `doc/screenshots/` are generated:

~~~sh
> make screenshots
~~~

The target builds the Docker image with the version of `HEAD` (see
[Version](#version); `H5AI_VERSION=1.6.0 make screenshots` sets it),
creates a sample share with `scripts/screenshots/demo-share.mjs` (drawn
landscapes, generated music and videos, documents and code), serves it on
`127.0.0.1:8891`, and shoots it with headless Chrome through
`scripts/screenshots/shoot.mjs`. The container and the sample share are removed
afterwards, even when a step fails. It needs Docker, Node.js, ffmpeg,
ImageMagick 7 (`magick`) and Chrome or Chromium; set `CHROME` to the browser
binary when it is not found on `PATH`, and `SCREENSHOT_PORT` when 8891 is taken.

The files get a fixed date, so the listings are the same from one run to the
next. To add a screenshot, add an entry to `SHOTS` in `shoot.mjs` and reference
the WebP file from the README.
