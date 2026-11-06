# h5ai configuration guide

All configuration files for **h5ai** are located in the `_h5ai/private/conf/` directory. This guide explains how to customize and configure the application by modifying these files.

> [!NOTE]
> For information on server requirements, permissions, command line utilities, and the diagnostic Info Page, see the [Administration Guide](administration.md).

## Files overview

- `options.json`: The main configuration file containing display options, enabled extensions, and general behavior settings.
- `types.json`: Associates file patterns (globs) to specific file types (e.g., mapping `*.zip` to `ar-zip`).
- `l10n/`: Directory containing translation files for localized UI strings and date formatting.

## 1. Options configuration (`options.json`)

Located at [options.json](../src/_h5ai/private/conf/options.json).

> [!NOTE]
> `options.json` must be valid strict JSON. While h5ai's internal PHP parser can handle `/* ... */` block comments, external tools (linters, security scanners) may reject them.

### General options

| Option / Section | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `passhash` | `string` | `""` | Hash of the password for the h5ai info page (`/_h5ai/public/index.php`). Login is disabled while empty. Generate a modern salted hash with PHP `password_hash()` (bcrypt/argon2), e.g. `php -r 'echo password_hash("yourpass", PASSWORD_DEFAULT), "\n";'`. Legacy 128-character SHA-512 digests are accepted only for upgrade compatibility. |
| `resources.scripts` | `array` | `[]` | List of URLs or paths of custom scripts to inject into every page. Paths not starting with `http://`, `https://` or `/` are relative to `_h5ai/public/ext/`. |
| `resources.styles` | `array` | `[]` | List of URLs or paths of custom stylesheets to inject. |

### View options (`view`)

Customize the general look and feel of the index page.

| Key | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `binaryPrefix` | `boolean` | `false` | If `true`, uses IEC binary prefixes (1024 B = 1 KiB) for file sizes. If `false`, uses SI decimal prefixes (1000 B = 1 KB). |
| `disableSidebar` | `boolean` | `false` | Hides the sidebar and its toggle button entirely. |
| `fallbackMode` | `boolean` | `false` | Serves h5ai in fallback mode (useful for browsers without JS or very old browsers). |
| `fastBrowsing` | `boolean` | `true` | Uses the HTML5 History API to navigate folders without reloading the whole page. |
| `fonts` | `array` | `["Ubuntu", ...]` | Font family names for normal text. Ubuntu ships self-hosted (no `fonts.googleapis.com` request); other names fall back to whatever the browser/OS provides. |
| `fontsMono` | `array` | `["Ubuntu Mono", ...]` | Font family names for monospace text. Ubuntu Mono ships self-hosted; other names fall back to whatever the browser/OS provides. |
| `hidden` | `array` | `["^\\.", "^_h5ai", ...]` | Regular expressions (PCRE) matching files and folders to leave out of listings, search, archives and thumbnails. Each pattern is tested against the name and against the URL path, so anchor it with `^...$` to match a whole name: `ads.txt` alone would also hide `downloads.txt`. Prefix it with `(?i)` to ignore case. The defaults hide dot-prefixed names, `_h5ai`, `robots.txt`, `ads.txt`, and the metadata that operating systems and NAS systems leave in shared folders (see below). Other names beginning with `_` remain visible unless you add a matching pattern. Hiding is not access control: the web server still serves a hidden file to anyone who knows its URL. |
| `hideFolders` | `boolean` | `false` | Hides all folders from the main file listing and from the matches of the search field. |
| `hideIf403` | `boolean` | `true` | Hides files/folders that are unreadable by the web server (avoiding 403 Forbidden errors). |
| `hideParentFolder` | `boolean` | `false` | Hides the link to navigate to the parent folder. |
| `maxIconSize` | `number` | `40` | Maximum icon size in pixels. |
| `modes` | `array` | `["details", "grid", "icons"]` | Enabled view modes. The first one is the default. If only one is specified, the selector is hidden. The user's selection is stored in browser local storage. |
| `modeToggle` | `boolean`/`string` | `false` | Shows a toggle button for view modes in the toolbar. Can be `"next"`. |
| `setParentFolderLabels`| `boolean` | `true` | Shows the actual parent folder name instead of just "Parent Folder". |
| `sizes` | `array` | `[20, 40, ...]` | List of selectable icon/row sizes. The smallest one is the default. If only one is specified, the selector is hidden. The user's selection is stored in browser local storage. |
| `theme` | `string` | `"default"` | Name of the folder under `_h5ai/public/images/themes` to use for file icons. |
| `unmanaged` | `array` | `["index.html", ...]` | If a folder contains any of these files, h5ai will not manage it, allowing default index pages to load instead. |
| `unmanagedInNewWindow` | `boolean` | `false` | Opens unmanaged folder links in a new window/tab. |

