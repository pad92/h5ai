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
| `hidden` | `array` | `["^\\.", "^_h5ai", "robots.txt", "ads.txt"]` | Regular expressions matching files/directories that should be hidden from the index. The defaults hide dot-prefixed names, `_h5ai`, and names matching `robots.txt` or `ads.txt`; other names beginning with `_` remain visible unless you add a matching pattern. |
| `hideFolders` | `boolean` | `false` | Hides all folders from the main file listing. |
| `hideIf403` | `boolean` | `true` | Hides files/folders that are unreadable by the web server (avoiding 403 Forbidden errors). |
| `hideParentFolder` | `boolean` | `false` | Hides the link to navigate to the parent folder. |
| `maxIconSize` | `number` | `40` | Maximum icon size in pixels. |
| `modes` | `array` | `["details", "grid", "icons"]` | Enabled view modes. The first one is the default. If only one is specified, the selector is hidden. The user's selection is stored in browser local storage. |
| `modeToggle` | `boolean`/`string` | `false` | Shows a toggle button for view modes in the toolbar. Can be `"next"`. |
| `setParentFolderLabels`| `boolean` | `true` | Shows the actual parent folder name instead of just "Parent Folder". |
| `sizes` | `array` | `[20, 40, ...]` | List of selectable icon/row sizes. The first one is the default. If only one is specified, the selector is hidden. The user's selection is stored in browser local storage. |
| `theme` | `string` | `"default"` | Name of the folder under `_h5ai/public/images/themes` to use for file icons. |
| `unmanaged` | `array` | `["index.html", ...]` | If a folder contains any of these files, h5ai will not manage it, allowing default index pages to load instead. |
| `unmanagedInNewWindow` | `boolean` | `false` | Opens unmanaged folder links in a new window/tab. |

### Cache options (`cache`)

Configure automatic background cache warming (for pre-generating thumbnails and calculating folder sizes persistently).

| Key | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `warmAtStartup` | `boolean` | `false` | If `true`, triggers the cache warmer script in the background on request if it has not run recently. Keep disabled on large trees unless cache warming is scheduled deliberately. |
| `warmInterval` | `number` | `86400` | The execution interval in seconds for the background cache warmer (default is 24 hours). |

Older releases named these options `warm_at_startup` and `warm_interval`; those names are still read when the new ones are absent.

> [!TIP]
> **Manual execution and low priority (`nice`)**
> You can also run the cache warmer manually or via a system cron job using:
> `nice -n 19 php _h5ai/private/php/warm-cache.php`
> The task is executed with low scheduling priority to prevent resource starvation.
> 
> **How invalidation works**
> The computed folder sizes are saved in `_h5ai/private/cache/foldersizes.json`, one entry per folder with its direct subfolders. Each entry expires after five minutes, and expired entries are removed from the file when it is next written. When the cache warmer reads an entry, a change in the entries of that folder or of any folder below it invalidates it; changes to an existing file may not change its directory's `mtime`, so those are picked up when the entry expires. Initial HTML, API listings and search results only use fresh cached folder sizes and hand missing or expired entries to a background refresh. If a refresh fails, the folder size remains unknown until a later refresh succeeds. Regular file sizes use the metadata already read for each item and remain available for display and sorting. Only the cache warmer and the background refresh worker compute folder sizes. Ordinary directory and metadata reads can still block on an unavailable mount.
>
> **Thumbnails of deleted files**
> Thumbnails in `_h5ai/public/cache/thumbs/` never expire: a thumbnail is regenerated when its source changes. At the end of each pass, the cache warmer deletes the thumbnails, and their `thumbs_cache.db` entries, of sources that no longer exist. A source counts as gone only when its closest existing folder is readable, and nothing is deleted while the root folder is empty or unreadable (an unmounted share). Thumbnails generated by an older release are known to the warmer once a pass has seen their source; those of files deleted before that pass stay until the thumbnail folder is emptied by hand.

### Extensions configuration

Each extension under `options.json` can be enabled or disabled and has specific parameters.

#### `autorefresh`
Automatically refreshes the current folder contents at a defined interval.
- `enabled` (default: `false`): Enable autorefresh.
- `interval` (default: `5000`): Refresh interval in milliseconds (minimum is `1000`).

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
Allows the user to filter the files displayed in the current folder using a text box in the toolbar.
- `enabled` (default: `true`).
- `advanced` (default: `true`): If `true`, checks for characters in the right order (e.g., "ab" matches "axb"). Allows spaces to OR query terms. Prefixing a query with `re:` enables regex search.
- `debounceTime` (default: `100`): Debounce wait time in milliseconds before filtering.
- `ignorecase` (default: `true`): Case-insensitive filtering.

