/*
 * Regenerates h5ai's icon SVGs from the self-hosted
 * @fortawesome/fontawesome-free package (CC BY 4.0 icons / OFL 1.1 font /
 * MIT code, npm, no fonts.googleapis.com dependency). Run after bumping the
 * package version or to add/change an icon:
 *
 *   node scripts/generate-icons.js
 *
 * Icons not listed below (theme.svg, tree-toggle.svg, spinner.svg)
 * are not part of Font Awesome and are left untouched.
 */

const fs = require('fs');
const path = require('path');

const FA_DIR = path.join(__dirname, '..', 'node_modules', '@fortawesome', 'fontawesome-free', 'svgs');
const IMAGES_DIR = path.join(__dirname, '..', 'src', '_h5ai', 'public', 'images');

// h5ai icon id -> [Font Awesome style, Font Awesome icon name, fill color]
// style is "solid" (fas) or "brands" (fab)
// fill #555 = light toolbar/sidebar/tree/crumb/file-list background
// fill #fff = dark preview-bar background or a colored "selected" background
const GROUPS = [
    {
        outDir: path.join(IMAGES_DIR, 'ui'),
        size: 24,
        icons: {
            back: ['solid', 'arrow-left', '#555'],
            crumb: ['solid', 'chevron-right', '#555'],
            download: ['solid', 'download', '#555'],
            filter: ['solid', 'filter', '#555'],
            'info-toggle': ['solid', 'circle-info', '#555'],
            'preview-close': ['solid', 'xmark', '#fff'],
            'preview-fullscreen': ['solid', 'expand', '#fff'],
            'preview-next': ['solid', 'chevron-right', '#fff'],
            'preview-no-fullscreen': ['solid', 'compress', '#fff'],
            'preview-prev': ['solid', 'chevron-left', '#fff'],
            'preview-raw': ['solid', 'download', '#fff'],
            search: ['solid', 'magnifying-glass', '#555'],
            selected: ['solid', 'check', '#fff'],
            sidebar: ['solid', 'bars', '#555'],
            sort: ['solid', 'chevron-down', '#555'],
            'tree-indicator': ['solid', 'chevron-right', '#555'],
            'view-details': ['solid', 'list', '#555'],
            'view-grid': ['solid', 'table-cells', '#555'],
            'view-icons': ['solid', 'grip', '#555']
        }
    },
    {
        // Base file/folder types, and format-specific file-type icons (the
        // latter previously brand-colored "comity" art, then generic
        // monochrome Material Symbols glyphs). Font Awesome brand icons
        // (fab) restore real per-language logos: android/debian/redhat for
        // archives, css3-alt/golang/html5/js/less/markdown/php/python/rust
        // for source files. Types without a brand mark use a generic fas
        // fallback (txt-rb -> gem, txt-script -> file-code for the
        // shell/config bucket: yaml/toml/sh/Dockerfile/.env/...).
        outDir: path.join(IMAGES_DIR, 'themes', 'default'),
        size: 20,
        icons: {
            ar: ['solid', 'file-zipper', '#555'],
            aud: ['solid', 'file-audio', '#555'],
            bin: ['solid', 'gear', '#555'],
            file: ['solid', 'file', '#555'],
            folder: ['solid', 'folder', '#555'],
            'folder-page': ['solid', 'folder-open', '#555'],
            'folder-parent': ['solid', 'arrow-up', '#555'],
            img: ['solid', 'file-image', '#555'],
            txt: ['solid', 'file-lines', '#555'],
            vid: ['solid', 'file-video', '#555'],
            x: ['solid', 'file', '#555'],
            'ar-apk': ['brands', 'android', '#555'],
            'ar-deb': ['brands', 'debian', '#555'],
            'ar-rpm': ['brands', 'redhat', '#555'],
            'txt-css': ['brands', 'css3-alt', '#555'],
            'txt-go': ['brands', 'golang', '#555'],
            'txt-html': ['brands', 'html5', '#555'],
            'txt-js': ['brands', 'js', '#555'],
            'txt-less': ['brands', 'less', '#555'],
            'txt-md': ['brands', 'markdown', '#555'],
            'txt-php': ['brands', 'php', '#555'],
            'txt-py': ['brands', 'python', '#555'],
            'txt-rb': ['solid', 'gem', '#555'],
            'txt-rust': ['brands', 'rust', '#555'],
            'txt-script': ['solid', 'file-code', '#555'],
            'x-pdf': ['solid', 'file-pdf', '#555']
        }
    }
];

const readIcon = (style, name) => {
    const file = path.join(FA_DIR, style, `${name}.svg`);
    const content = fs.readFileSync(file, 'utf8');
    const viewBox = content.match(/viewBox="([^"]+)"/)[1];
    const d = content.match(/\bd="([^"]+)"/)[1];
    return {viewBox, d};
};

for (const {outDir, size, icons} of GROUPS) {
    for (const [id, [style, name, fill]] of Object.entries(icons)) {
        const {viewBox, d} = readIcon(style, name);
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${viewBox}"><path fill="${fill}" d="${d}"/></svg>`;
        fs.writeFileSync(path.join(outDir, `${id}.svg`), svg);
        console.log(`${id}.svg  <-  ${style}/${name} (${fill})`);
    }
}