The default `hidden` list covers:

| Source | Names |
| :--- | :--- |
| Windows | `Thumbs.db`, `ehthumbs.db`, `ehthumbs_vista.db`, `desktop.ini`, `$RECYCLE.BIN`, `System Volume Information` (any case for the first four) |
| macOS | `.DS_Store`, `._*` files (dot-prefixed), `Icon\r` (custom folder icon), `__MACOSX` (left by ZIP extraction) |
| Linux | `lost+found` |
| Synology | `@eaDir` (indexing thumbnails), `#recycle`, `#snapshot` |
| QNAP | `.@__thumb` (dot-prefixed), `@Recycle`, `@Recently-Snapshot` |

A custom `options.json` replaces the whole list: copy the default entries
into it before adding your own.

### Cache options (`cache`)

Configure automatic background cache warming for thumbnails, folder sizes and the search index.

| Key | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `warmAtStartup` | `boolean` | `true` | If `true`, a request starts the cache warmer in the background when it has not run for `warmInterval` seconds. The warmer walks the whole share, creates missing thumbnails, computes folder sizes and updates the search index. The first run on a large share can keep the CPU and disks busy for a while; later runs read the tree again. Set it to `false` to keep disks idle, and run the warmer from a scheduled task instead (see below). |
| `warmInterval` | `number` | `86400` | The execution interval in seconds for the background cache warmer (default is 24 hours). |

Older releases named these options `warm_at_startup` and `warm_interval`; those names are still read when the new ones are absent.

> [!TIP]
> **Manual execution and low priority (`nice`)**
> You can also run the cache warmer manually or via a system cron job using:
> `nice -n 19 php _h5ai/private/php/warm-cache.php`
> The task is executed with low scheduling priority to prevent resource starvation.
> 
> **How invalidation works**
> The computed folder sizes are saved in `_h5ai/private/cache/foldersizes.json`, one entry per folder with its direct subfolders. Each entry expires after five minutes and stays in the file until a refresh replaces it. When a folder is computed again, the entries of its subfolders that no longer exist are removed with everything below them. When the cache warmer reads an entry, a change in the entries of that folder or of any folder below it invalidates it; changes to an existing file may not change its directory's `mtime`, so those are picked up when the entry expires. Initial HTML, API listings and search results never compute a folder size: they show the cached size, and hand missing or expired entries to a background refresh. An expired size blinks slowly until the refresh replaces it (with reduced motion enabled in the browser, it is dimmed instead). A folder without any entry shows no size until a refresh succeeds. Regular file sizes use the metadata already read for each item and remain available for display and sorting. Only the cache warmer and the background refresh worker compute folder sizes. Ordinary directory and metadata reads can still block on an unavailable mount.
>
> The search index is saved in `_h5ai/private/cache/search-index.txt`, with `search-index.tree` next to it for the refresh. A search reads the index instead of walking the share, which matters on NFS or SMB mounts, and checks only its matches on disk. A deleted file, or the old name of a renamed one, is never returned, and with `view.hideIf403` each match must still be readable. A new file shows up after the next refresh. The cache warmer refreshes the index after its walk, and a search starts a background refresh once the index is older than `search.indexTtl` (five minutes by default). A refresh reads the modification time, change time and permission bits of every folder, and lists again only the folders that changed. When the index is missing, or was written for another configuration or by another user, searches walk the share and request a refresh. The index does not follow symlinked folders, so a search started from inside one walks it. The refresh refuses to run as root, since it could index names the web server cannot read. Run the cache warmer from cron as the web server user, for example `sudo -u www-data nice -n 19 php _h5ai/private/php/warm-cache.php`. In the Docker image that user is `angie`, and `docker exec` runs as root unless told otherwise: use `docker exec -u angie h5ai nice -n 19 php /usr/share/h5ai/_h5ai/private/php/warm-cache.php`.
>
> **Thumbnail lifetime**
> Thumbnails in `_h5ai/public/cache/thumbs/` never expire. Each one carries the modification time of its source, and is regenerated as soon as the two differ, even when the source got older (`cp -p`, a restored backup). At the end of each pass, the cache warmer deletes the thumbnails and `thumbs_cache.db` entries of sources that no longer exist. A source counts as gone only when its closest existing folder is readable, and nothing is deleted while the root folder is empty or unreadable (an unmounted share). The warmer learns the source of an older thumbnail when a pass meets that source again, so the thumbnails of files deleted before that pass stay until the thumbnail folder is emptied by hand.

