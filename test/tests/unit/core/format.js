const {test, assert} = require('scar');
const reqlib = require('../../../util/reqlib');
const format = reqlib('core/format');

test('core.format', () => {
    assert.equal(typeof format, 'object');
    assert.deepEqual(Object.keys(format).sort(), ['setDefaultMetric', 'formatSize', 'setDefaultDateFormat', 'formatDate'].sort());
    assert.equal(typeof format.setDefaultMetric, 'function');
    assert.equal(typeof format.formatSize, 'function');
    assert.equal(typeof format.setDefaultDateFormat, 'function');
    assert.equal(typeof format.formatDate, 'function');
});

test('core.format formats sizes with the selected metric and rejects invalid values', () => {
    format.setDefaultMetric(false);
    assert.equal(format.formatSize(0), '0 B');
    assert.equal(format.formatSize(999), '999 B');
    assert.equal(format.formatSize(1000), '1 KB');
    assert.equal(format.formatSize(1500000), '1.5 MB');
    assert.equal(format.formatSize(1024, {t: 1024, k: 1024, u: ['B', 'KiB']}), '1 KiB');
    assert.equal(format.formatSize(-1), '');
    assert.equal(format.formatSize('1000'), '');
    assert.equal(format.formatSize(NaN), '');
    assert.equal(format.formatSize(Infinity), '');

    format.setDefaultMetric(true);
    assert.equal(format.formatSize(1024), '1 KiB');
    format.setDefaultMetric(false);
});

test('core.format formats dates and returns empty for invalid timestamps', () => {
    const timestamp = new Date(2024, 0, 2, 3, 4, 5).getTime();
    assert.equal(format.formatDate(timestamp), '2024-01-02 03:04');
    assert.equal(format.formatDate(timestamp, 'YY/Y M/MM D/DD H/HH m/mm s/ss'), '24/2024 1/01 2/02 3/03 4/04 5/05');
    assert.equal(format.formatDate(0), '');
    assert.equal(format.formatDate(NaN), '');
    assert.equal(format.formatDate('1700000000000'), '');

    format.setDefaultDateFormat('YYYY');
    assert.equal(format.formatDate(timestamp), '2024');
    format.setDefaultDateFormat('YYYY-MM-DD HH:mm');
});