#### `foldersize`
Calculates and displays the sizes of directories.
> [!WARNING]
> This operation can significantly slow down directory loading speeds, especially on large folders.
- `enabled` (default: `true`).
- `type` (default: `"shell-du"`): Can be `"php"` (slow, adds up sizes of files recursively in PHP) or `"shell-du"` (uses command line `du`, faster but still potentially expensive).
- `timeout` (default: `50`, maximum: `3600`): Maximum runtime in seconds of a `du` pass started while serving a request. Listings, fallback pages and search results now read folder sizes from the cache and leave the computation to the background worker, so no request starts such a pass and this setting currently has no effect. It is still accepted so existing configurations remain valid.
- `backgroundTimeout` (default: `900`, maximum: `3600`): Same limit for the `du` passes started by the CLI cache warmer and the background refresh worker. The cache warmer measures the whole share with a single `du` pass, so this limit must cover a full pass. No pool limit applies to those, so this is much larger: cutting a genuinely large tree short would leave it permanently uncached and retried on every pass. Raise it if a full pass over your share needs longer.
> [!NOTE]
> A timeout only helps when the storage is slow. If a network mount hangs outright, the kernel leaves `du` in uninterruptible I/O where no signal can reach it, and plain directory reads block the same way, so h5ai cannot recover on its own and neither can PHP-FPM. The mount itself has to be repaired. NFS does offer `soft`, which makes calls fail instead of hang, but `nfs(5)` warns that it can cause silent data corruption, so it is not a general recommendation.

#### `info`
Shows an informational sidebar displaying file/folder details on hover or select.
- `enabled` (default: `true`).
- `show` (default: `false`): Shows the sidebar by default for first-time visitors.
- `qrcode` (default: `true`): Generates and displays a QR code for the hovered/selected file URL.
- `qrFill` (default: `"#999"`): QR code fill color.
- `qrBack` (default: `"#fff"`): QR code background color.

#### `l10n`
Configures localization and language preferences.
- `enabled` (default: `true`).
- `lang` (default: `"en"`): The default fallback language code (refer to translations in `l10n` folder).
- `useBrowserLang` (default: `true`): Try to automatically detect and use the client's browser language.

#### `piwik-analytics`
Integrates Piwik (Matomo) tracking code.
- `enabled` (default: `false`).
- `baseURL` (default: `"some/url"`): The base URL to the Piwik instance, without protocol.
- `idSite` (default: `1`): The site ID configured in Piwik.

#### `preview-aud`
Enables in-browser preview and playback of audio files.
- `enabled` (default: `true`).
- `autoplay` (default: `true`): Autoplay the audio file once the preview modal opens.
- `types` (default: `["aud"]`): File types (configured in `types.json`) allowed for audio preview.

#### `preview-img`
Enables overlay preview of images.
- `enabled` (default: `true`).
- `size` (default: `1000`): Only checked for being set. The preview first shows the original image. When the browser cannot decode it (camera RAW formats such as CR3, DNG, NEF or ARW), a set value lets h5ai ask the server for a WebP sample instead; `false` turns that fallback off. The sample width is 80% of the larger viewport dimension, rounded up to a multiple of 256 pixels and capped by `thumbnails.maxDimension`; the number itself is not used as a size.
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
- `types`: Supported video types for preview.

The enhanced player is loaded only in a secure, cross-origin-isolated context.
Otherwise h5ai immediately uses the native `<video>` element without downloading
the enhanced-player bundle.

#### `search`
Allows users to search for files recursively inside the current folder and its subfolders.
- `enabled` (default: `true`).
- `advanced` (default: `true`): Support fuzzy matching, spaces to OR terms, or `re:` prefix for regex.
- `debounceTime` (default: `300`): Delay before searching triggers.
- `ignorecase` (default: `true`): Case-insensitive search.
- `maxResults` (default: `1000`): Maximum number of results returned by one recursive search.
- `maxDepth` (default: `64`): Maximum recursive directory depth visited by one search.
- `maxPatternLength` (default: `256`): Maximum regular-expression length accepted by the server.

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

#### `thumbnails`
Generates preview thumbnails for images, videos, and document files.
> [!NOTE]
> For document/video thumbnails, the server requires helper binaries (e.g., `ffmpeg`, `magick`) as listed in the requirements. The `_h5ai/private/cache` directory must also be writable by the web server.
- `enabled` (default: `true`).
- `img`: Array of image types to generate thumbnails for.
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

This file configures how **h5ai** classifies files. It is a JSON dictionary mapping a generic type name (used by CSS styling and previews) to an array of filename glob patterns.

### Customizing types

You can add custom file extensions to existing categories or define new file type groupings.

For example, to configure Markdown files to be previewed as text-markdown, make sure `*.md` is in the `"txt-md"` array:
```json
"txt-md": [
    "*.markdown",
    "*.md"
]
```

To configure configurations like `.env` or `.yaml` to render as scripts:
```json
"txt-script": [
    "*.conf",
    "*.ini",
    "*.yaml",
    "*.yml",
    ".gitignore"
]
```

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
    "filter": "filter",
    "folders": "folders",
    "grid": "grid",
    "icons": "icons",
    "language": "Language",
    "lastModified": "Last modified",
    "name": "Name",
    "noMatch": "no match",
    "parentDirectory": "Parent Directory",
    "search": "search",
    "size": "Size",
    "tree": "Tree",
    "view": "View"
}
```

- **`dateFormat`**: Defines the date/time display pattern (using tokens like `YYYY`, `MM`, `DD`, `HH`, `mm`).
- **Other keys**: Standard translations used across the toolbar, sidebar, and headers.

To add a new language translation, create a new file named `<code>.json` in the `l10n/` directory, translate the keys, and reference it via the `"l10n"` extension settings in `options.json`.