### Extensions configuration

Each extension under `options.json` can be enabled or disabled and has specific parameters.

#### `autorefresh`
Automatically refreshes the current folder contents at a defined interval.
- `enabled` (default: `true`): Enable autorefresh.
- `interval` (default: `5000`): Refresh interval in milliseconds (minimum is `1000`). A page in a background tab sends no request; it refreshes once when it becomes visible again, if a refresh was due. With autorefresh disabled, a folder showing expired folder sizes still refreshes every five seconds until they are recomputed, for at most five minutes.

#### `crumb`
Shows a clickable breadcrumb navigation at the top of the page.
- `enabled` (default: `true`).

#### `custom`
Allows custom header and footer files to be automatically rendered above or below the directory listings.
It searches for files named `_h5ai.header.html` and `_h5ai.footer.html` in the current folder, or recursively checks parent directories for `_h5ai.headers.html` and `_h5ai.footers.html`.
If the files end in `.md`, they are rendered as Markdown.
- `enabled` (default: `true`).

The search for `headers`/`footers` files always stops at the web root folder.
Custom files must resolve to regular, readable files inside the shared root,
outside h5ai's public and private directories. Symlinks to other locations are
ignored. Custom filenames may remain hidden from directory listings.

#### `download`
Allows packaging and downloading of selected directory entries.
- `enabled` (default: `true`).
- `type` (default: `"shell-zip"`): The type of archiving:
  - `"php-tar"`: uses h5ai's streaming PHP TAR writer (no external dependency).
    Long names and paths use POSIX PAX headers, preserving them without truncation.
  - `"shell-tar"`: uses the `tar` command line tool.
  - `"shell-zip"`: uses the `zip` command line tool (`apt install zip`).
- `packageName` (default: `null`): The default name of the archive package. If `null`, uses the current file or folder name.
- `alwaysVisible` (default: `false`): If `true`, the download button is always visible (downloads the entire folder if nothing is selected).
- `maxEntries` (default: `10000`): Maximum number of files and folders in one archive request.
- `maxBytes` (default: `10737418240`): Maximum total file size in bytes for one archive request.
- `timeout` (default: `300`): Maximum archive execution time in seconds.

#### `filter`
Filters the current folder as you type in the search field of the toolbar, without asking the server. Under the filtered listing, a line (or the Enter key) searches the subfolders for the same text when `search` is enabled too; when nothing in the folder matches, they are searched without either, once the typing pauses for `search.debounceTime`. Escape clears and closes the field. With `filter` disabled and `search` enabled, the field searches the subfolders as you type.
- `enabled` (default: `true`).
- `advanced` (default: `true`): If `true`, each word matches a name holding its characters in that order (e.g., "ab" matches "axb"), and a name must match every word, in any order: `photos 2024` finds `2024-06 Photos.zip`. Prefixing a query with `re:` enables regex search.
- `debounceTime` (default: `100`): Debounce wait time in milliseconds before filtering.
- `ignorecase` (default: `true`): Case-insensitive filtering.

