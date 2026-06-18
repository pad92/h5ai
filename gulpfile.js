const {src, dest, series, parallel, watch} = require('gulp');
const path = require('path');
const fs = require('fs');
const less = require('gulp-less');
const postcss = require('gulp-postcss');
const autoprefixer = require('autoprefixer');
const cssnano = require('cssnano');
const pug = require('gulp-pug');
const zip = require('gulp-zip').default;
const {Transform} = require('stream');
const webpack = require('webpack');
const {globSync} = require('glob');
const {execSync} = require('child_process');

const ROOT = path.resolve(__dirname);
const SRC = path.join(ROOT, 'src');
const TEST = path.join(ROOT, 'test');
const BUILD = path.join(ROOT, 'build');

// Get version and build metadata
const pkg = Object.assign({}, require('./package.json'));
let version = pkg.version;

try {
    const stdout = execSync(`git rev-list v${version}..HEAD`, {stdio: ['pipe', 'pipe', 'ignore']}).toString();
    const hashes = stdout.split(/\r?\n/).filter(x => x);
    if (hashes.length) {
        const counter = ('000' + hashes.length).substr(-3);
        const hash = hashes[0].substr(0, 7);
        version += `+${counter}~${hash}`;
    }
} catch {
    // Ignore error if git command fails
}

const comment = `${pkg.name} v${version} - ${pkg.homepage}`;
const comment_js = `/* ${comment} */\n`;
const comment_html = `<!-- ${comment} -->`;

let isProduction = false;

// Custom includeit implementation matching ghu's includeit
function includeit(content, dir) {
    const regex = /\/\/ @include\s+"([^"]+)"/g;
    return content.replace(regex, (match, pattern) => {
        const fullPattern = path.isAbsolute(pattern) ? pattern : path.resolve(dir, pattern);
        const files = globSync(fullPattern);
        return files.map(file => {
            const fileContent = fs.readFileSync(file, 'utf8');
            return includeit(fileContent, path.dirname(file));
        }).join('\n');
    });
}

function gulpIncludeIt() {
    return new Transform({
        objectMode: true,
        transform(file, enc, cb) {
            if (file.isNull()) {
                return cb(null, file);
            }
            if (file.isStream()) {
                return cb(new Error('Streaming not supported'));
            }
            try {
                const content = file.contents.toString('utf8');
                const dir = path.dirname(file.path);
                const result = includeit(content, dir);
                file.contents = Buffer.from(result, 'utf8');
                cb(null, file);
            } catch (err) {
                cb(err);
            }
        }
    });
}

function gulpRename(fn) {
    return new Transform({
        objectMode: true,
        transform(file, enc, cb) {
            fn(file);
            cb(null, file);
        }
    });
}

function gulpWrap(header = '', footer = '') {
    return new Transform({
        objectMode: true,
        transform(file, enc, cb) {
            if (file.isNull()) return cb(null, file);
            const content = file.contents.toString('utf8');
            const h = typeof header === 'function' ? header() : header;
            const f = typeof footer === 'function' ? footer() : footer;
            file.contents = Buffer.from(h + content + f, 'utf8');
            cb(null, file);
        }
    });
}



// Tasks
function clean(cb) {
    fs.rmSync(BUILD, {recursive: true, force: true});
    cb();
}

function forceProduction(cb) {
    isProduction = true;
    cb();
}

function scripts(cb) {
    webpack({
        mode: 'none',
        entry: path.join(SRC, '_h5ai/public/js/scripts.js'),
        output: {
            filename: 'scripts.js',
            path: path.join(BUILD, '_h5ai/public/js')
        },
        module: {
            rules: [
                {
                    test: /\.js$/,
                    use: {
                        loader: 'babel-loader',
                        options: {
                            presets: ['@babel/preset-env']
                        }
                    }
                },
                {
                    test: /jsdom/,
                    use: 'null-loader'
                }
            ]
        }
    }, (err, stats) => {
        if (err) return cb(err);
        if (stats.hasErrors()) return cb(new Error(stats.toString()));

        // Process the emitted file for includeit and wrapping
        const scriptsPath = path.join(BUILD, '_h5ai/public/js/scripts.js');
        let content = fs.readFileSync(scriptsPath, 'utf8');
        content = '\n\n// @include "pre.js"\n\n' + content;
        content = includeit(content, path.join(SRC, '_h5ai/public/js'));
        if (isProduction) {
            const UglifyJS = require('uglify-js');
            const result = UglifyJS.minify(content);
            if (result.error) return cb(result.error);
            content = result.code;
        }
        content = comment_js + content;
        fs.writeFileSync(scriptsPath, content, 'utf8');
        cb();
    });
}

function styles() {
    const plugins = [autoprefixer()];
    if (isProduction) {
        plugins.push(cssnano());
    }
    return src(`${SRC}/_h5ai/public/css/*.less`, {base: SRC})
        .pipe(gulpIncludeIt())
        .pipe(less())
        .pipe(postcss(plugins))
        .pipe(gulpWrap(() => comment_js))
        .pipe(dest(BUILD));
}

