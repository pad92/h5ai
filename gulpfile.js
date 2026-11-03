import gulp from 'gulp';
import {execFileSync} from 'child_process';
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
import {packageFileName} from './scripts/package-name.js';
import {versionLabel} from './src/_h5ai/public/js/lib/util/version.js';

const {src, dest, series, parallel} = gulp;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = __dirname;
const SRC = path.join(ROOT, 'src');
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
            }
        ]
    },
    devtool: isProduction ? false : 'source-map'
};

// The version comes from Git alone (scripts/version.sh): a release tag, else
// the commit id. The Docker build has no .git and passes H5AI_VERSION.
const version = execFileSync('sh', [path.join(ROOT, 'scripts/version.sh')], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit']
}).trim();

const comment = `${pkg.name} ${versionLabel(version)} - ${pkg.homepage}`;
const comment_js = `/* ${comment} */\n`;
const comment_html = `<!-- ${comment} -->`;
console.log(comment);
if (isProduction) console.log('Running in production mode');

// A style sheet's @charset only counts as the very first bytes of the file,
// so the version banner goes after it.
const prependCssBanner = css => {
    const charset = css.match(/^@charset "[^"]*";/);
    if (!charset) {
        return comment_js + css;
    }
    return `${charset[0]}\n${comment_js}${css.slice(charset[0].length)}`;
};

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
    .pipe(insert.transform(prependCssBanner))
    .pipe(dest(path.join(BUILD, '_h5ai/public/css')));

const buildPhpFromPug = () => src(`${SRC}/**/*.php.pug`)
    .pipe(pug({locals: {pkg: {...pkg, version}, versionLabel: versionLabel(version)}}))
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

// LICENSE travels with the package: the MIT terms require the notice.
const copyRootFiles = () => src([`${ROOT}/*.md`, `${ROOT}/LICENSE`])
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

const createZip = () => src(path.join(BUILD, '_h5ai/**'))
    .pipe(zip(packageFileName(pkg.name, version)))
    .pipe(dest(BUILD));

const build = series(parallel(buildScripts, buildStyles), parallel(buildPhpFromPug, copy));
const release = series(clean, build, createZip);

export {clean, build, release};
export default release;
