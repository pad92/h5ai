# h5ai administration and setup guide

The h5ai diagnostic page (the "info page") is located at `/_h5ai/public/index.php`. It checks system compatibility and shows which optional features are available on the host.

> [!NOTE]
> For customizing h5ai's features, icons, view options, search, previews, and translations, see the [Configuration Guide](configuration.md).

## 1. Accessing the info page

To open the h5ai diagnostic interface, navigate to:
```
http://<your-server>/_h5ai/public/index.php
```

By default, when you visit this page, you will see a login prompt.

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
128-character SHA-512 hashes remain readable for compatibility, but should not
be used for new installations.

> [!IMPORTANT]
> Administrator login is disabled while `passhash` is empty. Configure a hash
> before using the diagnostic page. Existing legacy SHA-512 hashes continue to
> work during upgrades.

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

## 4. Diagnostic tests reference

Once logged in, the page displays a series of checks covering core features and optional extensions. Here is what each test verifies and what to do when it fails.

### Core checks

* **h5ai version**: Checks if the running version matches an official release format.
* **Index file found**: Verifies that your web server directory index configuration includes `_h5ai/public/index.php`.
* **Options/Types parsable**: Confirms that [options.json](../src/_h5ai/private/conf/options.json) and [types.json](../src/_h5ai/private/conf/types.json) contain valid JSON.
* **Server software**: Detects if your web server is Apache, Lighttpd, Nginx, Cherokee, or Angie.
* **PHP version**: Checks that PHP is at least version `8.4.0`.
* **PHP arch**: Checks if PHP is running as `64-bit`. A 64-bit PHP runtime is required to display files and folder sizes greater than 2GB correctly.

### Permission checks

* **Public Cache directory**: Verifies the web server has write access to `_h5ai/public/cache/`.
* **Private Cache directory**: Verifies the web server has write access to `_h5ai/private/cache/`.

> [!IMPORTANT]
> If either Cache directory check fails, resolve it by granting write permissions to the web server user (typically `www-data` or `nginx`):
> ```bash
> chmod -R 775 _h5ai/public/cache _h5ai/private/cache
> chown -R www-data:www-data _h5ai/public/cache _h5ai/private/cache
> ```

### Media and thumbnail checks

* **Image thumbs**: Checks if the `GD` library is installed and compiled with `WebP` support.
* **Fileinfo module**: Checks if the PHP Fileinfo module is active (used for determining file MIME types safely).
* **Use EXIF thumbs**: Checks for the PHP `exif` module. When active, h5ai extracts embedded JPEG preview thumbnails from photos directly instead of decoding the full image, which is much faster.
* **Video thumbs**: Verifies command line program `ffmpeg` or `avconv` is installed on the host. Required to capture frame previews from videos.
* **PDF thumbs**: Verifies hardened ImageMagick `convert` is installed. GraphicsMagick is available only as an explicit compatibility fallback with `thumbnails.allowGraphicsMagick`; it does not use the bundled security policy.

> [!NOTE]
> **Media-processor hardening (SSRF/LFI).** Because thumbnails are generated from user-supplied files, h5ai applies defense-in-depth against crafted media that tries to make the processor reach the network or read arbitrary local files:
> - `ffmpeg`/`avconv` are invoked with `-protocol_whitelist file,crypto,data`, blocking remote (e.g. HLS/concat/playlist) fetches.
> - A restrictive ImageMagick policy is shipped at `_h5ai/private/conf/magick/policy.xml` and activated via the `MAGICK_CONFIGURE_PATH` environment variable (set automatically; it applies to the Imagick PHP extension and `convert`). It disables risky coders (`URL`, `HTTPS`, `MSL`, `SVG`, `MVG`, `EPHEMERAL`, ...) and external delegates, with one exception: `PDF`/PostScript stay readable and the Ghostscript delegate stays enabled so the documented `doc` thumbnails keep working. GraphicsMagick `gm` does not read this policy and is therefore disabled by default. Do not enable it or relax the policy unless you fully trust every file served. You can verify the ImageMagick policy with `MAGICK_CONFIGURE_PATH=/path/to/_h5ai/private/conf/magick magick -list policy`.

### Utility checks

* **Zip/Rar module**: Checks for PHP `Zip` and `Rar` extensions. Required for on-the-fly archive previewing.
* **SQLite3 module**: Checks for PHP `sqlite3` extension. Required for caching failed thumbnail/archive parsing states.
* **Shell tar / Shell zip**: Checks if system commands `tar` and `zip` are available. Recommended for fast packaged downloads.
* **Shell du**: Checks if system command `du` is available. Required if foldersize calculation type is set to `"shell-du"` in `options.json`.

## 5. Troubleshooting command line utilities

If a CLI-based tool (like `ffmpeg`, `convert`, `zip`, `tar`, or `du`) shows a failure status, verify that:
1. The binary is installed on the host system (e.g., via `apt install ffmpeg imagemagick zip tar`).
2. The web server process user has permission to execute the binary.
3. Your PHP configuration has **not** disabled command execution functions (such as `exec` or `passthru`) in your `php.ini`:
   ```ini
   disable_functions = 
   ```
