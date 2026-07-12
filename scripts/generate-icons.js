/*
 * Regenerates h5ai's Material-Icons-derived SVGs from the self-hosted
 * @material-symbols/svg-400 package (Apache-2.0, npm, no fonts.googleapis.com
 * dependency). Run after bumping the package version or to add/change an icon:
 *
 *   node scripts/generate-icons.js
 *
 * Icons not listed below (theme.svg, tree-toggle.svg, spinner.svg, paypal.svg,
 * the "default" theme's own type icons) are not part of Material Symbols and
 * are left untouched.
 */

const fs = require('fs');
const path = require('path');

const PKG_DIR = path.join(__dirname, '..', 'node_modules', '@material-symbols', 'svg-400', 'outlined');
const IMAGES_DIR = path.join(__dirname, '..', 'src', '_h5ai', 'public', 'images');

// h5ai icon id -> [Material Symbols name, fill color]
// fill #555 = light toolbar/sidebar/tree/crumb background
// fill #fff = dark preview-bar background or a colored "selected" background
const GROUPS = [
    {
        outDir: path.join(IMAGES_DIR, 'ui'),
        size: 24,
        icons: {
            back: ['arrow_back', '#555'],
            crumb: ['chevron_right', '#555'],
            download: ['download', '#555'],
            filter: ['filter_list', '#555'],
            'info-toggle': ['info', '#555'],
            'preview-close': ['close', '#fff'],
            'preview-fullscreen': ['fullscreen', '#fff'],
            'preview-next': ['chevron_right', '#fff'],
            'preview-no-fullscreen': ['fullscreen_exit', '#fff'],
            'preview-prev': ['chevron_left', '#fff'],
            'preview-raw': ['download', '#fff'],
            search: ['search', '#555'],
            selected: ['check', '#fff'],
            sidebar: ['menu', '#555'],
            sort: ['keyboard_arrow_down', '#555'],
            'tree-indicator': ['chevron_right', '#555'],
            'view-details': ['view_list', '#555'],
            'view-grid': ['view_module', '#555'],
            'view-icons': ['apps', '#555']
        }
    },
    {
        // Format-specific file-type icons in the default theme: previously
        // brand-colored format logos (Android/Debian/RPM/PHP/... art, in the
        // now-removed "comity" theme), now generic monochrome Material
        // Symbols glyphs. Types without a dedicated symbol share a generic
        // fallback (deb/rpm -> package, go/less/py/rb/rust -> code). The base
        // types (ar, aud, bin, file, folder*, img, txt, vid, x) are not
        // Material Symbols and are left untouched.
        outDir: path.join(IMAGES_DIR, 'themes', 'default'),
        size: 20,
        icons: {
            'ar-apk': ['android', '#555'],
            'ar-deb': ['package', '#555'],
            'ar-rpm': ['package', '#555'],
            'txt-css': ['css', '#555'],
            'txt-go': ['code', '#555'],
            'txt-html': ['html', '#555'],
            'txt-js': ['javascript', '#555'],
            'txt-less': ['code', '#555'],
            'txt-md': ['markdown', '#555'],
            'txt-php': ['php', '#555'],
            'txt-py': ['code', '#555'],
            'txt-rb': ['code', '#555'],
            'txt-rust': ['code', '#555'],
            'txt-script': ['files', '#555'],
            'x-pdf': ['picture_as_pdf', '#555']
        }
    }
];

const readSymbol = name => {
    const file = path.join(PKG_DIR, `${name}-fill.svg`);
    const content = fs.readFileSync(file, 'utf8');
    const viewBox = content.match(/viewBox="([^"]+)"/)[1];
    const d = content.match(/<path d="([^"]+)"/)[1];
    return {viewBox, d};
};

for (const {outDir, size, icons} of GROUPS) {
    for (const [id, [symbol, fill]] of Object.entries(icons)) {
        const {viewBox, d} = readSymbol(symbol);
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${viewBox}"><path fill="${fill}" d="${d}"/></svg>`;
        fs.writeFileSync(path.join(outDir, `${id}.svg`), svg);
        console.log(`${id}.svg  <-  ${symbol}-fill (${fill})`);
    }
}