#### `foldersize`
Calculates and displays the sizes of directories.
> [!WARNING]
> Listings never wait for a folder size: they show the cached ones, and a background worker measures the rest. On large or slow storage, that worker and the cache warmer can still put a heavy load on the disks.
- `enabled` (default: `true`).
- `type` (default: `"shell-du"`): Can be `"php"` (slow, adds up sizes of files recursively in PHP) or `"shell-du"` (uses command line `du`, faster but still potentially expensive).
- `backgroundTimeout` (default: `900`, maximum: `3600`): Maximum runtime in seconds of the `du` passes started by the CLI cache warmer and the background refresh worker. The cache warmer measures the whole share with a single `du` pass, so this limit must cover a full pass. No php-fpm limit applies to these workers, and cutting a genuinely large tree short would leave it permanently uncached and retried on every pass. Raise it if a full pass over your share needs longer.
> [!NOTE]
> A timeout only helps when the storage is slow. If a network mount hangs outright, the kernel leaves `du` in uninterruptible I/O where no signal can reach it, and plain directory reads block the same way, so h5ai cannot recover on its own and neither can PHP-FPM. The mount itself has to be repaired. NFS does offer `soft`, which makes calls fail instead of hang, but `nfs(5)` warns that it can cause silent data corruption, so it is not a general recommendation.

#### `info`
Shows an informational sidebar displaying file/folder details on hover or select.
- `enabled` (default: `true`).
- `show` (default: `false`): Shows the sidebar by default for first-time visitors.
- `qrcode` (default: `true`): Generates and displays a QR code for the hovered/selected file URL.
- `qrFill` (default: `"#212121"`): QR code fill color.
- `qrBack` (default: `"#fff"`): QR code background color.
- `qrFillDark`, `qrBackDark` (default: `"#212121"`, `"#e0e0e0"`): the same colors in the dark theme. Keep dark modules on a light background in both themes: many scanners do not read inverted codes.

#### `l10n`
Configures localization and language preferences.
- `enabled` (default: `true`).
- `lang` (default: `"en"`): The default fallback language code (refer to translations in `l10n` folder).
- `useBrowserLang` (default: `true`): Try to automatically detect and use the client's browser language.

#### `piwik-analytics`
Integrates Piwik (Matomo) tracking code.
- `enabled` (default: `false`).
- `baseURL` (default: `""`): The base URL to the Piwik instance, without protocol.
- `idSite` (default: `1`): The site ID configured in Piwik.

#### `preview-aud`
Enables the player bar: clicking an audio file plays it alone, in place of the queue. Each audio row gets four buttons: Play now (the same as the click), Play folder from here (the audio files listed in its folder become the queue, starting with this one), Play next and Add to queue.

The browser keeps the queue, the current entry and its position, the volume, shuffle and repeat (`localStorage`, key `ext/player`). The next page or visit brings them back, paused: browsers start no sound without a click. Closing the player forgets the queue. Each browser keeps its own; with several tabs, the last change wins.

The list button on the right of the player bar opens the queue, a card above the bar. It lists the entries in the order they play, the shuffled order while shuffle is on, and a click on one plays it. The handle at the left of a row moves it: drag it with the mouse or a finger, or focus it and use the arrow keys, Home and End. Delete on the handle, or the cross at the right, removes the row. Escape closes the card.

The card's Export button (the download icon) downloads the queue as an extended M3U playlist (`.m3u8`, UTF-8) with absolute URLs, to open in an external player. See [Playing the queue in an external player](#playing-the-queue-in-an-external-player).

Shuffle plays every entry of the queue once, in a random order; previous goes back through that order, which ends like the queue does unless repeat is on.

When `preview-vid` is enabled, video rows get the same four buttons and videos share the queue with audio files. A queued video plays in the preview; when it ends, the queue moves on, back to the bar for a track or to the next video in the open preview. Closing that preview pauses the queue, and the bar's play button opens it again from the start. A preview you are browsing is never replaced: a video reached meanwhile waits, paused, for the play button. A plain click on a video still opens the regular preview. Play now on a video plays it alone; Play folder from here queues the videos of its folder, and on a track the tracks of its folder. Volume and mute in the bar apply to tracks only; videos keep their own controls.
- `enabled` (default: `true`).
- `autoplay` (default: `true`): Start playback when an audio file is clicked. With `false`, the click loads the file into the player bar, paused; the row's Play now button still starts it.
- `types` (default: `["aud"]`): File types (configured in `types.json`) handled by the player.

