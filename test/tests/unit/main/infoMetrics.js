const {test, assert} = require('scar');
const {formatDuration, formatRelative, metricGroups} = require('../../../util/reqlib')('main/info-metrics');

const rowsOf = metrics => Object.fromEntries(metricGroups(metrics)
    .flatMap(([, rows]) => rows)
    .map(([label, info, value]) => [label, {info, value}]));

const EMPTY = {
    now: 1000,
    tasks: {
        warmer: {running: null, last: null, schedule: {enabled: false, interval: 86400, lastRun: null, nextRun: null}},
        refresh: {running: null, last: null}
    },
    cache: {
        thumbnails: {files: 0, sources: 0, bytes: 0, coverage: null},
        thumbnailDb: {bytes: null, sources: null},
        folderSizes: {entries: 0, fresh: 0, bytes: 0, ttl: 300, newest: null}
    }
};

test('info metrics: durations read in the largest sensible unit', () => {
    assert.equal(formatDuration(0), '0 s');
    assert.equal(formatDuration(59), '59 s');
    assert.equal(formatDuration(90), '2 min');
    assert.equal(formatDuration(3720), '1 h 02');
    assert.equal(formatDuration(86400), '24 h 00');
    assert.equal(formatDuration(3 * 86400 + 4 * 3600), '3 d 4 h');
    assert.equal(formatRelative(940, 1000), '1 min ago');
    assert.equal(formatRelative(1300, 1000), 'in 5 min');
});

test('info metrics: a fresh install reads as unknown, never as zero coverage', () => {
    const rows = rowsOf(EMPTY);
    assert.equal(rows['Cache warmer'].value, 'idle');
    assert.ok((/cache\.warmAtStartup/).test(rows['Cache warmer'].info));
    assert.equal(rows['Last warm run'].value, 'never');
    assert.equal(rows['Thumbnail coverage'].value, 'unknown');
    assert.equal(rows['Thumbnail files'].value, '0 B');
    assert.equal(rows['Thumbnail database'].value, 'none');
    assert.equal(rows['Folder sizes'].value, '0 of 0 entries fresh');
});

test('info metrics: coverage is given per kind of file with its share', () => {
    const metrics = JSON.parse(JSON.stringify(EMPTY));
    metrics.cache.thumbnails = {
        files: 5, sources: 4, bytes: 5000,
        coverage: {at: 400, categories: {img: {files: 1200, thumbnails: 1199}, mov: {files: 0, thumbnails: 0}, x: {files: 1, thumbnails: 1}}}
    };
    const rows = rowsOf(metrics);
    assert.equal(rows.Images.value, '1,199 of 1,200 (99 %)', 'floored: never 100 % with one missing');
    assert.equal(rows.Videos.value, '0 of 0 (–)');
    assert.equal(rows.x.value, '1 of 1 (100 %)', 'an unknown category keeps its key');
    assert.ok((/10 min ago/).test(rows.Images.info));
    assert.equal(rows.Videos.info, '', 'the date of the count is given once');
    assert.ok((/5 files for 4 source files, 1 KB on average/).test(rows['Thumbnail files'].info));
});

test('info metrics: a scheduled warmer and an unreadable database are explained', () => {
    const metrics = JSON.parse(JSON.stringify(EMPTY));
    metrics.tasks.warmer.schedule = {enabled: true, interval: 3600, lastRun: null, nextRun: null};
    metrics.cache.thumbnailDb = {bytes: 4096, sources: null};
    let rows = rowsOf(metrics);
    assert.ok((/starting with the next request/).test(rows['Cache warmer'].info));
    assert.ok((/cannot be read/).test(rows['Thumbnail database'].info));

    metrics.tasks.warmer.schedule = {enabled: true, interval: 3600, lastRun: 900, nextRun: 4500};
    metrics.tasks.refresh.running = {id: 'refresh', percent: null, remaining: null};
    rows = rowsOf(metrics);
    assert.ok((/next run in 58 min/).test(rows['Cache warmer'].info));
    assert.equal(rows['Folder size refresh'].value, 'running · …', 'no previous run, no duration');
});

test('info metrics: each task shows how long its previous finished run took', () => {
    const metrics = JSON.parse(JSON.stringify(EMPTY));
    metrics.tasks.warmer.last = {finished: 400, seconds: 125, phases: {files: {done: 30, seconds: 100}, sizes: {done: 0, seconds: 25}}};
    metrics.tasks.refresh.last = {finished: 990, seconds: 3, phases: {sizes: {done: 2, seconds: 3}}};
    metrics.tasks.refresh.running = {id: 'refresh', percent: 40, remaining: 5};
    const rows = rowsOf(metrics);
    assert.equal(rows['Cache warmer'].value, 'idle · last run 2 min');
    assert.equal(rows['Folder size refresh'].value, 'running · 40 % · ~ 5 s · last run 3 s');
    assert.equal(rows['Last warm run'].value, '10 min ago');
    assert.ok((/took 2 min: 30 files walked in 2 min, folder sizes in 25 s/).test(rows['Last warm run'].info));
});
