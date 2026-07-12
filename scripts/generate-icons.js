/*
 * Regenerates src/_h5ai/public/images/ui/*.svg from the self-hosted
 * @material-symbols/svg-400 package (Apache-2.0, npm, no fonts.googleapis.com
 * dependency). Run after bumping the package version or to add/change an icon:
 *
 *   node scripts/generate-icons.js
 *
 * Icons not listed in ICONS (theme.svg, tree-toggle.svg, spinner.svg,
 * paypal.svg) are not part of Material Symbols and are left untouched.
 */

const fs = require('fs');
const path = require('path');

const PKG_DIR = path.join(__dirname, '..', 'node_modules', '@material-symbols', 'svg-400', 'outlined');
const OUT_DIR = path.join(__dirname, '..', 'src', '_h5ai', 'public', 'images', 'ui');

// h5ai icon id -> [Material Symbols name, fill color]
// fill #555 = light toolbar/sidebar/tree/crumb background
// fill #fff = dark preview-bar background or a colored "selected" background
const ICONS = {
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
};

const readSymbol = name => {
    const file = path.join(PKG_DIR, `${name}-fill.svg`);
    const content = fs.readFileSync(file, 'utf8');
    const viewBox = content.match(/viewBox="([^"]+)"/)[1];
    const d = content.match(/<path d="([^"]+)"/)[1];
    return {viewBox, d};
};

for (const [id, [symbol, fill]] of Object.entries(ICONS)) {
    const {viewBox, d} = readSymbol(symbol);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="${viewBox}"><path fill="${fill}" d="${d}"/></svg>`;
    fs.writeFileSync(path.join(OUT_DIR, `${id}.svg`), svg);
    console.log(`${id}.svg  <-  ${symbol}-fill (${fill})`);
}
