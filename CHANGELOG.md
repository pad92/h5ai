# Changelog

## v1.3.3 - *2026-08-18*

* **Bounded the `du` call behind folder sizes**: `Filesize::exec()` ran `du -bL` through a plain `exec()` with no execution limit. It was the last child-process call left unguarded after the archive and thumbnail helpers were hardened in v1.3.0, so on slow storage a single `du` pass could run for as long as it liked. Search results and fallback listings compute folder sizes inline, so that also stalled real requests, not just the background cache warmer. The call now goes through the existing bounded `Util::proc_open_cmdv()` helper, which terminates the child once the timeout expires and force-kills it if it ignores the signal. Output from an aborted pass is dropped instead of parsed, because half a `du` listing would persist a wrong, too-small size in `foldersizes.json`.
* **New `foldersize.timeout` and `foldersize.backgroundTimeout` options** (capped at `3600` seconds each). Requests get `50` seconds, which stays under the `request_terminate_timeout` of the Docker image's PHP-FPM pool so h5ai keeps the size already in the cache instead of losing the worker mid-write. CLI cache warming and refreshing get `900` seconds, since no pool limit applies there and cutting a large tree short would leave it permanently uncached. If your share needs longer than 900 seconds for a full `du` pass, raise `backgroundTimeout`.
* **Docker/php-fpm reliability**: the `www` pool had no `request_terminate_timeout`, so workers left behind by a slow request piled up until the pool was starved. They are now recycled after 60s, and a `slow.log` (forwarded to stderr like `error.log`) records any request past 10s. Note that neither mechanism can reclaim a worker blocked on a mount that has hung outright: the kernel keeps it in uninterruptible I/O, the signal stays pending, and no stack trace can be written. That case has to be fixed at the mount.
* **Documentation**: `foldersize.enabled` was still documented as defaulting to `false`. It has defaulted to `true` since v1.3.1.
* **Dependencies**: bumps `brace-expansion`, `undici`, `nanoid`, `fast-uri`, `js-yaml` and `less` (transitive, via `gulp-less`) within their existing semver ranges, clearing the high-severity findings flagged by the npm dependency scan. Also upgrades the build toolchain to its latest majors: `@babel/core` and `@babel/preset-env` (7 → 8), `eslint` (10.4 → 10.8), `globals` (16 → 17), `jsdom` (29 → 30), `gulp-autoprefixer` (9 → 10) and `movi-player` (0.3 → 0.4). Build, lint and test suites pass unchanged.

## v1.3.2 - *2026-07-29*

* **Security scanning**: replaces Trivy with Grype/Syft in the CI pipeline and the `Makefile`.
    * Image scan: keeps the previous gate policy (fixable vulnerabilities at high or critical severity), now scans every published platform before failing so a finding on one architecture can't hide the other's, and treats an operational scanner failure as a failure instead of a silent pass.
    * The former blocking filesystem scan is replaced by an advisory npm dependency scan. It also covers build-only `devDependencies`, which the image scan never sees since the multi-stage build discards them, and it publishes an SBOM artifact.
    * The Docker CLI, Grype and Syft images used by the affected jobs are now pinned by digest.
    * The initial baseline found 8 fixable high-severity findings in the build toolchain, all now fixed: `js-yaml`, `fast-uri`, `postcss` and one `brace-expansion` instance were bumped within their existing semver ranges; the last `brace-expansion` DoS (GHSA-mh99-v99m-4gvg) was never backported to the 1.x line it shipped in, pulled in by the unmaintained `gulp-if` → `gulp-match` → old `minimatch` chain, so `gulp-if` is dropped in favor of a two-line `PassThrough`-based helper in `gulpfile.js`.

## v1.3.1 - *2026-07-22*

* **Configuration**: re-enables `foldersize` by default (`foldersize.enabled: true`); the feature was switched to opt-in in v1.3.0 but is now considered stable enough to ship enabled out of the box.

## v1.3.0 - *2026-07-17*

* **Monorepo**: merges the `docker-h5ai` packaging repository into this repository. The Docker image (`pad92/docker-h5ai`) is now built from the in-tree sources by a multi-stage Dockerfile instead of downloading a released zip; published registries, tag scheme and image name are unchanged, so `docker pull` keeps working as before.
* **Changelog**: merged `CHANGELOG.docker.md` into this file. A single changelog now covers the h5ai application and its Docker packaging, with the former Docker-only pre-monorepo history kept as its own section below.
* **CI/packaging**: the multi-arch candidate image and its vulnerability scan now run only on pipelines that can publish (master and tags); merge-request pipelines still build and test the single-arch image. The GitLab package registry keeps only the versioned `h5ai-<version>.zip` attached to releases — the `latest/h5ai-latest.zip` and `master` snapshot uploads were dropped, their only consumer was the former separate docker repository. Image labels (`version`, `build-date`, `vcs-ref`) are now filled from the build pipeline.
* **Security hardening**: confines archive, search and thumbnail inputs to regular managed files under the served root; limits archive size, recursive search, thumbnail batches and generated dimensions; disables the unhardened GraphicsMagick document fallback by default; disables administrator login until a password hash is configured; and documents mandatory deny rules for Apache, nginx, Angie and lighttpd.
* **Process reliability**: reads child-process stdout and stderr concurrently with output and execution limits, preventing pipe deadlocks and indefinitely running archive/media helpers; keeps timeout drains non-blocking, avoids exit-time busy loops, handles interrupted stream polling, verifies media-helper exit codes and closes temporary capture streams.
* **Performance**: switches costly folder-size and startup cache warming features to opt-in defaults, avoids opening the thumbnail database when thumbnails are unused, serializes cache refresh workers, and lazy-loads preview code and the large video compatibility player.
* **Frontend robustness**: handles HTTP, JSON, network and timeout failures consistently, keeps failed folder loads retryable, clears stale search results after request failures, and fixes recursive video unload handling.
* **Cache correctness**: serializes and atomically merges folder-size cache updates so concurrent workers do not lose entries.
* **Worker reliability**: prevents duplicate cache refresh and warm-up workers, detects disabled or failed background process launches, and automatically expires stale launch markers.
* **Quality checks**: runs JavaScript, CSS and PHP checks in CI, pins the security scanner image, fails publishing on HTTP errors, and adds PHP security and process-timeout regression tests.

## v1.2.7 - *2026-07-13*