A file the browser reports it cannot play (WMA, RealAudio and MIDI, and AIFF outside Safari) keeps its plain link and stays out of the queue. A file that fails during playback is marked in the bar, and the queue moves on to the next one.

The cover shown in the bar comes from the file's server thumbnail, then from the picture embedded in the file (MP3 ID3 tag, FLAC picture block), then from an image named `cover`, `folder`, `front`, `album`, `albumart` or `poster` in the same folder.

For a track, a click on the bar's cover (or Enter on it) opens the now playing view over the whole page: the cover in full over a blurred copy of it, then the title, artist, album, year, genre and track number read from the file's tags (ID3 for MP3, Vorbis comments for FLAC), and the duration, format, average bit rate, size and file name. Missing tags fall back to the file name and the folder. The view follows the queue. The player is either large or small: the view takes the bar's controls in at its bottom, and the bar's own cover and title are hidden while it is open. The button at its top left or Escape reduce it. A video has no such view: it plays in the preview, and while a video is shown there the track pauses and the bar hides until the preview closes or shows something else.

Tracks also get a visualizer in the now playing view, in place of the large cover, drawn on a square of 151 pixels scaled up without smoothing. A click on the cover (or Enter on it) shows the visualizer and the next one shows the cover again; the menu below the cover picks which visualizer. The view opens on the cover, and the browser keeps the choice. The bar has no visualizer. The menu groups them:

- **Winamp**: the spectrum analyser of the first Winamp releases, 38 log-spaced bands from 40 Hz to 16 kHz with falling peaks in the classic skin's colours, in its three styles: normal (coloured by height on the screen), fire (red at the top of every bar) and line (each bar in the colour of its top). A fourth entry draws 151 thin bands. The oscilloscope draws the wave as lines, dots, or solid from the middle line.
- **Meters**: a spectrogram, where each frame adds a column on the right with the bass at the bottom, so about five seconds stay on screen; two VU meters, left above and right below, calibrated with 0 VU at -18 dBFS (EBU R68) on a scale from -20 to +3 VU and a needle that reaches 99 % of a new level in 300 ms; and a stereo vectorscope, where a mono track draws a vertical line and a channel out of phase a horizontal one. The meters read each channel separately; a mono track drives both.
- **Psychedelic**: a plasma of sine waves, a kaleidoscope of the spectrum mirrored into eight sectors, and a vortex of the wave bent into a ring, the last two over trails of their previous frames, turned and zoomed. The music speeds their colours and their motion up but never changes their brightness, so a beat swells instead of flashing. When the system asks for reduced motion, they are left out of the menu.

The visualizers read the sound through Web Audio analysers, connected the first time a mode other than the cover is chosen: until then the track does not go through Web Audio at all. The main analyser uses a 4096-sample FFT (bins of about 11 Hz); bass bands narrower than a bin read the spectrum between the two nearest bins, so neighbouring bars never move as one. The analysers need the browser's audio context, which starts with a click; until it does, the track plays without visualizer, and a context the browser suspends later (a call, a locked screen) is resumed while the track plays and on the next play. They cost little: the frequency analysis runs in the browser's native code, the canvas holds about 23,000 pixels, at most 30 frames a second are drawn, and nothing runs while paused, in a hidden tab, with the cover shown or the view reduced, or during a video.

##### Playing the queue in an external player

1. Open the queue (the list button on the right of the player bar) and click **Export**, the download icon. The browser downloads the queue as a playlist named after its folder, such as `Night Drive.m3u8`, or `queue.m3u8` when the tracks come from several folders.
2. Open that file in the player:
   - **VLC**: *Media > Open File*, or drop the file on the window. On Android or iOS, open the downloaded file with VLC.
   - **MPC-HC** or **MPC-BE**: *File > Open File*, or drop the file on the window.
   - **mpv**: `mpv "Night Drive.m3u8"`.

