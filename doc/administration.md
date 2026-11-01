# h5ai administration and setup guide

The h5ai diagnostic page (the "info page") is located at `/_h5ai/public/index.php`. It checks system compatibility and shows which optional features are available on the host.

The Docker image exposes `GET /healthz` as a lightweight container health
endpoint. It is handled directly by Angie and does not execute PHP or scan the
served share, so it remains responsive even when a mounted filesystem is slow.
Basic authentication does not protect this endpoint.

> [!NOTE]
> For customizing h5ai's features, icons, view options, search, previews, and translations, see the [Configuration Guide](configuration.md).

## 1. Accessing the info page

The administration and diagnostic page is available at:
```
https://<your-domain>/_h5ai/public/index.php
```
Use `http://` if the server does not provide HTTPS. In Docker, replace
`<your-domain>` with the hostname and port mapped to the container.

With a password configured, the page shows a login form; a wrong password or
a refused attempt is reported on the page. Without one, the page explains how
to set it instead of showing a form that cannot succeed.

## 2. Password configuration (`passhash`)

Access to the Info Page is secured using a password hash defined in the main configuration file [options.json](../src/_h5ai/private/conf/options.json):

```json
"passhash": ""
```

### Changing the password

1. Choose a strong password.
2. Generate a salted bcrypt or Argon2 hash locally:
   ```bash
   php -r 'echo password_hash("yourpassword", PASSWORD_DEFAULT), "\n";'
   ```
3. Open [options.json](../src/_h5ai/private/conf/options.json) and replace the value of `"passhash"` with the generated hash.
4. Save the file. The new password takes effect immediately.

Never send an administrator password to an online hash generator. Legacy
128-character SHA-512 hashes remain readable for compatibility, but are
deprecated: each login with one writes a warning to the PHP error log. Replace
them with a `password_hash()` value.

After 5 failed logins within 15 minutes, h5ai refuses further attempts from
the same client, even with the right password, until the oldest failure is 15
minutes old. Failures are kept as hashed client addresses in
`_h5ai/private/cache/login-failures.json`. The client address is the one the
web server sees: behind a reverse proxy, configure it to pass the real address
(`REAL_IP_FROM` in the Docker image), or every visitor shares the proxy's
budget and failed attempts by anyone delay the administrator.

> [!IMPORTANT]
> Administrator login is disabled while `passhash` is empty. Configure a hash
> before using the diagnostic page. Existing legacy SHA-512 hashes continue to
> work during upgrades.

### Docker password behavior

The Docker image uses the same administration page:
`https://<your-domain>/_h5ai/public/index.php` (or `http://` without TLS).
Set `H5AI_ADMIN_PASSWORD` to a non-empty value to replace the configured
password. The container stores a salted hash created with PHP `password_hash()` and does not
print the password to its logs. The variable is applied on every start, so
changing it changes the admin password on the next restart.

When `H5AI_ADMIN_PASSWORD` is unset or empty, startup keeps the existing `passhash`,
including an empty value. An empty hash leaves admin login disabled until you
configure a password. This also applies to read-only `options.json` mounts. If
the environment variable is non-empty while `options.json` is read-only, startup
fails instead of ignoring the requested password change.

## 3. Web server access control

The `_h5ai/private/` directory contains configuration, password hashes and
caches with filesystem paths. It must not be reachable over HTTP.

* Apache 2.4 applies the bundled `_h5ai/.htaccess` deny rule and grants access
  back only under `_h5ai/public/`. The virtual host must allow these access
  directives with `AllowOverride AuthConfig` (or `AllowOverride All`).
* nginx must include [`server/nginx.conf`](server/nginx.conf) in its server block.
* Angie must include [`server/angie.conf`](server/angie.conf) in its server block.
* lighttpd must include [`server/lighttpd.conf`](server/lighttpd.conf).

After deployment, verify that `/_h5ai/private/conf/options.json` returns 403 or
404 before using the application.

### Served directory

h5ai lists the parent folder of its `_h5ai` folder by default. Set the
`H5AI_ROOT_PATH` environment variable to serve another folder, for example
when `_h5ai` is installed outside the shared tree. PHP must see the variable:
with PHP-FPM, pass it with `env[H5AI_ROOT_PATH] = /path/to/share` in the pool
configuration (the Docker image does this and serves `/share`). The cache
warmer and background refresh scripts read the same variable, so set it for
cron jobs as well.

## 4. Diagnostic tests reference

Once logged in, the page shows how many checks pass, then the checks in three
groups: h5ai, Server and PHP, and Commands. Each row has a green (passed), red
(failed) or grey (information only) marker. Here is what each check verifies
and what to do when it fails.

h5ai caches the command-line tools it finds in `_h5ai/private/cache/cmds.json`. Opening this page while logged in probes them again, so install or remove a tool and reload the page to update the results. Anonymous visits never trigger the probes. The cache is also rebuilt automatically when it lacks a tool that a newer h5ai release checks for. The Docker image deletes `cmds.json` each time the container starts, so a restart or an upgrade probes the tools again even when the private cache is kept on a volume.

### h5ai

* **Version**: Green only when the running version is a tagged release (`X.Y.Z`).
* **Index file**: Information only. Shows the path to add to your web server's directory index list, usually `/_h5ai/public/index.php`. h5ai cannot test this setting from PHP.
* **Options / Types**: Confirm that [options.json](../src/_h5ai/private/conf/options.json) and [types.json](../src/_h5ai/private/conf/types.json) are readable and valid JSON.
* **Public cache**: Verifies the web server has write access to `_h5ai/public/cache/`.
* **Private cache**: Verifies the web server has write access to `_h5ai/private/cache/`.

