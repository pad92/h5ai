# h5ai (pad92 fork)

[![license][license-img]][github] [![github][github-img]][github]

A modern HTTP web server index for Apache httpd, lighttpd, nginx, and Angie.

This repository is a detached fork of the original [h5ai](https://github.com/lrsjng/h5ai) project by Lars Jung, which is no longer maintained. This fork keeps it going with updated dependencies, bug fixes, and compatibility with modern PHP.


## Important

* Do **not** install any files from the `src` folder, they need to be
  preprocessed to work correctly!
* Find a preprocessed package on the [GitHub releases page][github-releases].
* For bug reports and feature requests please use [issues][github-issues].


## Requirements

### Runtime (Server-side)
* PHP `8.4.0+`
* Web server (Apache httpd `2.4+` with `mod_authz_core` (loaded by default), lighttpd, nginx, cherokee, Angie, etc.)
* PHP extensions (depending on enabled features):
  * `GD` (required for default WebP image thumbnails, WebP support must be enabled)
  * `Imagick` (recommended for optimized high-performance image resizing, WebP support must be enabled)
  * `exif` (recommended for EXIF rotation and fast thumbnail extraction)
* Command-line helpers (optional):
  * `ffmpeg` or `avconv` (for video thumbnails)
  * ImageMagick (`convert`) (for hardened PDF/document thumbnails; GraphicsMagick is an opt-in compatibility fallback)
  * `tar` and `zip` (for packaged downloads)
  * `du` (for folder size calculation)

### Build-time (Development)
* Node.js `18.18+` and npm (for building the project)

> [!IMPORTANT]
> `_h5ai/private/` must never be served as static content. Apache applies the
> bundled `.htaccess` rules when `AllowOverride` permits them. nginx, lighttpd
> and Angie require the matching deny rules from [`doc/server/`](doc/server/)
> to be included in the virtual host before h5ai is exposed.


## Build

There are installation ready packages on the [GitHub releases page][github-releases]. But to build **h5ai** yourself either `git clone` or
download the repository. From within the root folder run the following
commands to find a fresh zipball in folder `build` (tested on linux only,
might work on other configurations):

~~~sh
> npm ci
> npm run build
~~~


## Docker Image

A ready-to-use Docker image is published to Docker Hub as [`pad92/docker-h5ai`][dockerhub].
It runs on Angie 1.11+ (Alpine) and PHP 8.4, with s6-overlay as the process supervisor.

[![Docker Pulls](https://img.shields.io/docker/pulls/pad92/docker-h5ai.svg)](https://hub.docker.com/r/pad92/docker-h5ai/)

```bash
# Basic usage — mount the directory to share at /share
docker run -d -p 80:80 \
  -v /path/to/files:/share \
  pad92/docker-h5ai:latest
```

```bash
# With basic authentication
docker run -d -p 80:80 \
  -e ENV_U=admin -e ENV_P=mysecretpassword \
  -v /path/to/files:/share \
  pad92/docker-h5ai:latest
```

A `docker-compose.yml` example is included for convenience. See
[`CHANGELOG.docker.md`](CHANGELOG.docker.md) for the Docker image changelog.

[dockerhub]: https://hub.docker.com/r/pad92/docker-h5ai


## Configuration

For detailed information on configuring **h5ai**, including options, file types, and localization, see the [Configuration Guide](doc/configuration.md).


## License

The MIT License (MIT)

Copyright (c) 2020 Lars Jung (https://larsjung.de)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.


## References

**h5ai** profits from other projects, all of them licensed under the MIT license
too. Exceptions are the icons from [Font Awesome Free][fontawesome] (CC BY 4.0),
the [Ubuntu and Ubuntu Mono fonts][fontsource-ubuntu] (Ubuntu Font License 1.0),
and [movi-player][movi-player] (Apache-2.0), all self-hosted with no runtime
dependency on fonts.googleapis.com or any other external host.


[github]: https://github.com/pad92/h5ai
[github-issues]: https://github.com/pad92/h5ai/issues
[github-releases]: https://github.com/pad92/h5ai/releases
[fontawesome]: https://fontawesome.com
[fontsource-ubuntu]: https://fontsource.org/fonts/ubuntu
[movi-player]: https://github.com/mrujjwalg/movi-player

[license-img]: https://img.shields.io/badge/license-MIT-a0a060.svg?style=flat-square
[github-img]: https://img.shields.io/badge/github-pad92/h5ai-a0a060.svg?style=flat-square