function pages() {
    return src([`${SRC}/**/*.pug`, `!${SRC}/**/*.tpl.pug`], {base: SRC})
        .pipe(pug({locals: {pkg: Object.assign({}, pkg, {version})}}))
        .pipe(gulpWrap('', () => comment_html))
        .pipe(gulpRename(file => {
            file.extname = '';
        }))
        .pipe(dest(BUILD));
}

function copy() {
    // 1. JSON configs
    const jsonCopy = src(`${SRC}/**/conf/*.json`, {base: SRC})
        .pipe(gulpWrap(() => comment_js))
        .pipe(dest(BUILD));

    // 2. Other files
    const otherCopy = src([
        `${SRC}/**`,
        `!${SRC}/**/*.js`,
        `!${SRC}/**/*.less`,
        `!${SRC}/**/*.pug`,
        `!${SRC}/**/conf/*.json`
    ], {base: SRC})
        .pipe(new Transform({
            objectMode: true,
            transform(file, enc, cb) {
                if (file.isBuffer() && (/index\.php$/).test(file.path)) {
                    let content = file.contents.toString('utf8');
                    content = content.replace('{{VERSION}}', version);
                    file.contents = Buffer.from(content, 'utf8');
                }
                cb(null, file);
            }
        }))
        .pipe(dest(BUILD));

    // 3. Markdowns
    const mdCopy = src(`${ROOT}/*.md`)
        .pipe(dest(path.join(BUILD, '_h5ai')));

    // 4. Movi player
    const moviCopy = src(`${ROOT}/node_modules/movi-player/dist/element.js`)
        .pipe(gulpRename(file => {
            file.dirname = path.join(file.base, 'public/ext/movi-player');
            file.basename = 'element';
            file.extname = '.js';
        }))
        .pipe(dest(path.join(BUILD, '_h5ai')));

    return Promise.all([
        new Promise(resolve => jsonCopy.on('end', resolve)),
        new Promise(resolve => otherCopy.on('end', resolve)),
        new Promise(resolve => mdCopy.on('end', resolve)),
        new Promise(resolve => moviCopy.on('end', resolve))
    ]);
}

function buildTests(cb) {
    // Compile test suite index.js
    webpack({
        mode: 'none',
        entry: path.join(TEST, 'index.js'),
        output: {
            filename: 'index.js',
            path: path.join(BUILD, 'test')
        },
        module: {
            rules: [
                {
                    test: /\.js$/,
                    use: {
                        loader: 'babel-loader',
                        options: {
                            presets: ['@babel/preset-env']
                        }
                    }
                },
                {
                    test: /jsdom/,
                    use: 'null-loader'
                }
            ]
        }
    }, (err, stats) => {
        if (err) return cb(err);
        if (stats.hasErrors()) return cb(new Error(stats.toString()));

        // Process the emitted test file for includeit and wrapping
        const testPath = path.join(BUILD, 'test/index.js');
        let content = fs.readFileSync(testPath, 'utf8');
        content = `\n\n// @include "${SRC}/**/js/pre.js"\n\n` + content;
        content = includeit(content, TEST);
        fs.writeFileSync(testPath, content, 'utf8');

        // Copy css and html to test folder
        fs.copyFileSync(
            path.join(BUILD, '_h5ai/public/css/styles.css'),
            path.join(BUILD, 'test/h5ai-styles.css')
        );
        fs.copyFileSync(
            path.join(TEST, 'index.html'),
            path.join(BUILD, 'test/index.html')
        );

        console.log(`browse to file://${BUILD}/test/index.html to run the test suite`);
        cb();
    });
}

const buildTasks = parallel(scripts, styles, pages, copy);
const build = series(buildTasks, buildTests);

function deployTask(cb) {
    const destArgIndex = process.argv.indexOf('--dest');
    let destPath = '';
    if (destArgIndex !== -1 && destArgIndex + 1 < process.argv.length) {
        destPath = process.argv[destArgIndex + 1];
    } else {
        return cb(new Error('no destination path (e.g. gulp deploy --dest /some/path)'));
    }

    console.log(`deploy to ${destPath}`);
    src(`${BUILD}/_h5ai/**`)
        .pipe(dest(destPath))
        .on('end', cb);
}

function watchTask() {
    watch([SRC, TEST], build);
}

function releaseZip() {
    const zipName = `${pkg.name}-${version}.zip`;
    return src(`${BUILD}/_h5ai/**`, {base: BUILD})
        .pipe(zip(zipName))
        .pipe(dest(BUILD));
}

const release = series(forceProduction, clean, build, releaseZip);

exports.clean = clean;
exports.scripts = scripts;
exports.styles = styles;
exports.pages = pages;
exports.copy = copy;
exports.tests = buildTests;
exports.build = build;
exports.deploy = series(build, deployTask);
exports.watch = watchTask;
exports.release = release;
exports.default = release;