> [!IMPORTANT]
> If either cache check fails, resolve it by granting write permissions to the web server user (typically `www-data` or `nginx`):
> ```bash
> chmod -R 775 _h5ai/public/cache _h5ai/private/cache
> chown -R www-data:www-data _h5ai/public/cache _h5ai/private/cache
> ```

### Server and PHP

* **Web server**: Detects if your web server is Apache, lighttpd, nginx, Cherokee or Angie, and shows its name and version.
* **PHP version**: Shows the PHP version. h5ai refuses to start below `8.4.0`, so this check cannot fail on a running page.
* **PHP architecture**: Checks if PHP is running as `64-bit`. A 64-bit PHP runtime is required to display files and folder sizes greater than 2GB correctly.
* **GD with WebP**: Checks if the `GD` library is installed and compiled with `WebP` support. Required for all thumbnails.
* **EXIF**: Checks for the PHP `exif` module. When active, h5ai detects image types and, with `thumbnails.exif`, extracts embedded JPEG preview thumbnails from photos instead of decoding the full image, which is much faster.
* **Fileinfo**: Checks if the PHP Fileinfo module is active (used to detect the type of a file whose name does not tell it).
* **Zip / Rar**: Check for the PHP `Zip` and `Rar` extensions, used to make thumbnails from images inside archives.
* **SQLite3**: Checks for the PHP `sqlite3` extension, used by the thumbnail cache.

### Commands

* **Video thumbnails**: Verifies command line program `ffmpeg` or `avconv` is installed on the host, and shows the one h5ai uses (`ffmpeg` first). Required to capture frame previews from videos.
* **Document thumbnails**: Shows the tool h5ai uses for PDF and PostScript files, and verifies hardened ImageMagick is installed: `magick` (ImageMagick 7), or `convert` on ImageMagick 6 hosts. h5ai uses `magick` whenever it is available. Rendering PDF and PostScript files also needs Ghostscript (`gs`), which this check does not detect; the Docker image includes it. GraphicsMagick is available only as an explicit compatibility fallback with `thumbnails.allowGraphicsMagick`; it does not use the bundled security policy.

> [!NOTE]
> **Media-processor hardening (SSRF/LFI).** Because thumbnails are generated from user-supplied files, h5ai applies defense-in-depth against crafted media that tries to make the processor reach the network or read arbitrary local files:
> - `ffmpeg`/`avconv` are invoked with `-protocol_whitelist file,crypto,data`, blocking remote (e.g. HLS/concat/playlist) fetches.
> - A restrictive ImageMagick policy is shipped at `_h5ai/private/conf/magick/policy.xml` and activated via the `MAGICK_CONFIGURE_PATH` environment variable (set automatically; it applies to the Imagick PHP extension and to `magick`/`convert`). It disables risky coders (`URL`, `HTTPS`, `MSL`, `SVG`, `MVG`, `EPHEMERAL`, ...) and external delegates, with one exception: `PDF`/PostScript stay readable and the Ghostscript delegate stays enabled so the documented `doc` thumbnails keep working. GraphicsMagick `gm` does not read this policy and is therefore disabled by default. Do not enable it or relax the policy unless you fully trust every file served. You can verify the ImageMagick policy with `MAGICK_CONFIGURE_PATH=/path/to/_h5ai/private/conf/magick magick -list policy`.

* **tar / zip**: Check if system commands `tar` and `zip` are available. Recommended for fast packaged downloads.
* **du**: Checks if system command `du` is available. Required if foldersize calculation type is set to `"shell-du"` in `options.json`.

### Background tasks and cache

Below the checks, the page shows figures read from the caches. **Refresh**
reads them again without reloading the page. They contain counts, sizes and
dates only, never a path of the share, and only an admin session gets them.

* **Cache warmer**: whether it is running (with its progress), how often it
  runs (`cache.warmInterval`) and when the next run is due. Disabled while
  `cache.warmAtStartup` is off.
* **Last warm run**: when the last run ended, how long it took, how many files
  it walked and how long the folder sizes took.
* **Folder size refresh**: the background worker that recomputes expired
  folder sizes after a listing, and its last run.
* **Thumbnail files**: the space used by `_h5ai/public/cache/thumbs`, the
  number of files and of source files (one source can have several sizes).
* **Images, Videos, Documents, Archives, Audio**: how many files of each kind
  have a thumbnail, against the files of that kind in the share. The cache
  warmer counts them while it walks the share, so the figures date from its
  last run and stay unknown until a run with thumbnails enabled. Counting on
  each visit of this page would take as long as the warmer itself.
* **Thumbnail database**: the size of `thumbs_cache.db` and the number of
  source files it records.
* **Folder sizes**: entries of `foldersizes.json`, how many are still served
  (younger than 5 minutes) and its size on disk.

## 5. Troubleshooting command line utilities

If a CLI-based tool (like `ffmpeg`, `magick`, `zip`, `tar`, or `du`) shows a failure status, verify that:
1. The binary is installed on the host system (e.g., via `apt install ffmpeg imagemagick zip tar`).
2. The web server process user has permission to execute the binary.
3. Your PHP configuration has **not** disabled command execution functions (such as `exec` or `passthru`) in your `php.ini`:
   ```ini
   disable_functions = 
   ```
