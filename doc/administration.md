# h5ai Administration & Setup Guide

The h5ai diagnostic page (commonly referred to as the **Info Page**) is located at `/_h5ai/public/index.php`. It helps administrators check system compatibility, verify optional extension requirements, and manage the health of their h5ai installation.

> [!NOTE]
> For customizing h5ai's features, icons, view options, search, previews, and translations, see the [Configuration Guide](configuration.md).

---

## 1. Accessing the Info Page

To open the h5ai diagnostic interface, navigate to:
```
http://<your-server>/_h5ai/public/index.php
```

By default, when you visit this page, you will see a login prompt.

---

## 2. Password Configuration (`passhash`)

Access to the Info Page is secured using a password hash defined in the main configuration file [options.json](../src/_h5ai/private/conf/options.json):

```json
"passhash": "cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e"
```

### Changing the Password

1. Choose a strong password.
2. Generate its **SHA-512** hash. You can do this:
   - On the Linux command line:
     ```bash
     echo -n "yourpassword" | sha512sum
     ```
   - Using online hash generators.
3. Open [options.json](../src/_h5ai/private/conf/options.json) and replace the value of `"passhash"` with the generated 128-character hex string.
4. Save the file. The new password takes effect immediately.

> [!NOTE]
> The default password hash `cf83e...` corresponds to an **empty string**. If you have not customized this yet, you can log in by leaving the password field empty and clicking **login**. A warning notice is displayed on the screen until you customize the password.

---

## 3. Diagnostic Tests Reference

Once logged in, the page displays a series of checks categorized into core features and optional extensions. Below is a guide to what each test verifies and how to address failure states:

### Core Checks

* **h5ai version**: Checks if the running version matches an official release format.
* **Index file found**: Verifies that your web server directory index configuration includes `_h5ai/public/index.php`.
* **Options/Types parsable**: Confirms that [options.json](../src/_h5ai/private/conf/options.json) and [types.json](../src/_h5ai/private/conf/types.json) contain valid JSON.
* **Server software**: Detects if your web server is Apache, Lighttpd, Nginx, or Cherokee.
* **PHP version**: Checks that PHP is at least version `7.0.0` or higher.
* **PHP arch**: Checks if PHP is running as `64-bit`. A 64-bit PHP runtime is required to display files and folder sizes greater than 2GB correctly.

### Permission Checks

* **Public Cache directory**: Verifies the web server has write access to `_h5ai/public/cache/`.
* **Private Cache directory**: Verifies the web server has write access to `_h5ai/private/cache/`.

> [!IMPORTANT]
> If either Cache directory check fails, resolve it by granting write permissions to the web server user (typically `www-data` or `nginx`):
> ```bash
> chmod -R 775 _h5ai/public/cache _h5ai/private/cache
> chown -R www-data:www-data _h5ai/public/cache _h5ai/private/cache
> ```

### Media & Thumbnail Checks

* **Image thumbs**: Checks if the `GD` library is installed and compiled with `WebP` support.
* **Fileinfo module**: Checks if the PHP Fileinfo module is active (used for determining file MIME types safely).
* **Use EXIF thumbs**: Checks for the PHP `exif` module. When active, h5ai extracts embedded JPEG preview thumbnails from photos directly, resulting in massive speedups.
* **Video thumbs**: Verifies command line program `ffmpeg` or `avconv` is installed on the host. Required to capture frame previews from videos.
* **PDF thumbs**: Verifies `convert` (ImageMagick) or `gm` (GraphicsMagick) is installed on the host. Required to generate thumbnails for PDF/postscript documents.

### Utility Checks

* **Zip/Rar module**: Checks for PHP `Zip` and `Rar` extensions. Required for on-the-fly archive previewing.
* **Shell tar / Shell zip**: Checks if system commands `tar` and `zip` are available. Recommended for fast packaged downloads.
* **Shell du**: Checks if system command `du` is available. Required if foldersize calculation type is set to `"shell-du"` in `options.json`.

---

## 4. Troubleshooting Command Line Utilities

If a CLI-based tool (like `ffmpeg`, `convert`, `zip`, `tar`, or `du`) shows a failure status, verify that:
1. The binary is installed on the host system (e.g., via `apt install ffmpeg imagemagick zip tar`).
2. The web server process user has permission to execute the binary.
3. Your PHP configuration has **not** disabled command execution functions (such as `exec` or `passthru`) in your `php.ini`:
   ```ini
   disable_functions = 
   ```