The playlist holds links, not the files: the player streams each entry from the h5ai server, which must be reachable from where it runs. It is a snapshot of the queue at export time; export again after changing the queue.

- **Basic Auth**: VLC asks for the user name and password when it opens the first entry. Not every player can ask. Do not write the credentials into the playlist's URLs: anyone who gets the file gets them too.
- **HTTPS**: the player checks the server's certificate. A self-signed certificate has to be trusted on that machine; VLC offers to accept it.

#### `preview-img`
Enables overlay preview of images.
- `enabled` (default: `true`).
- `size` (default: `1000`): Only checked for being set. The preview first shows the original image. When the browser cannot decode it (TIFF outside Safari, camera RAW formats such as CR3, DNG, NEF or ARW), a set value lets h5ai ask the server for a WebP sample instead; `false` turns that fallback off. The sample width is 80% of the larger viewport dimension, rounded up to a multiple of 256 pixels and capped by `thumbnails.maxDimension`; the number itself is not used as a size.
- `types`: File types configured for image preview.

#### `preview-txt`
Enables previewing and syntax highlighting of text-based files.
- `enabled` (default: `true`).
- `styles`: A dictionary mapping text subtypes to rendering styles:
  - `0`: Floating text
  - `1`: Fixed-width text
  - `2`: Markdown (`.md` files)
  - `3`: Syntax highlighted code

#### `preview-vid`
Enables in-browser video playback.
- `enabled` (default: `true`).
- `autoplay` (default: `true`): Autoplay the video on preview start.
- `engine` (default: `""`): The enhanced player's engines, by priority, among `wasm`, `native`, `shaka`, `dashjs` and `hlsjs`; unknown names are ignored. Empty keeps the player's own order, its decoder first, which plays the most formats. `"native wasm"` puts the browser first, which casting needs, with the decoder as a fallback; see below.
- `types`: Supported video types for preview.

The enhanced player is loaded only in a secure, cross-origin-isolated context.
Otherwise h5ai immediately uses the native `<video>` element without downloading
the enhanced-player bundle.

h5ai sends the headers of that context on every page, so over HTTPS (or on
localhost) the enhanced player is the one Chrome, Edge and Firefox use.

When the browser exposes Remote Playback (Chrome, Edge) or Safari's AirPlay,
the video player offers a cast button for devices such as Chromecast, while a
device is reachable. The native player gets it in the preview bar. The enhanced
player shows it in its own controls only while the browser plays the video
itself: its own decoder draws on a canvas, which cannot be cast. With the
default `engine`, that decoder plays first, so the enhanced player rarely
offers casting; set `"engine": "native wasm"` to cast. The trade-off: every
file the browser claims to play then goes through it, and a file whose video
the browser decodes but whose audio it does not (AC3 or DTS in Chrome, for
instance) may play without sound instead of falling back to the decoder.
Device discovery and format support depend on the browser and receiver; a
video the receiver cannot play may not cast successfully.

Subtitle files next to the video are attached when their name is the video's
name, optionally followed by a suffix after `.`, `_` or `-`: `movie.srt`,
`movie.fr.srt` and `movie_en.forced.vtt` all belong to `movie.mkv`. A suffix
starting with a two- or three-letter code sets the track language. The native
player reads WebVTT (`.vtt`) files only.

#### `search`
Searches the current folder and its subfolders on the server, from the search field of the toolbar (see `filter`). Each result shows its folder in the details view, and in its tooltip in the other views. Names are compared as characters, so case is ignored for accented letters too (`É` matches `é`); a name that is not valid UTF-8 is compared byte by byte. With the PHP `intl` extension, names are compared in NFC, so a name written in decomposed form (as macOS does) matches what was typed; the Docker image does not ship that extension.
- `enabled` (default: `true`).
- `advanced` (default: `true`): Same as `filter.advanced`.
- `debounceTime` (default: `300`): Delay before searching when `filter` is disabled and the field searches as you type.
- `ignorecase` (default: `true`): Case-insensitive search.
- `maxResults` (default: `1000`): Maximum number of results returned by one recursive search.
- `maxDepth` (default: `64`): Maximum depth below the folder the search starts from.
- `maxPatternLength` (default: `1024`): Maximum regular-expression length accepted by the server, in bytes. In advanced mode, each typed letter becomes about four characters and each word adds eight, so a few words already make a long expression; a longer one finds nothing.
- `indexTtl` (default: `300`): Age in seconds after which a search asks for a background refresh of the search index. The stale index keeps answering in the meantime.
- `timeLimit` (default: `10`): Time in seconds, fractions allowed, after which a search stops and returns the matches found so far. A search also stops once its expression has hit the PCRE match or depth limit on 100 names: such an expression could keep a PHP worker busy for minutes on a large share. Both stops are logged.

