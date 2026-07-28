import gulp from 'gulp';
import {execSync} from 'child_process';
import path from 'path';
import {deleteAsync as del} from 'del';
import webpack from 'webpack-stream';
import include from 'gulp-include';
import less from 'gulp-less';
import autoprefixer from 'gulp-autoprefixer';
import cleanCss from 'gulp-clean-css';
import pug from 'gulp-pug';
import zip from 'gulp-zip';
import insert from 'gulp-insert';
import footer from 'gulp-footer';
import replace from 'gulp-replace';
import rename from 'gulp-rename';
import uglify from 'gulp-uglify';
import {fileURLToPath} from 'url';
import {PassThrough} from 'stream';
import pkg from './package.json' with {type: 'json'};

const {src, dest, series, parallel} = gulp;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = __dirname;
const SRC = path.join(ROOT, 'src');
const TEST = path.join(ROOT, 'test');
const BUILD = path.join(ROOT, 'build');
const isProduction = process.argv.includes('release');

// `gulp-if`'s own dependency chain (gulp-match -> an old minimatch) drags in
// a brace-expansion release with an unpatched DoS (GHSA-mh99-v99m-4gvg) and
// none of those packages have had a release since; `isProduction` is a plain
// boolean here, so a passthrough stream is all `gulp-if` was buying us.
const pipeIf = (condition, stream) => condition ? stream : new PassThrough({objectMode: true});

const WEBPACK_CFG = {
    mode: isProduction ? 'production' : 'development',
    output: {
        filename: 'scripts.js',
        library: {name: 'h5ai', type: 'window'}
    },
    module: {
        rules: [
            {
                test: /\.js$/,
                use: {loader: 'babel-loader', options: {presets: ['@babel/preset-env']}}
            },
            {
                test: /jsdom/,
                use: 'null-loader'
            }
        ]
    },
    devtool: isProduction ? false : 'source-map'
};

let version = pkg.version;
if (!isProduction) {
    try {
        const hashes = execSync(`git rev-list v${pkg.version}..HEAD`, {encoding: 'utf8'}).split(/\r?\n/).filter(x => x);
        if (hashes.length) {
            const counter = ('000' + hashes.length).substr(-3);
            const hash = hashes[0].substr(0, 7);
            version += `+${counter}~${hash}`;
        }
    } catch { /* ignore error */ }
}

const comment = `${pkg.name} v${version} - ${pkg.homepage}`;
const comment_js = `/* ${comment} */\n`;
const comment_html = `<!-- ${comment} -->`;
console.log(comment);
if (isProduction) console.log('Running in production mode');

const clean = () => del([BUILD]);

const buildScripts = () => src(path.join(SRC, '_h5ai/public/js/scripts.js'))
    .pipe(webpack(WEBPACK_CFG))
    .pipe(insert.prepend('//= require "pre.js"\n\n'))
    .pipe(include({hardFail: true, includePaths: [path.join(SRC, '_h5ai/public/js')]}))
    .pipe(pipeIf(isProduction, uglify()))
    .pipe(insert.prepend(comment_js))
    .pipe(dest(path.join(BUILD, '_h5ai/public/js')));

const buildStyles = () => src(path.join(SRC, '_h5ai/public/css/styles.less'))
    .pipe(replace(/\/\/ @include/g, '//= require'))
    .pipe(include({hardFail: true}))
    .pipe(less({math: 'always'}))
    .pipe(autoprefixer())
    .pipe(pipeIf(isProduction, cleanCss()))
    .pipe(insert.prepend(comment_js))
    .pipe(dest(path.join(BUILD, '_h5ai/public/css')));

const buildPhpFromPug = () => src(`${SRC}/**/*.php.pug`)
    .pipe(pug({locals: {pkg}}))
    .pipe(rename(p => { p.extname = ''; }))
    .pipe(footer(comment_html))
    .pipe(dest(BUILD));

const copyPhpAndStatic = () => src([
    `${SRC}/**`, `!${SRC}/**/*.js`, `!${SRC}/**/*.less`, `!${SRC}/**/*.pug`,
    `!${SRC}/**/conf/*.json`, `!${SRC}/_h5ai/public/css/lib/**`, `!${SRC}/_h5ai/public/js/lib/**`
])
    .pipe(replace('{{VERSION}}', version))
    .pipe(dest(BUILD));

// Keep conf JSON as strict, comment-free JSON so external tooling (linters,
// security scanners) can parse the shipped files. h5ai's own parser also
// accepts comments, but we no longer emit a banner here.
const copyJson = () => src(`${SRC}/**/conf/*.json`)
    .pipe(dest(BUILD));

const copyRootFiles = () => src(`${ROOT}/*.md`)
    .pipe(dest(path.join(BUILD, '_h5ai')));

// movi-player's bundled CSS imports Google's Inter font over the network;
// strip that import so the player falls back to its (already declared)
// system-font stack instead of depending on fonts.googleapis.com.
const copyMoviPlayer = () => src(`${ROOT}/node_modules/movi-player/dist/element.js`)
    .pipe(replace(/@import url\(['"]https:\/\/fonts\.googleapis\.com[^)]*\);?/g, ''))
    .pipe(dest(path.join(BUILD, '_h5ai/public/ext/movi-player')));

// Self-hosted Ubuntu / Ubuntu Mono (Ubuntu Font License 1.0, via @fontsource)
// referenced by src/_h5ai/public/css/lib/fonts.less; no runtime dependency
// on fonts.googleapis.com.
const copyFonts = () => src([
    `${ROOT}/node_modules/@fontsource/ubuntu/files/ubuntu-latin-300-normal.woff2`,
    `${ROOT}/node_modules/@fontsource/ubuntu/files/ubuntu-latin-400-normal.woff2`,
    `${ROOT}/node_modules/@fontsource/ubuntu/files/ubuntu-latin-700-normal.woff2`,
    `${ROOT}/node_modules/@fontsource/ubuntu-mono/files/ubuntu-mono-latin-400-normal.woff2`,
    `${ROOT}/node_modules/@fontsource/ubuntu-mono/files/ubuntu-mono-latin-700-normal.woff2`
])
    .pipe(dest(path.join(BUILD, '_h5ai/public/fonts')));

const copy = parallel(copyPhpAndStatic, copyJson, copyRootFiles, copyMoviPlayer, copyFonts);

const buildTests = () => src(path.join(TEST, 'index.js'))
    .pipe(webpack(WEBPACK_CFG))
    .pipe(insert.prepend('//= require "pre.js"\n\n'))
    .pipe(include({hardFail: true, includePaths: [path.join(SRC, '_h5ai/public/js')]}))
    .pipe(dest(path.join(BUILD, 'test')));

const copyTestAssets = () => src(path.join(TEST, 'index.html'))
    .pipe(dest(path.join(BUILD, 'test')));

const copyTestStyles = () => src(path.join(BUILD, '_h5ai/public/css/styles.css'))
    .pipe(dest(path.join(BUILD, 'test')));

const createZip = () => src(path.join(BUILD, '_h5ai/**'))
    .pipe(zip(`${pkg.name}-${version}.zip`))
    .pipe(dest(BUILD));

const build = series(parallel(buildScripts, buildStyles), parallel(buildPhpFromPug, copy));
const tests = series(buildStyles, copyTestStyles, buildTests, copyTestAssets);
const release = series(clean, build, tests, createZip);

export {clean, build, tests, release};
export default release;
