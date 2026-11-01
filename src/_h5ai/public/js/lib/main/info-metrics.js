// Rows of the info page metrics, built from the `metrics` API answer
// (Metrics::collect). Free of DOM access: each row is
// [label, description (trusted static HTML), shown value].

const {formatSize, formatDate} = require('../core/format');
const {formatFigures} = require('../ext/tasks-progress');

const CATEGORY_LABELS = {
    img: 'Images',
    mov: 'Videos',
    doc: 'Documents',
    ar: 'Archives',
    aud: 'Audio'
};

const plural = (count, word, words = `${word}s`) => `${count.toLocaleString('en')} ${count === 1 ? word : words}`;

// "42 s", "3 min", "2 h 05", "3 d 4 h".
const formatDuration = seconds => {
    const secs = Math.max(0, Math.round(seconds));
    if (secs < 60) {
        return `${secs} s`;
    }
    const minutes = Math.round(secs / 60);
    if (minutes < 60) {
        return `${minutes} min`;
    }
    const hours = Math.floor(minutes / 60);
    if (hours < 48) {
        return `${hours} h ${String(minutes % 60).padStart(2, '0')}`;
    }
    return `${Math.floor(hours / 24)} d ${hours % 24} h`;
};

// "3 min ago" or "in 2 h 05", relative to the server clock (`now`), so a
// skewed browser clock does not matter.
const formatRelative = (time, now) => {
    const delta = time - now;
    return delta <= 0 ? `${formatDuration(-delta)} ago` : `in ${formatDuration(delta)}`;
};

const formatTime = (time, now) => `${formatDate(time * 1000)} (${formatRelative(time, now)})`;

const percentOf = (part, total) => total > 0 ? `${Math.floor(part / total * 100)} %` : '–';

const runningState = task => task ? `running · ${formatFigures(task.percent, task.remaining)}` : 'idle';

const lastRunText = (last, now) => {
    if (!last) {
        return 'Never finished a run yet.';
    }
    return `Last run ended ${formatTime(last.finished, now)} and took ${formatDuration(last.seconds)}.`;
};

const warmerRows = (warmer, now) => {
    const {schedule, last, running} = warmer;
    let scheduleText;
    if (!schedule.enabled) {
        scheduleText = 'Disabled: set <code>cache.warmAtStartup</code> to warm thumbnails and folder sizes in the background.';
    } else if (schedule.nextRun === null) {
        scheduleText = `Runs every ${formatDuration(schedule.interval)}, starting with the next request.`;
    } else {
        scheduleText = `Runs every ${formatDuration(schedule.interval)}; next run ${formatRelative(schedule.nextRun, now)}.`;
    }
    const rows = [['Cache warmer', scheduleText, runningState(running)]];

    if (last) {
        const files = last.phases.files;
        const sizes = last.phases.sizes;
        const parts = [];
        if (files) {
            parts.push(`${plural(files.done, 'file')} walked in ${formatDuration(files.seconds)}`);
        }
        if (sizes) {
            parts.push(`folder sizes in ${formatDuration(sizes.seconds)}`);
        }
        rows.push(['Last warm run', `Ended ${formatTime(last.finished, now)}. ${parts.join(', ')}.`,
            formatDuration(last.seconds)]);
    } else {
        rows.push(['Last warm run', 'No finished run yet.', 'never']);
    }
    return rows;
};

const taskRows = (tasks, now) => [
    ...warmerRows(tasks.warmer, now),
    ['Folder size refresh', `Recomputes expired folder sizes after a listing. ${lastRunText(tasks.refresh.last, now)}`,
        runningState(tasks.refresh.running)]
];

const coverageRows = (coverage, now) => {
    if (!coverage) {
        return [['Thumbnail coverage',
            'Counted by the cache warmer while it walks the share: none of its runs had thumbnails enabled yet.',
            'unknown']];
    }
    const categories = Object.keys(coverage.categories);
    if (!categories.length) {
        return [['Thumbnail coverage', 'No thumbnail type is configured.', '–']];
    }
    return categories.map(category => {
        const {files, thumbnails} = coverage.categories[category];
        return [
            CATEGORY_LABELS[category] || category,
            `Files with a thumbnail, counted by the warm run of ${formatTime(coverage.at, now)}.`,
            `${thumbnails.toLocaleString('en')} of ${files.toLocaleString('en')} (${percentOf(thumbnails, files)})`
        ];
    });
};

const cacheRows = (cache, now) => {
    const {thumbnails, thumbnailDb, folderSizes} = cache;
    const average = thumbnails.files > 0 ? `, ${formatSize(Math.round(thumbnails.bytes / thumbnails.files))} on average` : '';
    let dbText = `${plural(thumbnailDb.sources || 0, 'source file')} recorded, used to prune thumbnails of deleted files.`;
    if (thumbnailDb.bytes === null) {
        dbText = 'Not created yet.';
    } else if (thumbnailDb.sources === null) {
        dbText = 'Its content cannot be read (SQLite3 missing or database busy).';
    }
    const newest = folderSizes.newest === null ? '' : ` Last written ${formatRelative(folderSizes.newest, now)}.`;

    return [
        ['Thumbnail files',
            `${plural(thumbnails.files, 'file')} for ${plural(thumbnails.sources, 'source file')}${average}, in <code>_h5ai/public/cache/thumbs</code>.`,
            formatSize(thumbnails.bytes)],
        ...coverageRows(thumbnails.coverage, now),
        ['Thumbnail database', dbText, thumbnailDb.bytes === null ? 'none' : formatSize(thumbnailDb.bytes)],
        ['Folder sizes',
            `${formatSize(folderSizes.bytes) || '0 B'} on disk. Entries are served for ${formatDuration(folderSizes.ttl)}.${newest}`,
            `${folderSizes.fresh.toLocaleString('en')} of ${plural(folderSizes.entries, 'entry', 'entries')} fresh`]
    ];
};

// [[group title, rows]] for the metrics answer.
const metricGroups = metrics => [
    ['Background tasks', taskRows(metrics.tasks, metrics.now)],
    ['Cache', cacheRows(metrics.cache, metrics.now)]
];

module.exports = {
    formatDuration,
    formatRelative,
    metricGroups
};