#### `select`
Enables checkboxes and select options to choose multiple files.
- `enabled` (default: `true`).
- `clickndrag` (default: `true`): Allows drag-to-select with the mouse.
- `checkboxes` (default: `true`): Shows a checkbox when hovering over files.

#### `sort`
Defines default sorting criteria.
- `enabled` (default: `true`).
- `column` (default: `0`): Sorting column: `0` for Name, `1` for Date, `2` for Size. Stored locally in the browser.
- `reverse` (default: `false`): Set to `true` to sort in descending order. Stored locally in the browser.
- `ignorecase` (default: `true`): Ignore case when sorting.
- `natural` (default: `true`): Use natural sort order (e.g., `2` comes before `10`).
- `folders` (default: `0`): Where folders are placed: `0` for top, `1` for in place, `2` for bottom.

#### `tasks`
Shows a spinning gear in the toolbar while the cache warmer, the folder size refresh worker or the thumbnails of the current page are running. Hovering over it, or focusing it with the keyboard, lists each task with its progress and the estimated time left.
The server tasks are estimated from their previous run, so a first run shows neither a percentage nor a time left. Every visitor sees these tasks, but never a file name or path.
- `enabled` (default: `true`).
- `interval` (default: `3000`): polling interval in milliseconds while a server task runs (minimum `1000`).
- `idleInterval` (default: `30000`): polling interval in milliseconds while no server task runs. A page in a background tab sends no request and checks again when it becomes visible.

#### `thumbnails`
Generates preview thumbnails for images, videos, and document files.
> [!NOTE]
> For document/video thumbnails, the server requires helper binaries (e.g., `ffmpeg`, `magick`) as listed in the requirements. The `_h5ai/private/cache` directory must also be writable by the web server.
- `enabled` (default: `true`).
- `img`: Array of image types to generate thumbnails for. SVG has none: the bundled ImageMagick policy disables that coder, and the listing shows the SVG icon instead. HEIC/HEIF needs ImageMagick built with libheif (the Docker image includes it), JPEG XL needs libjxl.
- `mov`: Array of video types to generate thumbnails for.
- `doc`: Array of document types to generate thumbnails for (e.g. PDF).
- `ar`: Array of archive types to generate thumbnails for.
- `aud`: Array of audio types to generate thumbnails for (cover art).
- `delay` (default: `1`): Delay in milliseconds before starting thumbnail generation on page load.
- `size` (default: `240`): Height in pixels of the generated thumbnails.
- `seek` (default: `50`): Percentage of total video duration to seek into when generating video thumbnails. Measuring the duration requires `ffprobe` (with `ffmpeg`) or `avprobe` (with `avconv`); without it, thumbnails show the frame at 0.1 seconds.
- `exif` (default: `true`): Use embedded EXIF thumbnails if available (faster).
- `chunksize` (default: `20`): Number of thumbnails requested in a single batch.
- `maxBatchSize` (default: `40`): Hard server-side maximum number of thumbnails accepted in one request.
- `maxDimension` (default: `4096`): Hard server-side maximum width or height of a generated thumbnail. Listing thumbnails always use `size`. A request with an explicit size, such as an image preview sample, keeps the image's aspect ratio and has its width rounded up to a multiple of 256 pixels, so each image gets at most a few cached sample sizes.
- `allowGraphicsMagick` (default: `false`): Enables `gm` only as a compatibility fallback when ImageMagick is unavailable. Keep disabled for untrusted files because GraphicsMagick does not load h5ai's restrictive ImageMagick policy.
- `blocklist` (default: `[]`): Array of types for which thumbnail generation is explicitly disabled. Removing a type from one of the arrays above (`img`, `mov`, etc.) implicitly adds it to the blocklist.