* **Fixed the cache warmer crashing on startup**: `warm-cache.php` accessed `$_SESSION`, which does not exist in CLI, and died with a `TypeError` before doing any work; the background warming triggered on page visits (and the documented cron command) therefore never ran. It now uses a local session store, like `refresh-cache.php` already did.
* **Removed the dead `google-analytics-ua` extension**: Google shut down Universal Analytics in 2023, so the injected `analytics.js` snippet could no longer record anything. The option block, the client code and the documentation are gone; `piwik-analytics` (Matomo) stays. Remove any `google-analytics-ua` block from a customized `options.json`.
* **Dropped unused shipped files**: the old PayPal donation icon and the unreferenced `favicon.svg` / `favicon-16.png` / `favicon-32.png` (the served pages only use `favicon-16-32.ico` and `favicon-152.png`).
* **Apache config trimmed for Apache 2.4+**: removed the "Apache < 2.3" compatibility blocks (`Order`/`Deny`/`Satisfy`), the ancient mangled `Accept-Encoding` workaround and the obsolete font MIME types (`eot`, `ttf`, `otf`, legacy `woff`); `woff2` is now declared and cached for a year. Apache `2.4+` with `mod_authz_core` (loaded by default on every mainstream distribution) is now a documented requirement: without it the `.htaccess` files fail closed with a 500, the private directory is never silently exposed.
* **Markup/CSS cleanup**: dropped the IE-only `x-ua-compatible` meta tag, switched `apple-touch-icon-precomposed` to the modern `apple-touch-icon` rel, and replaced prefixed `appearance` hacks (including the never-standard `-ms-appearance`) with the standard property.
* **Build cleanup**: removed the unused `lebab` devDependency and the orphan `.dockerignore` (the repository never had a Dockerfile).
* **PHP dead-code removal** (no behavior change):
    * Deleted the legacy `Logger` class (leftover debug infrastructure that wrote timing lines to the error log); the two `Setup` error paths that used it now go through the standard `Util::log()`.
    * Deleted the never-called `Util::exec_cmdv()` helper.
    * Dropped the `HAS_PHP_JPEG` setup check, the unused `NAME` setup key and the `HAS_CMD_FFPROBE`/`HAS_CMD_AVPROBE` command probes: computed and stored on every fresh setup, read by nothing (thumbnails are WebP-based, and the video code paths only test for `ffmpeg`/`avconv`).
    * Removed a PHP 4-era `function_exists('version_compare')` guard and the redundant `TESTED_PHP_VERSION` constant in `index.php`, the no-op `date_default_timezone_set(date_default_timezone_get())` call in the bootstrap, and two `include_once` statements made redundant by the autoloader.
