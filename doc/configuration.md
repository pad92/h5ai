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
| `hidden` | `array` | `["^\\.", "^_h5ai"]` | Regular expressions matching files/directories that should be hidden from the index. |
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
| `warm_at_startup` | `boolean` | `false` | If `true`, triggers the cache warmer script in the background on request if it has not run recently. Keep disabled on large trees unless cache warming is scheduled deliberately. |
| `warm_interval` | `number` | `86400` | The execution interval in seconds for the background cache warmer (default is 24 hours). |

> [!TIP]
> **Manual execution and low priority (`nice`)**
> You can also run the cache warmer manually or via a system cron job using:
> `nice -n 19 php _h5ai/private/php/warm-cache.php`
> The task is executed with low scheduling priority to prevent resource starvation.
> 
> **How invalidation works**
> The computed folder sizes are saved in `_h5ai/private/cache/foldersizes.json`. Along with each directory's size, it stores the modification times (`mtime`) of the directory and all of its descendant subfolders. When a page is requested, h5ai checks if the directory's own `mtime` or any of its descendant folders' `mtime`s have changed on disk. If so, only the affected folders are invalidated and recomputed on the fly, so the cache stays accurate without a full rescan.

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

#### `download`
Allows packaging and downloading of selected directory entries.
- `enabled` (default: `true`).
- `type` (default: `"shell-zip"`): The type of archiving:
  - `"php-tar"`: uses h5ai's streaming PHP TAR writer (no external dependency).
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
- `enabled` (default: `false`).
- `type` (default: `"shell-du"`): Can be `"php"` (slow, adds up sizes of files recursively in PHP) or `"shell-du"` (uses command line `du`, faster but still potentially expensive).

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
- `size` (default: `1000`): Maximum preview size (e.g. `1000` pixels), or `false` for original image size. Enabling this setting (by passing a numeric value or `true`) instructs the server to pre-generate optimized image samples for previews. When active, h5ai dynamically requests a sample size corresponding to 80% of the viewport dimensions to optimize rendering quality and network bandwidth (especially important for large files such as RAW image formats like CR3, DNG, NEF, ARW, etc.).
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
> For document/video thumbnails, the server requires helper binaries (e.g., `ffmpeg`, `convert`) as listed in the requirements. The `_h5ai/private/cache` directory must also be writable by the web server.
- `enabled` (default: `true`).
- `img`: Array of image types to generate thumbnails for.
- `mov`: Array of video types to generate thumbnails for.
- `doc`: Array of document types to generate thumbnails for (e.g. PDF).
- `ar`: Array of archive types to generate thumbnails for.
- `aud`: Array of audio types to generate thumbnails for (cover art).
- `delay` (default: `1`): Delay in milliseconds before starting thumbnail generation on page load.
- `size` (default: `240`): Height in pixels of the generated thumbnails.
- `seek` (default: `50`): Percentage of total video duration to seek into when generating video thumbnails (requires `ffprobe` or `avprobe`).
- `exif` (default: `true`): Use embedded EXIF thumbnails if available (faster).
- `chunksize` (default: `20`): Number of thumbnails requested in a single batch.
- `maxBatchSize` (default: `40`): Hard server-side maximum number of thumbnails accepted in one request.
- `maxDimension` (default: `4096`): Hard server-side maximum width or height of a generated thumbnail.
- `allowGraphicsMagick` (default: `false`): Enables `gm` only as a compatibility fallback when ImageMagick is unavailable. Keep disabled for untrusted files because GraphicsMagick does not load h5ai's restrictive ImageMagick policy.
- `blocklist` (default: `[]`): Array of types for which thumbnail generation is explicitly disabled. Removing a type from one of the arrays above (`img`, `mov`, etc.) implicitly adds it to the blocklist.

> [!TIP]
> **Failed thumbnail caching (`CacheDB`)**
> If the `sqlite3` PHP module is enabled, h5ai automatically initializes a caching database at `_h5ai/private/cache/thumbs_cache.db`. This database keeps track of files that failed thumbnail generation or files whose types were misdetected. If a file fails to generate a thumbnail (e.g. due to corrupt files, unsupported codecs, or memory limits), its failure state is cached. Future directory requests read this state from the SQLite database directly, completely bypassing resource-heavy regeneration attempts.
> The cache automatically invalidates entries if the source file's modification time changes or if the server's backend configuration/capabilities change.

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