> [!TIP]
> **Archive thumbnail cache (`CacheDB`)**
> If the `sqlite3` PHP module is enabled, h5ai creates `_h5ai/private/cache/thumbs_cache.db` when thumbnail handling initializes the database. The cache stores archive thumbnail outcomes, including archive parsing errors and types that were misdetected during thumbnail generation. It does not cache every failed thumbnail operation: failures from ordinary image, video, audio or document thumbnail generation are not recorded as negative cache entries. Archive entries are reconsidered when the source modification time is newer than the cached timestamp or the detected backend capabilities change.

#### `title`
Updates the browser window/tab title with the path of the current folder.
- `enabled` (default: `true`).

#### `tree`
Shows a collapsible directory tree sidebar on the left.
> [!WARNING]
> Enabling the tree view may significantly affect performance on directories with many subfolders.
- `enabled` (default: `true`).
- `show` (default: `true`): Initially visible.
- `maxSubfolders` (default: `50`): Max number of subfolders to render in the tree structure.
- `naturalSort` (default: `true`): Use natural sorting in the tree view.
- `ignorecase` (default: `true`): Case-insensitive sorting in the tree view.

## 2. File types configuration (`types.json`)

Located at [types.json](../src/_h5ai/private/conf/types.json).

This file configures how **h5ai** classifies files. It is a JSON dictionary mapping a generic type name (used by CSS styling and previews) to an object with a `glob` array of filename patterns and, optionally, a `mime` array of MIME types. An entry without a `glob` array matches no file.

### Customizing types

You can add custom file extensions to existing categories or define new file type groupings.

For example, to configure Markdown files to be previewed as text-markdown, make sure `*.md` is in the `glob` array of `"txt-md"`:
```json
"txt-md": {"glob": ["*.markdown", "*.md"]}
```

To configure files like `.env` or `.yaml` to render as scripts:
```json
"txt-script": {"glob": ["*.conf", "*.ini", "*.yaml", "*.yml", "*.env", ".gitignore"]}
```

An entry replaces the shipped one as a whole: the shipped `txt-script` lists more patterns, so copy them over to keep them.

## 3. Localization (`l10n/` directory)

Located at [l10n/](../src/_h5ai/private/conf/l10n).

This directory contains JSON files named `<language_code>.json` (such as `en.json`, `fr.json`, `de.json`).

> [!NOTE]
> `en.json` is the reference file: its values are the hardcoded defaults used as a fallback when a key is missing from another language file.

### Translation structure

Every language translation file maps UI strings to localized strings.

Here is an example translation file layout:
```json
{
    "lang": "english",
    "dateFormat": "YYYY-MM-DD HH:mm",
    "details": "details",
    "download": "download",
    "empty": "empty",
    "files": "files",
    "folders": "folders",
    "grid": "grid",
    "icons": "icons",
    "language": "Language",
    "lastModified": "Last modified",
    "name": "Name",
    "noMatch": "no match",
    "parentDirectory": "Parent Directory",
    "search": "search",
    "searchSubfolders": "Search subfolders for",
    "size": "Size",
    "tree": "Tree",
    "view": "View"
}
```

The example shows the first keys only: `en.json` lists all of them, for the listing, the sidebar, the previews and the audio player.

- **`dateFormat`**: Defines the date/time display pattern (using tokens like `YYYY`, `MM`, `DD`, `HH`, `mm`).
- **`%s`**: Some strings take a value, such as `vizShow` (`"Show the visualizer: %s"`), where `%s` is the name of the visualizer a click shows. Keep it in the translation.
- **Other keys**: Standard translations used across the toolbar, sidebar, previews and player.

A key missing from a language file is shown in English. German, Spanish, French, Italian, Japanese, Dutch, Polish, Brazilian and European Portuguese, Russian, and simplified and traditional Chinese translate every key; the other languages translate part of them.

To add a new language translation, create a new file named `<code>.json` in the `l10n/` directory, translate the keys, and reference it via the `"l10n"` extension settings in `options.json`.