* **Documentation**: the admin guide now states the real PHP minimum (`8.4.0`, not `7.0.0`), the README's Node.js requirement matches `package.json` (`18.18+`), plus a general wording and formatting pass over all Markdown files.
* **Docker image**: updated s6-overlay from `3.1.6.2` to `3.2.3.0`; removed unused packages (`php84-intl` and its ICU data, `php84-xml`, `php84-simplexml`, `php84-xmlwriter`, `php84-pdo_sqlite`, and the base image's `angie-console-light` console) and switched the `HEALTHCHECK` to busybox `wget`, dropping `curl` too — roughly 15 MB smaller, same functionality; dropped the obsolete `msie6` keepalive/gzip Angie directives and added `application/wasm` to `gzip_types` for WebAssembly assets.
* **Fixed the Docker build against h5ai 1.2.7**: h5ai 1.2.7 dropped the `avprobe`/`ffprobe` entries from the command-probe list in `class-setup.php`, shifting the context our `class-setup.php.patch` (silencing missing-command shell noise) depended on; the build failed applying the patch. Updated the patch to match the new upstream source.
* **README**: dropped the stale `X-XSS-Protection` mention, replaced by `Referrer-Policy`/`Content-Security-Policy` since 1.2.0-1.


## v1.2.6 - *2026-07-12*

* **Icons**: replaced every icon (toolbar, tree, preview bar, and all file/folder types) with self-hosted [Font Awesome Free][fontawesome] glyphs, using real brand marks where available (Android, Debian, Red Hat, Python, Rust, PHP, and more). The old "comity" icon theme is gone, merged into `themes/default`, now the sole theme. Regenerate with `npm run icons`.
* **Fonts / CSP**: Ubuntu and Ubuntu Mono are now self-hosted `@font-face` fonts instead of a `fonts.googleapis.com` stylesheet, which a strict `Content-Security-Policy` blocks. The bundled `movi-player` no longer imports Google's Inter font either. No h5ai page requests an external host for icons, fonts, or styles anymore.
* **Makefile**: added a `help` target listing available targets (`build`, `test`, `trivy`, `clean`) and made it the default goal when running `make` with no arguments.

[fontawesome]: https://fontawesome.com


## v1.2.5 - *2026-07-03*

* **Security fix (ImageMagick policy)**: the hardened policy shipped in v1.2.1 was silently **ignored** by ImageMagick: its XML parser rejects the whole file when a comment sits between the `DOCTYPE` and the root element, so none of the SSRF/ImageTragick protections nor the resource limits were actually applied. The comment now lives inside `<policymap>` and the load is verified (`magick -list policy`).
* **PDF/PostScript thumbnails kept working under the policy**: with the policy actually enforced, the previous rules (`PDF`/`PS` coders and all delegates disabled) would have broken the documented `doc` thumbnails. The policy now grants **read-only** access to `PDF`/`PS`/`EPS` and allows only the Ghostscript delegate; everything else (network coders, `MSL`/`MVG`/`SVG`, `@file` indirection, other delegates, writes) stays blocked.
* **Robustness (JSON)**: a malformed `options.json` / cached JSON file now degrades to defaults (with a log entry) instead of taking the whole site down with a `TypeError`; JSON cache writes are serialized with `LOCK_EX` to prevent torn files under concurrency.
* **Logging**: h5ai no longer writes any log file of its own. All diagnostics (previously appended to `_h5ai/private/cache/debug.log`) now go to the PHP/web-server error log, prefixed with `h5ai:`. Entries that cannot be read while listing a directory (permission denied) are now reported there too, whether or not `view.hideIf403` hides them.
* **Folder sizes**: a failing `du` no longer persists a bogus `0` into the folder-size cache (the previous value is kept, or the size is reported as unknown); a racing `filesize()` failure now yields "unknown" instead of a fatal error.
* **Image preview**: the fullscreen mode forced for photos no longer leaks into the next non-image preview (videos/text open windowed again, per the stored preference).
* **Theme icons**: extension matching is case-insensitive again (`icon.PNG` works like `icon.png`), which the v1.2.0 `glob()` rewrite had broken.
* **Cleanup**: removed the dead `custom.stopSearchingAtRoot` option. Since v1.2.1 the header/footer search always stops at the web root, so the option and its documentation are gone.
* **Docker/CI**: added a ready-to-use `docker-compose.yml` example (image `pad92/docker-h5ai:latest`), renaming the previous development compose file to `docker-compose.dev.yml`; fixed a startup failure when `options.json` is bind-mounted as a single file (`sed -i`'s rename fails with `EBUSY`, now rewritten in place via a temp file + `cat`) — a read-only mount keeps its existing `passhash`, and combining it with `H5AI_ADMIN_PASSWORD` now aborts startup with an explicit error; an `htpasswd` failure during basic-auth setup no longer starts the container unauthenticated (fails closed); an unsupported `TARGETARCH` now fails the build explicitly instead of silently falling back to `x86_64` s6-overlay binaries; added explicit `HEALTHCHECK` timing parameters and a 5s `curl` timeout; switched CI registry logins to `--password-stdin`; the CI build now pushes a multi-platform candidate image, scans it with Trivy, and promotes the exact scanned digest to the published tags instead of rebuilding, so published images are bit-identical to what was scanned; fixed the release-notes extraction script eating real content for the oldest changelog section.


## v1.2.4 - *2026-06-26*

* **Image preview**: clicking a photo now displays the original full-resolution image instead of a server-generated downscaled sample. The reduced sample is only used as a fallback when the browser cannot decode the original (e.g. camera RAW formats).


## v1.2.3 - *2026-06-26*

* **Image preview**: clicking a photo now opens its preview directly in fullscreen (instead of the windowed 80% view), with the toolbar auto-hiding after a short delay. Other media types keep their previous behaviour and the fullscreen toggle (button / `f` key) still works.
* **Content-Security-Policy**: relaxed the CSP to support h5ai's WebAssembly-based features and media previews: added `'wasm-unsafe-eval'` to `script-src`, plus `worker-src 'self' blob:` and `media-src 'self' blob:`.


## v1.2.2 - *2026-06-26*

* **Folder size performance (`du`)**:
    * Replaced the per-folder `du -sbL` call plus a full PHP re-walk of the same tree with a single `du -bL` pass: one process now yields the cumulative size of the whole subtree, and the cache-validation `mtime` map is derived directly from `du`'s output (directories only) instead of a second `RecursiveDirectoryIterator` traversal.
    * Background cache refresh (`refresh-cache.php`) now computes all stale folders in a **single batched `du` process** (`Filesize::refresh_du()`) instead of spawning one process per folder.
    * Dropped the now-redundant `exec_du`, `exec_du_all` and `get_all_subdirs` helpers; hardened `du` output parsing against paths containing spaces and malformed lines.
* **Other optimizations & cleanup**:
    * Memoized `Context::is_managed_path()` (previously recomputed, via `realpath()` plus a walk to root, once per listed sub-folder per request).
    * Centralized the `withFoldersize`/`withDu` option lookup in a memoized `Context::foldersize_mode()`, removing the duplicated computation in `Util`, `CacheWarmer` and `refresh-cache.php`.
    * De-duplicated the custom-thumbnail (`_thumb`) detection: `get_items()` now reuses `Thumb::check_custom_thumb()`, and the supported-format list is a single `Thumb::CUSTOM_THUMB_EXT` constant.
    * `CacheDB`: cached the `select_typeid` prepared statement, and `select()` consistently returns `null` when SQLite is unavailable.
* **Docker/runtime**: added `REAL_IP_FROM` (and optional `REAL_IP_HEADER`) environment variables to declare trusted reverse proxies, generating `real_ip.conf` at startup; symlinked `/usr/bin/php` to `php84`; switched the Angie access log to a `vhost_combined`-style format while preserving `X-Forwarded-For`; set `clear_env = yes` in PHP-FPM so container secrets (`ENV_P`, `H5AI_ADMIN_PASSWORD`) are no longer exposed to PHP workers; refined the startup permission fixup to `755` on directories and `644` on files instead of `755` everywhere; the `HEALTHCHECK` no longer reports `unhealthy` when basic auth is enabled (treats `200` and `401` as healthy); removed a no-op `$?` check after `htpasswd`.


## v1.2.2-1 - *2026-06-26*

* **PUID/PGID remapping**: added `PUID`/`PGID` support so the runtime `angie` account is remapped at startup (via `usermod`/`groupmod -o`) to match the owner of bind-mounted shares, preventing h5ai from silently hiding entries (`hideIf403`) when shares are owned by a different uid/gid. Requires the newly added `shadow` package.
* **Angie**: updated to version `1.11.8`; added `user angie;` to `angie.conf` so Angie workers run under the same account as PHP-FPM, extending the PUID/PGID remapping to direct file downloads.
* **Fixed an empty listing behind `clear_env`**: `clear_env = yes` stripped `H5AI_ROOT_PATH` from worker environments, causing h5ai to fall back to the wrong directory; `H5AI_ROOT_PATH` is now passed explicitly through `php-fpm.conf`.


## v1.2.1 - *2026-06-26*

* **Security Hardening** (addresses Snyk findings and a wider audit):
    * **XSS**: replaced the hand-rolled blocklist HTML sanitizer with an allowlist-based one (`misc.js`), closing bypasses such as `java\tscript:`, `data:` URIs, `xlink:href`, `srcset` and `style` in rendered Markdown / custom header-footer content.
    * **SSRF/LFI**: confined `ffmpeg`/`avconv` to local input via `-protocol_whitelist file,crypto,data`, and shipped a restrictive ImageMagick policy (`conf/magick/policy.xml`, activated through `MAGICK_CONFIGURE_PATH`) disabling risky coders (`URL`, `HTTPS`, `MSL`, `SVG`, `MVG`, …) and external delegates.
    * **Path traversal**: added `realpath()` canonicalization in `is_managed_path()`, ensuring resolved paths stay within the served root and rejecting symlinked directories that escape it.
    * **Password storage**: `login_admin()` now accepts modern salted `password_hash()` digests (bcrypt/argon2) while keeping backward compatibility with legacy SHA512 hashes.
    * **Session fixation**: regenerate the session id on admin login and logout.
    * **SQL**: replaced string-interpolated SQLite statements in `CacheDB` with prepared statements.
    * **Misc**: skip thumbnail generation for hidden files, and strip CR/LF from log messages to prevent log injection.
* **Documentation**: documented the new password hashing, the media-processor hardening, and removed comments from `options.json`/`en.json` so they are strict-JSON parseable by external tools.


## v1.2.0 - *2026-06-21*

* **PHP 8.4 Minimum Version**:
    * Raised minimum PHP version from `7.0.0` to `8.4.0`.
    * Modernized all PHP classes with typed/readonly properties, constructor promotion, return types, and union types.
    * Adopted modern PHP idioms: `match` expressions, `str_starts_with()`/`str_ends_with()`/`str_contains()`, first-class callable syntax, `never` return type, `CommentStyle` enum, `\GdImage` type hints.
    * Used PHP 8.4 array functions (`array_any()`, `array_all()`, `array_find()`) for cleaner iteration.
* **Performance Optimizations**:
    * Faster tar checksum with `unpack('C*')`, `FilesystemIterator` for directory reads, `glob()` for file listing, compile-time `__DIR__` resolution, vectorized `str_replace()`, and cached store lookups in hot loops.
* **Code Cleanup**:
    * Removed dead code (`Util::starts_with/ends_with` wrappers, unnecessary `method_exists()`, redundant checks), factored duplicated SQLite PRAGMA, and simplified helper methods.
* **Bug Fixes**:
    * Fixed audio cover art not displaying in player bar (inline `display: none` conflicted with CSS class toggle).
    * Implemented image loading verification for thumbnails and audio cover art.
* **Docker base image**: upgraded to PHP `8.4` (Alpine-based), including path updates for the `rar` extension and s6-overlay configuration.


## v1.2.0-1 - *2026-06-21*

* **CI**: upgraded the Docker-in-Docker image from `24.0.5` to `28` across build, test and publish stages; extracted a reusable `.publish-template` job for multi-platform image publishing.
* **Security headers**: replaced the deprecated `X-XSS-Protection` header with `Referrer-Policy` and `Content-Security-Policy` in the Angie configuration.
* **PHP**: disabled OPcache JIT (`jit=disable`) for stability.
* **PHP-FPM**: added an explicit `[global]` section (PID file, error log paths); tightened the socket permissions from `0666` to `0660` with `angie` group ownership.
* **Cache ownership**: changed from `angie:www-data` to `angie:angie` for a consistent permission model.
* **s6-overlay**: changed `S6_CMD_WAIT_FOR_SERVICES_MAXTIME` from `0` (infinite) to `30000` (30s) to detect stuck services.
* **Makefile**: replaced hardcoded `sleep` waits with retry-based HTTP polling helpers (`wait_for_http`, `wait_for_http_auth`); switched the build command to `docker buildx build`.
* **Fixed reproducible builds**: pinned the `php-rar` extension build to a specific git commit and copied the compiled `rar.so` via a stable intermediate path.
* **Fixed init script safety**: added `set -e` to the permissions initialization script for fail-fast behavior on errors.


## v1.1.7 - *2026-06-21*

* **Audio Preview & Thumbnails**:
    * Added audio thumbnail generation using ffmpeg/avconv.
    * Added a close/stop button to the audio player queue interface.
* **Asynchronous Cache & Refresh**:
    * Implemented background/asynchronous foldersize calculation and cache warming using a CLI helper script (`refresh-cache.php`).
    * Added real-time folder item size and date refresh on location refresh events.


## v1.1.6 - *2026-06-21*

* **Tree State & Cache Enhancements**:
    * Preserved existing tree node state when fetching, and rebuilt the tree from its root on location refresh events to prevent collapses.
    * Improved caching by moving no-cache HTTP headers from `json_exit` to the directory listing API response only.
    * Defaulted `ROOT_PATH` to the parent of `H5AI_PATH` instead of the hardcoded `/share` when `H5AI_ROOT_PATH` is unset.
    * Added tracking for `item.isContentFetched` after fetching directory contents.
* **Styling & Type Mapping Improvements**:
    * Cleaned up dark theme details view CSS rules and removed unnecessary `!important` declarations.
    * Expanded type mappings, adding `csv`, `kotlin`, `sql`, `swift`, `ts`, `avif`, and other common file extensions to `types.json` and `options.json`.


## v1.1.5 - *2026-06-20*

* **Cache & Refresh Fixes**:
    * Resolved aggressive caching of directory data by adding HTTP cache control headers to API responses.
    * Fixed folder list refresh issues by ensuring the tree view updates upon location refresh events.
    * Fixed a bug in the item model that marked parent content as fully fetched prematurely, causing stale directory listings.
    * Restored search and filter input colors and visibility in dark mode.


## v1.1.4 - *2026-06-20*

* **Zebra Striping & Dark Mode Hover Fixes**:
    * Added alternating row background colors (zebra striping) in details view list for improved legibility.
    * Fixed dark mode link hover color tone-on-tone illegibility (links turned black on hover, now turn to a soft light blue).
    * Added text color hover transitions for file and folder items in dark mode (items now highlight in light blue on mouse hover, matching light theme behavior).
* **Dark Mode & Styling Improvements**:
    * Fixed styling overrides for admin password box `#pass` in dark mode by correcting broken CSS selectors.
    * Added proper visibility and color styling for password box placeholder in dark mode.
* **Less Files Linting**:
    * Integrated Stylelint config to enforce formatting and coding standards on Less files.
    * Cleaned up and automatically formatted all Less stylesheets, resolving 261 style issues.
    * Removed obsolete vendor-prefixed properties from text preview stylesheets.
* **Docker image**: added `php83-sqlite3`/`php83-pdo_sqlite` (SQLite3 caching support) and compiled the `rar` extension from source for PHP 8.3 compatibility; added `H5AI_ROOT_PATH=/share` for customizable root folder mapping; removed a redundant build-time cache-directory `chown` in the Dockerfile, relying entirely on the runtime s6-overlay permission setup.

## v1.1.3 - *2026-06-19*

* **Version Display & Build Optimization**:
    * Displayed the h5ai version dynamically in the info page header, page backlink, and toolbar backlink.
    * Adjusted build versioning logic to append commit counter/hash only for non-production builds.
    * Fixed the release notes extraction logic in CI/CD pipeline to properly parse headers with prefix/prefix-less versions.
* **Docker**: configured `S6_CMD_WAIT_FOR_SERVICES_MAXTIME=0` to prevent s6-overlay timing out during slow container startup; optimized the startup permissions script to only `chown`/`chmod` files with incorrect owner/group or permissions, speeding up boot when cache volumes are already populated.


## v1.1.2 - *2026-06-19*

* **Version Display & Repository Migration**:
    * Added dynamic display of the h5ai version inside the topbar backlink.
    * Migrated all repository links globally from `manti-X` to `pad92`.
    * Added comprehensive diagnostic and administration documentation under `doc/administration.md`.
* **Docker/runtime**: added `H5AI_ADMIN_PASSWORD` to set the SHA-512 `passhash` in `options.json` at startup (a random password is generated and logged if unset); migrated process management from Supervisor to s6-overlay v3 (correct UNIX signal forwarding, automatic restarts), reducing the unpacked image size from 391MB to 321MB (~18%) by dropping Supervisord and its Python 3 runtime; added dynamic `TARGETARCH` mapping in the builder stage so the same Dockerfile builds both `amd64` and `arm64`.


## v1.1.1 - *2026-06-19*

* **Infinite Recursion & Loop Prevention**:
    * Implemented loop detection and symbolic link checks in recursive directory scans.
    * Prevented PHP-FPM pool exhaustion by skipping directory symlinks (`!is_link()`) during recursive file size calculation, cache warming, folder searching, and zip archiving.
    * Added visited realpath tracking to prevent loop traversals in deep or circular folder structures.


## v1.1.0 - *2026-06-19*

* **Modern Audio Player Redesign**:
    * Redesigned audio preview panel with a modern glassmorphic look, including progress/volume bars, track info, and playback queue.
    * Enabled persistent audio playback while navigating directories (continuous play across folders).
    * Integrated a playback queue supporting auto-play, skip, previous, shuffle, loop, and toggle queue list view.
* **Code Optimization & Security**:
    * Optimized folder size caching initialization to run contextually, improving performance.
    * Secured SQLite3 CacheDB queries by escaping parameters.
    * Reduced archive download segment size to 64KiB for smoother streaming.
    * Suppressed warning outputs on path context regex matching.
* **CI/CD & Security Auditing**:
    * Created a GitLab CI/CD configuration to automate linting (`eslint`), unit testing (`scar`), building release ZIP packages (`gulp release`), publishing release packages, and creating GitLab Releases.
    * Integrated Trivy filesystem scans (`trivy fs`) into the GitLab CI/CD pipeline and added a local `scan` target in the `Makefile` with optimized directory exclusions (`.npm_cache`, `node_modules`, `build`).
* **Docker build**: switched the image builder stage to download the pre-compiled `h5ai` zip from the GitLab Generic Packages Registry instead of git-cloning and compiling from source (superseded by the in-tree multi-stage build after the monorepo merge).



## v1.0.0 - *2026-06-18*

* **Gulp Migration & Thumbnail Improvements**:
    * Migrated the build system from ghu to gulp and added WebP support to the thumbnail module.
    * Limited image preview to 80% of screen size.
    * Resolved CacheDB not found runtime error and fixed `is_readable` checks in the filesize module.
    * Fixed ESLint warnings.


## Docker packaging history *(pre-monorepo, from the former `docker-h5ai` repository)*

* **v0.30.0-17** - *2026-06-18* — Migrated the web server from Nginx to Angie (`1.11.7-minimal`, Alpine-based); migrated configuration paths to `/etc/angie/angie.conf`, updated Supervisord task definitions, and switched file ownership/permissions to the `angie` user.
* **v0.30.0-16** - *2026-06-18* — Upgraded the `nginx` base image from `1.26` to `1.30` and PHP to `8.3` (Alpine); upgraded OpenSSL to `3.3.7-r0` for security fixes and build compatibility.
* **v0.30.0-15** - *2026-06-14* — Upgraded the built h5ai base to `0.30.0-pad92.8`: integrated upstream PR #765 for improved video thumbnail generation and prevention of a thumbnail DoS exploit, used `ffprobe`/`avprobe` to seek into a configurable percentage of the video duration (default 50%), limited client control over generated thumbnail sizes, and configured CSS `object-fit` for responsive square thumbnail cropping.
* **v0.30.0-14** - *2026-06-13* — Upgraded the built h5ai base to `0.30.0-pad92.7`: added persistent folder-size caching and background cache warming (`warm-cache.php`), plus `cache` options in `options.json` and matching documentation.
* **v0.30.0-13** - *2026-06-13* — Upgraded the built h5ai base to `0.30.0-pad92.6`; added `imagemagick-raw`/`libraw` to enable RAW photo previews.
* **v0.30.0-12** - *2026-06-12* — Upgraded the built h5ai base to `0.30.0-pad92.5`; added `doc/configuration.md`; modernized the photo preview to show EXIF metadata in a responsive glassmorphic panel.
* **v0.30.0-11** - *2026-06-12* — Upgraded the built h5ai base to `0.30.0-pad92.4`; optimized and standardized UI icon SVG markup.
* **v0.30.0-10** - *2026-06-12* — Silenced a Supervisord critical warning when running as root without dropped privileges and a spurious `sh: where: not found` PHP command-check warning; hardened the permissions initialization script by creating cache folders before configuring their permissions.
* **v0.30.0-9** - *2026-06-12* — Added a Supervisor initialization task (`init_perms.sh`) to set ownership (`nginx:www-data`) and write permissions (`755`) on cache directories at startup.
* **v0.30.0-8** - *2026-06-12* — Upgraded the built h5ai base to `0.30.0-pad92.3`.
* **v0.30.0-7** - *2026-06-12* — Upgraded the built h5ai base to `0.30.0-pad92.2`; configured CPU/memory limits in `docker-compose.yml`; added `custom.ini` with tuned PHP memory/execution-time limits, realpath cache and output buffering; tuned PHP-FPM pool concurrency (up to 20 workers) with recycling after 1000 requests; tuned OPcache and disabled file-status checks (`validate_timestamps = 0`) on the immutable image filesystem; cleaned up `docker-compose.yml`.
* **v0.30.0-6** - *2026-06-12* — Upgraded the compiled h5ai base to `0.30.0-pad92.1` (the `pad92/h5ai` fork, integrating `movi-player`, an upgraded `marked`, and cross-origin isolation); documented persisting the public/private cache across container restarts via volume mounts.
* **v0.30.0-5** - *2026-06-12* — Configured `release-cli` to generate GitLab Release pages from `CHANGELOG.md` tag descriptions; enabled `X-Frame-Options`/`X-Content-Type-Options`/`X-XSS-Protection`; blocked external access to `/_h5ai/private` (403); upgraded to Nginx `1.26` (Alpine-slim) and PHP `8.3`; upgraded the builder to Node 20; set Supervisord to auto-restart PHP-FPM/Nginx on failure; migrated CI from GitHub Actions to a 5-stage GitLab CI/CD pipeline (lint, build, test, scan, publish); replaced multiple build jobs with a parameterized multi-platform (`amd64`/`arm64`) Buildx pipeline with registry caching; moved Trivy scanning to local tarball scans; extended basic-auth protection to static file downloads and added `ENV_U`/`ENV_P` presence checks; rewrote auth test scripts to resolve gateways via container IP lookups.
* **v0.30.0-4** - *2023-10-10* — Fixed HTTP real-IP configuration and log redirection.
* **v0.30.0-3** - *2023-10-03* — Configured multi-platform builds (`amd64`, `arm64`, `arm/v7`) and Container Scanning/SAST in GitLab CI; updated Node versions and enabled OPcache; fixed a CI tagging bug.
* **v0.30.0-2** - *2023-05-14* — Upgraded PHP to `8.1` and the Nginx base image to `1.22.1-alpine` (security fix); fixed PHP 8.1 compatibility issues and repository badge links.
* **v0.30.0-1** - *2022-07-06* — Upgraded to PHP `8.0` and applied Dockerfile security upgrades.
* **v0.30.0** - *2021-11-30* — Added Basic Authentication via `ENV_U`/`ENV_P`; added the MIT license file; cleaned up CI configuration.
* **v0.29.2-2** - *2019-10-27* — Explicitly set Docker image version labels.
* **v0.29.2-1** - *2019-07-29* — Switched the base image to `nginx:stable-alpine`.
* **v0.29.2** - *2019-07-29* — Added Supervisord to manage Nginx and PHP-FPM; added Imagick and its system dependencies; upgraded the h5ai version and the Alpine base to `3.9`.
* **v0.29.0-2** - *2018-11-20* — Cleaned up and optimized build/runtime dependencies.
* **v0.29.0-1** - *2018-07-10* — Fixed PHP 7 error log paths.
* **v0.29.0** - *2018-07-09* — Initial release: basic h5ai functionality on Nginx/PHP.


## v0.33.0-pad92.1 - *2026-06-15*

* **Upstream Sync & Modernization**: Merged `manti-X` changes (Gulp build, ESLint flat config, WebP thumbnails, touch gestures, SQLite3 CacheDB).
* **Fork Feature Parity**: Retained advanced `movi-player` video player, EXIF glassmorphic sidebar, RAW photos (`CR3` previews), and persistent folder size caching.
* **Security & Optimization**: Added boundary checks against path traversals, enabled SQLite3 WAL & Synchronous NORMAL, and added Imagick memory limits (128MB).
* **Bug Fixes & Case Insensitivity**:
    * Fixed Canon `.CR3` files downloading instead of previewing.
    * Fixed scaled preview size bug (respect client-requested dimensions instead of hardcoding 240px).
    * Enforced case-insensitive file extension matching globally (for archive extraction, theme icons, and thumbnail generation).
    * Cleaned up all ESLint warnings/errors (0 errors, 0 warnings).


## v0.30.0-pad92.8 - *2026-06-14*

* integrate Pull Request #765 for improved video thumbnail generation and prevention of thumbnail DoS exploit
* use ffprobe/avprobe to query total video duration and seek into a configurable percentage (default 50%)
* limit client control over generated thumbnail sizes to prevent resource exhaustion exploits
* configure CSS object-fit on thumbnails for responsive square cropping


## v0.30.0-pad92.7 - *2026-06-13*

* add persistent foldersize caching with recursive directory mtime state validation
* implement background cache warming task (`warm-cache.php`) to pre-generate thumbnails and populate folder sizes
* add `cache` configuration section to `options.json` for enabling and scheduling cache warming
* update configuration documentation in `doc/configuration.md` to cover cache warming and foldersize caching options


## v0.30.0-pad92.6 - *2026-06-13*

* add support for all common RAW photo formats (including Canon CR3) in type mappings and thumbnails
* set default image preview size to 1000 pixels to enable server-side RAW preview rendering out-of-the-box
* document RAW image support and update preview size options in `doc/configuration.md`


## v0.30.0-pad92.5 - *2026-06-12*

* add configuration documentation file `doc/configuration.md` and link it in `README.md`
* modernize photo preview to display EXIF metadata in a responsive glassmorphic panel


## v0.30.0-pad92.4 - *2026-06-12*

* optimize and standardize UI icon SVG markup and structure


## v0.30.0-pad92.3 - *2026-06-12*

* implement video thumbnail capture fallback mechanism and update code style formatting
* add `.dockerignore` and update `.gitignore` with standard ignore patterns


## v0.30.0-pad92.2 - *2026-06-12*

* update devDependencies and support modern Node.js environments (no legacy OpenSSL flag needed)
* migrate ESLint configuration to flat format (`eslint.config.js`) using `@stylistic`
* clean up legacy lint configuration files
* optimize Babel build configurations in `ghu.js`
* optimize server-side thumbnail generation (use EXIF, Imagick, direct GD streams, and optimized cli params)


## v0.30.0-pad92.1 - *2026-06-12*

* modernize video player preview with `movi-player` (supports x264, x265, multiple audio tracks, subtitles)
* update `marked` to 9.1.6 (fixes security vulnerabilities)
* add cross-origin isolation headers to page templates
* configure Babel script to support private class properties and methods in `node_modules`


## v0.30.0 - *2024-11-09*

* now require PHP 7.0.0+
* fix archive-single-item problem
* add header/footer search stop condition
* update languages (`id`, `it`, `pt-br`, `pt-pt`)
* add EXIF-based image rotation
* add `where` to command detection command list
* fix #758
* fix #760
* add `@babel/core` 7.12.10
* add `@babel/preset-env` 7.12.11
* remove `babel-loader`
* update `eslint` to 7.18.0
* update `ghu` to 0.26.0
* update `jsdom` to 16.4.0
* update `kjua` to 0.9.0
* update `lolight` to 1.4.0
* update `marked` to 1.2.7
* update `null-loader` to 4.0.1
* update `scar` to 2.3.0


## v0.29.2 - *2019-03-22*

* update `babel-loader` to 7.1.1
* update `eslint` to 5.15.3
* update `ghu` to 0.13.0
* update `jsdom` to 14.0.0
* update `kjua` to 0.2.0
* update `lolight` to 1.0.0
* update `scar` to 1.2.0


## v0.29.1 - *2019-01-20*

* replace `babel-preset-es2015` with `babel-preset-env`
* update `eslint` to 5.14.1
* update `ghu` to 0.12.0
* update `jsdom` to 9.2.0
* update `kjua` to 0.1.2
* update `lolight` to 0.6.0
* update `marked` to 0.6.1
* update `normalize.css` to 8.0.1
* update `scar` to 1.0.0


## v0.29.0 - *2016-08-12*

* back to cleaner visual experience
* add option to disable sidebar
* add options to filter/search ignore case
* replace PHP `getenv` calls with `$_SERVER` lookups
* add `view.fallbackMode` option to generally serve only fallback mode
* serve fallback mode for text browsers (`curl`, `links`, `lynx`, `w3m`)
* change type `txt-svg` to `img-svg`, no thumbs but preview
* fix a tree indentation glitch
* fix shell command detection on Windows
* fix Piwik anayltics
* fix `.htaccess` auth issues
* fix drag-select on scrollable content
* fix download-all function
* fix audio and video preview loading
* fix thumbnail request issues
* add `rust` type and icon
* add `autoplay` option to audio and video preview
* add `--dereference` to `shell-du` to follow sym links
* remove *Install* section from `README.md`, causes too much trouble
* remove peer5 support
* update build process to use `node 6.0+`, no need for babel now
* replace `jquery-qrcode` with [`kjua`](https://larsjung.de/kjua/)
* replace `prism` with [`lolight`](https://larsjung.de/lolight/)
* move deps to `package.json` (`normalize.css`, `kjua`, `lolight` and `marked`)
* remove `jQuery`
* remove `lodash`
* remove [`modulejs`](https://larsjung.de/modulejs/) for now
* reduce JS code by 60% (~250kb -> ~100kb)
* update languages (`et`, `nl`, `pl`)


## v0.28.0 - *2015-12-19*

* now require PHP 5.5.0+
* change index path to `/_h5ai/public/index.php`
* now only `/_h5ai/public/` needs to be web-accessible
* add support for custom script and style additions
* add options to set font families
* add search
* add ignorecase sorting option to tree
* add wide links in tree view
* add IE edge mode
* add frontend tests
* fix some styles in IE10
* fix preview bottom bar for small screen widths
* lots of code cleanup and refactorings
* change API
* update build process, now uses [`ghu`](https://larsjung.de/ghu/)
* switch from jshint and jscs to [`eslint`](http://eslint.org/)
* update `jQuery` to 2.1.4
* update `lodash` to 3.9.3 (add debounce and trim)
* update `marked` to 0.3.5
* update `modulejs` to 1.13.0
* update `prism` to 2015-12-19
* update h5bp styles to 5.2.0
* update `normalize.css` to 3.0.3
* remove `Moment.js`


## v0.27.0 - *2015-04-06*

* new layout
* add editorconfig
* drop support for IE9 (gets fallback)
* update sidebar settings
* add info sidebar
* add opt-out for click'n'drag selection
* add package name option for single selections
* add initial support for Peer5
* add option to down-sample images for preview
* add option for natural sorting in tree sidebar
* fix problems with files/folders named `0`
* change font from `Ubuntu` to `Roboto` (smaller footprint, clearer for small sizes)
* switch back to Google Fonts
* improve PDF thumbnail quality
* improve drag-select
* improve image preview
* prevent listing `_h5ai` folder and subfolders
* update build process, now uses [`mkr`](https://larsjung.de/mkr/) and [`fQuery`](https://larsjung.de/fquery/)
* update `jQuery` to 2.1.3
* update `jQuery.qrcode` to 0.11.0
* update `Lo-Dash` to 3.6.0
* update `Modernizr` to 2.8.3
* update `modulejs` to 1.4.0
* update `Moment.js` to 2.9.0
* update `Prism` to 2015-04-05
* remove deprecated Google Analytics code
* remove `jQuery.fracs`
* remove `jQuery.scrollpanel`
* remove `jQuery.mousewheel`
* update languages (`af`, `es`, `ja`, `ko`, `ru`, `zh-cn`)


## v0.26.1 - *2014-08-17*

* fix links


## v0.26.0 - *2014-08-16*

* remove True Type fonts
* outsource themes to [h5ai-themes](https://github.com/lrsjng/h5ai-themes)
* add filesize fallback for large files and 32bit PHP
* fix server detection
* add config file tests to info page
* remove JSON shim
* add caching of command checks
* update `jQuery.mousewheel` to 3.1.12
* update `jQuery.qrcode` to 0.8.0
* replace `markdown` with [`marked`](https://github.com/chjj/marked) 0.3.2
* update `modulejs` to 0.4.5
* update `Moment.js` to 2.8.1
* replace `underscore` with [`Lo-Dash`](https://github.com/lodash/lodash) 2.4.1
* replace `SyntaxHighlighter` with [`Prism`](http://prismjs.com) 2014-08-04


## v0.25.2 - *2014-07-01*

* add optional info page protection
* fix `short_open_tag` issues for PHP < 5.4.0
* fix default folder download (`alwaysVisible` option)
* minor fixes


## v0.25.1 - *2014-06-25*

* fix broken paths for filenames containing '+' characters
* fix Google Universal Analytics
* fix file type check


## v0.25.0 - *2014-06-22*

* add sidebar
* add initial theme support
* add icons from [Evolvere Icon Theme](http://franksouza183.deviantart.com/art/Evolvere-Icon-theme-440718295)
* add PHP variant to calc folder sizes
* add scroll position reset on location change (issue [#279](https://github.com/lrsjng/h5ai/issues/279))
* add option to hide unreadable files
* add option where to place folders (top, inplace, bottom)
* add markdown support for custom header and footer files
* add video and audio preview via HTML5 elements (no fallback, works best in Chrome)
* add filter reset on location change
* add option to make download button always visible
* add Google UA support
* extend selectable icon sizes (add 128px, 192px, 256px, 384px)
* improve preview GUI
* disable thumbs in `cache` folder
* fix QR code URI origin (issue [#287](https://github.com/lrsjng/h5ai/issues/287))
* replace PHP backtick operator with `exec`
* remove server side file manipulation extensions `dropbox`, `delete` and `rename`
* update `H5BP` to 4.3.0
* update `jQuery` to 2.1.1
* update `json2.js` to 2014-02-04
* update `markdown-js` to 0.5.0
* update `Modernizr` to 2.8.2
* update `Moment.js` to 2.6.0
* update `Underscore.js` to 1.6.0
* update languages (`bg`, `ko`, `pt`, `sl`, `sv`, `zh-cn`)


## v0.24.1 - *2014-04-09*

* security fixes! (issues [#268](https://github.com/lrsjng/h5ai/issues/268), [#269](https://github.com/lrsjng/h5ai/issues/269))
* fix WinOS command detection
* update languages (`fi`, `fr`, `hi`, `it`, `zh-tw`)


## v0.24.0 - *2013-09-04*

* updates image and text preview
* adds variable icon sizes
* adds optional natural sort of items
* adds optional checkboxes to select items
* adds text preview modes: none, fixed, markdown
* optionally hide folders in main view
* makes use of EXIF thumbnails optional
* fixes file deletion of multiple files
* fixes `setParentFolderLabels = false`
* fixes shell-arg and RegExp escape issues
* cleans code
* updates info page `/_h5ai`
* adds `aiff` to `audio` types
* adds `da` translation by Ronnie Milbo
* updates to `pl` translation by Mark


## v0.23.0 - *2013-07-21*

* removes `aai` mode!
* drops support for IE7+8 (simple fallback, same as no javascript)
* uses History API if available (way faster browsing)
* faster thumbnail generation if EXIF thumbnails available
* adds optional custom headers/footers that are propageted to all subfolders
* optional hide parent folder links
* some fixes on previews
* speeds up packaged downloads
* add line wrap and line highlighting (on hover) to text preview
* new design (colors, images)
* now uses scalable images for the interface
* fixes filter (ignore parent folder, display of `no match`)
* lots of small fixes
* updates `H5BP` to 4.2.0
* updates `jQuery` to 2.0.3
* updates `jQuery.mousewheel` to 3.1.3
* updates `Moment.js` to 2.1.0
* updates `markdown-js` to 0.4.0-9c21acdf08
* updates `json2.js` to 2013-05-26
* adds `uk` translation by Viktor Matveenko
* updates to `pl` translation by Mark


## v0.22.1 - *2012-10-16*

* bug fix concerning API requests in PHP mode
* minor changes in responsive styles


## v0.22 - *2012-10-14*

* general changes h5ai directory layout and configuration
* splits configuration file (`config.json`) into files `options.json`, `types.json` and `langs.json`
* localization now in separate files
* adds auto-refresh
* adds drag'n'drop upload (PHP, experimental)
* adds file deletion (PHP, experimental)
* cleans and improves PHP code
* PHP no longer respects htaccess restrictions (so be careful)
* PHP ignore patterns might include paths now
* improves separation between aai and php mode
* improves performance in aai mode
* adds optional binary prefixes for file sizes
* improves filter: autofocus on keypress, clear on `ESC`
* download packages now packaged relative to current folder
* download package name changable
* splits type `js` into `js` and `json`
* prevents some errors with files > 2GB on 32bit OS
* adds max subfolder size in tree view
* adds ctrl-click file selection
* adds Piwik analytics extension
* temp download packages are now stored in the `cache`-folder and deleted as soon as possible
* updates translations
* adds `he` translation by [Tomer Cohen](https://github.com/tomer)
* updates 3rd party libs


## v0.21 - *2012-08-06*

* fixes misaligned image previews
* adds no JavaScript fallback to PHP version
* fixes duplicate tree entries and empty main views
* adds Google Analytics support (async)
* improves filter (now ignorecase, now only checks if chars in right order)
* adds keyboard support to image preview (space, enter, backspace, left, right, up, down, f, esc)
* adds text file preview and highlighting with [SyntaxHighlighter](http://alexgorbatchev.com/SyntaxHighlighter/) (same keys as img preview)
* adds Markdown preview with [markdown-js](https://github.com/evilstreak/markdown-js)
* adds new type `markdown`
* changes language code `gr` to `el`
* adds localization for filter placeholder
* adds `hu` translation by [Rodolffo](https://github.com/Rodolffo)
* updates to [jQuery.qrcode](https://larsjung.de/qrcode/) 0.2
* updates to [jQuery.scrollpanel](https://larsjung.de/scrollpanel/) 0.1
* updates to [modulejs](https://larsjung.de/modulejs/) 0.2
* updates to [Moment.js](http://momentjs.com) 1.7.0
* updates to [Underscore.js](http://underscorejs.org) 1.3.3


## v0.20 - *2012-05-11*

* adds image preview
* adds thumbnails for video and pdf
* adds support for lighttpd, nginx and cherokee and maybe other webservers with PHP
* adds folder size in PHP version via shell `du`
* fixes some localization problems
* updates info page at `/_h5ai/`
* switches to JSHint


## v0.19 - *2012-04-19*

* adds lots of config options
* changes in `config.js` and `h5ai.htaccess`
* fixes js problems in IE 7+8
* hides broken tree view in IE < 9, adds a message to the footer
* removes hash changes since they break logical browser history
* fixes thumbnail size for portrait images in icon view
* fixes problems with file type recognition
* adds an info page at `/_h5ai/`
* sort order is preserved while browsing
* removes PHP error messages on thumbnail generation
* fixes PHP some problems with packed download
* adds support for tarred downloads
* changes crumb image for folders with an index file
* adds `index.php` to use h5ai in non-Apache environments
* switches from [Datejs](http://www.datejs.com) to [Moment.js](http://momentjs.com)
* adds [underscore.js](http://underscorejs.org)
* fixes mousewheel problems, updates [jQuery.mousewheel](https://github.com/brandonaaron/jquery-mousewheel) to 3.0.6
* updates `lv` translation
* adds `ro` translation by [Jakob Cosoroabă](https://github.com/midday)
* adds `ja` translation by [metasta](https://github.com/metasta)
* adds `nb` translation by [Sindre Sorhus](https://github.com/sindresorhus)
* adds `sr` translation by [vBm](https://github.com/vBm)
* adds `gr` translation by [xhmikosr](https://github.com/xhmikosr)


## v0.18 - *2012-02-24*

* adds optional QRCode display
* adds optional filtering for displayed files and folders
* updates design
* improves zipped download
* adds support for zipped download of htaccess restricted files
* changes h5ai.htaccess
* custom headers/footers are now optional and disabled by default
* fixes problems with folder recognition in the JS version
* fixes include problems in PHP version
* fixes path problems on servers running on Windows in PHP version
* fixes broken links in custom headers/footers while zipped download enabled
* fixes problems with thumbnails for files with single or double quotes in filename
* improves url hashes
* updates year in `LICENSE.TXT`
* updates es translation
* adds `zh-tw` translation by [Yao Wei](https://github.com/medicalwei)
* updates `zh-cn` translation


## v0.17 - *2011-11-28*

* h5ai is now located in `_h5ai` to reduce collisions
* switches from HTML5 Boilerplate reset to normalization
* adds some style changes for small devices
* configuration (options, types, translations) now via `config.js`
* icons for JS version are now configured via `config.js`
* sort order configuration changed
* sorting is now done without page reload
* adds `customHeader` and `customFooter` to `config.js`
* supports restricted folders to some extent
* some style changes on tree and language menu
* fixes total file/folder count in status bar
* adds support for use with userdir (requires some manual changes)


## v0.16 - *2011-11-02*

* sorts translations in `options.js`
* improves HTML head sections
* refactors JavaScript and PHP a lot
* improves/fixes file selection for zipped download
* fixes scrollbar and header/footer link issues (didn't work when zipped download enabled)
* adds support for ctrl-select
* `dateFormat` in `options.js` changed, now affecting JS and PHP version
* `dateFormat` is localizable by adding it to a translation in `options.js`
* PHP version is now configurable via `php/config.php` (set custom doc root and other PHP related things)
* image thumbs and zipped download is disabled by default now, but works fine if PHP is configured


## v0.15.2 - *2011-09-18*

* adds `it` translation by [Salvo Gentile](https://github.com/SalvoGentile) and [Marco Patriarca](https://github.com/Fexys)
* switches build process from scripp to wepp


## v0.15.1 - *2011-09-06*

* fixes security issues with the zipped download feature
* makes zipped download optional (but enabled by default)


## v0.15 - *2011-09-04*

* adds zipped download for selected files
* cleans and refactores


## v0.14.1 - *2011-09-01*

* display meta information in bottom bar (icon view)
* adds `zh-cn` translation by [Dongsheng Cai](https://github.com/dongsheng)
* adds `pl` translation by Radosław Zając
* adds `ru` translation by Богдан Илюхин


## v0.14 - *2011-08-16*

* adds image thumbnails for PHP version
* new option `slideTree` to turn off auto slide in


## v0.13.2 - *2011-08-12*

* changes in `/h5ai/.htaccess` ... PHP configuration ...


## v0.13.1 - *2011-08-12*

* fixes initial tree display
* adds sort order option
* adds/fixes some translations
* adds `lv` translation by Sandis Veinbergs


## v0.13 - *2011-08-06*

* adds PHP implementation! (should work with PHP 5.2+)
* adds new options
* changes layout of the bottom bar to display status information
* adds language selector to the bottom bar
* quotes keys in `options.js` to make it valid json
* changes value of option `lang` from `undefined` to `null`
* adds some new keys to `h5aiLangs`
* adds browser caching rules for css and js
* adds `pt` translation by [Jonnathan](https://github.com/jonnsl)
* adds `bg` translation by George Andonov


## v0.12.3 - *2011-07-30*

* adds `tr` translation by [Batuhan Icoz](https://github.com/batuhanicoz)


## v0.12.2 - *2011-07-30*

* adds `es` translation by Jose David Calderon Serrano


## v0.12.1 - *2011-07-29*

* fixes unchecked use of console.log


## v0.12 - *2011-07-28*

* improves performance


## v0.11 - *2011-07-27*

* changes license to MIT license, see `LICENSE.txt`


## v0.10.2 - *2011-07-26*

* improves tree scrollbar


## v0.10.1 - *2011-07-24*

* fixes problems with ' in links


## v0.10 - *2011-07-24*

* fixes problems with XAMPP on Windows (see `dot.htaccess` comments for instructions)
* fixes tree fade-in-fade-out effect for small displays ([issue #6](https://github.com/lrsjng/h5ai/issues/6))
* adds custom scrollbar to tree ([issue #6](https://github.com/lrsjng/h5ai/issues/6))
* fixes broken links caused by URI encoding/decoding ([issue #9](https://github.com/lrsjng/h5ai/issues/9))
* adds "empty" to localization (hope Google Translate did a good job here)


## v0.9 - *2011-07-18*

* links hover states between crumb, extended view and tree
* fixes size of tree view (now there's a ugly scrollbar, hopefully will be fixed)
* refactores js to improve performance and cleaned code
* adds caching for folder status codes and content
* adds `fr` translation by [Nicolas](https://github.com/Nicosmos)
* adds `nl` translation by [Stefan de Konink](https://github.com/skinkie)
* adds `sv` translation by Oscar Carlsson


## v0.8 - *2011-07-08*

* removes slashes from folder labels
* optionally rename parent folder entries to real folder names, see `options.js`
* long breadcrumbs (multiple rows) no longer hide content
* error folder icons are opaque now
* refactores js a lot (again...)


## v0.7 - *2011-07-07*

* removes shadows
* smarter tree side bar


## v0.6 - *2011-07-05*

* refactores js
* adds localization, see `options.js`


## v0.5.3 - *2011-07-04*

* refactores js
* adds basic options support via `options.js`
* adds comments to `options.js`
* adds optional tree sidebar


## v0.5.2 - *2011-07-02*

* details view adjusts to window width
* links icon for *.gz and *.bz2


## v0.5.1 - *2011-07-01*

* disables tree sidebar for now, since it had unwanted side effects


## v0.5 - *2011-07-01*

* adds tree sidebar
* some refactorings


## v0.4 - *2011-06-27*

* adds better fallback, in case JavaScript is disabled
* rewrites js, fixed middle-button click etc. problems
* refactors css
* sorts, adds and moves icons and images
* updates dot.access


## v0.3.2 - *2011-06-24*

* removes lib versions from file names
* adds 'empty' indicator for icons view


## v0.3.1 - *2011-06-24*

* refactores js
* adds `folderClick` and `fileClick` callback hooks
* fixes .emtpy style


## v0.3 - *2011-06-23*

* includes build stuff, files previously found in the base directory are now located in folder `target`
* styles and scripts are now minified
* adds Modernizr 2.0.4 for future use
* updates jQuery to version 1.6.1


## v0.2.3 - *2011-06-17*

* more refactoring in main.js


## v0.2.2 - *2011-06-16*

* refactores a lot, adds some comments
* includes fixes from [NumEricR](https://github.com/NumEricR)
* adds top/bottom message support, only basicly styled


## v0.2.1 - *2011-06-16*

* fixes croped filenames
* fixes missing .png extension in header
* adds some color to the links
* adds changelog


## v0.2 - *2011-06-15*

* adds icon view
